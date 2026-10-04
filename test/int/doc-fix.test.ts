// EX-06 (expert audit): "this design-doc sentence is wrong, the code is right" had no AI path — 修正 → 「設計書を直す」
// was a raw-Markdown editor (and a review comment typed after switching was saved INTO the doc). An Explain with
// `docFix` now answers AND proposes the anchored block rewritten to match the code; the human accepts or rejects the
// proposal in the prose (no code changes). Real daemon routes, scripted claude, zero tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import type { AnchorInput, BlockView, DocEditRes, DocProposalView, Job, JobDetail, JobEstimate, JobId, ThreadDetail, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";

const WRONG = "`Fetch` は失敗した取得を 3 回まで再試行する（[fetch.go:46-61](../../internal/meta/fetch.go#L46-L61)）。";
const RIGHT = "`Fetch` は失敗した取得を 1 回だけ再試行する [[internal/meta/fetch.go:46-61]]。";
let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let web: Awaited<ReturnType<Int["browser"]>>;
const prompts: string[] = [];

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({
    spawner: fakeClaude({
      dtMs: 1,
      respond(prompt, spec) {
        if (!/^MBF\/1 mode=answer/m.test(prompt)) return null;
        prompts.push(prompt);
        const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
        const fixing = prompt.includes("```mitori-doc```");
        const text = fixing
          ? `いいえ。\`maxRetries\` は 1 なので再試行は 1 回だけです [[internal/meta/fetch.go:19-19]]。\n\n\`\`\`mitori-doc\n${RIGHT}\n\`\`\``
          : "再試行は 1 回です [[internal/meta/fetch.go:19-19]]。";
        return synth.text(text, { model, dtMs: 1 });
      },
    }),
    config: FAKE_CLAUDE_CONFIG,
  });
  ws = (await int.open(repo.root)).ws;
  web = await int.browser();
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
});

const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
const doc = () => int.domain(ws).doc;
async function jobUntil(id: JobId, states: string[]): Promise<JobDetail> {
  for (let i = 0; i < 1000; i++) {
    const j = await api<JobDetail>("GET", `/jobs/${id}`);
    if (states.includes(j.state)) return j;
    if (j.state === "failed") throw new Error(`job failed: ${JSON.stringify(j.failure)}`);
    await Bun.sleep(20);
  }
  throw new Error("job stuck");
}

describe("EX-06 the AI fixes the doc to match the code", () => {
  test("an Explain with docFix answers and proposes the anchored block rewritten; accepting it fixes the doc, not the code", async () => {
    // a wrong human sentence in §1 (the doc says 3 retries, the code does 1)
    const ph = doc()
      .section("s1")
      ?.blocks.find((b) => b.kind === "placeholder");
    if (!ph) throw new Error("no placeholder");
    const edit = await web.req("POST", `/ws/${ws}/doc/blocks/${ph.id}/edit`, { baseHash: ph.hash, md: WRONG, mdForm: "file", apply: "doc" });
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as DocEditRes).block?.id).toBe(ph.id);
    const text = doc().blockText(ph.id) ?? "";
    const anchor: AnchorInput = { primary: "doc", doc: { block: ph.id, selStart: 0, selEnd: text.length } };
    const th = await api<ThreadDetail>("POST", "/threads", {
      anchor,
      intent: "question",
      body: "この文は間違っている。コードは 1 回しか再試行しない。",
      draft: false,
    });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id], docFix: true });
    expect(est.route.mode).toBe("answer");
    const before = readFileSync(join(repo.root, "internal/meta/fetch.go"), "utf8");
    const job = await api<Job>("POST", "/jobs", {
      kind: "explain",
      threads: [th.id],
      docFix: true,
      estimateId: est.estimate.id,
      confirm: est.estimate.requiresConfirm,
    });
    const done = await jobUntil(job.id, ["done"]);
    // the bundle told the model the code is the truth and how to return the block
    expect(prompts.at(-1)).toContain("The CODE is correct; the DOC may be wrong.");
    expect(done.proposals).toHaveLength(1);
    const p = (await api<DocProposalView[]>("GET", "/doc/proposals?state=pending")).find((x) => x.id === done.proposals[0]);
    expect(p?.block).toBe(ph.id);
    expect(p?.md).toContain("1 回だけ再試行する");
    expect(p?.md).toContain("[internal/meta/fetch.go:46-61](internal/meta/fetch.go#L46-L61)");
    expect(p?.md).not.toContain("[[");
    // the answer card has the answer, never the fence
    const t = await api<ThreadDetail>("GET", `/threads/${th.id}`);
    const answer = t.messages.find((m) => m.kind === "answer");
    expect(answer?.body).toContain("再試行は 1 回だけです");
    expect(answer?.body).not.toContain("mitori-doc");
    // EX-11: the one-line preview of the answer has no raw [[path:a-b]] token
    const row = (await api<{ items: { id: string; preview?: string }[] }>("GET", "/threads?limit=50")).items.find((x) => x.id === th.id);
    expect(row?.preview).toContain("internal/meta/fetch.go:19-19");
    expect(row?.preview).not.toContain("[[");
    // the human accepts it in the prose: the doc changes, the code does not
    const res = await web.req("POST", `/ws/${ws}/doc/proposals/${p?.id}/accept`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as BlockView).id as string).toBe(ph.id as string);
    expect(doc().block(ph.id)?.md).toContain("1 回だけ再試行する");
    expect(readFileSync(join(repo.root, "internal/meta/fetch.go"), "utf8")).toBe(before);
  });

  test("without docFix the same Explain only answers (no proposal, no doc-fix instruction)", async () => {
    const ph = doc()
      .section("s1")
      ?.blocks.find((b) => b.md.includes("1 回だけ再試行"));
    if (!ph) throw new Error("no fixed block");
    const anchor: AnchorInput = { primary: "doc", doc: { block: ph.id, selStart: 0, selEnd: 4 } };
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "何回？", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    const job = await api<Job>("POST", "/jobs", { kind: "explain", threads: [th.id], estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
    const done = await jobUntil(job.id, ["done"]);
    expect(done.proposals).toEqual([]);
    expect(prompts.at(-1)).not.toContain("The CODE is correct");
  });
});
