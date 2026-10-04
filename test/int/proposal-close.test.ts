// EX-05 (expert audit): a Fix that is rejected — or applied and then undone — takes its doc proposals with it. Before,
// the proposal stayed pending with ✓採用 in the prose after the reject; accepting it made the doc describe code that
// was never written. Real daemon routes, scripted claude (`routeUx`), zero tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import type { AnchorInput, CodeTargets, Job, JobDetail, JobEstimate, JobId, ProposalId, ThreadDetail, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import type { SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";
import { ASK, CITED_MD, CONFIG, RETRY_ASK, routeUx } from "./ux-router.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let sse: SseReader;
let web: Awaited<ReturnType<Int["browser"]>>;

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({
    spawner: fakeClaude({
      dtMs: 1,
      respond(prompt, spec) {
        const r = routeUx(prompt);
        if (!r) return null;
        const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
        return r.kind === "answer" ? synth.text(r.text, { model, dtMs: 1 }) : synth.text("", { model, dtMs: 1, structured: r.patch });
      },
    }),
    config: FAKE_CLAUDE_CONFIG,
  });
  ws = (await int.open(repo.root)).ws;
  sse = await int.sse(ws);
  web = await int.browser();
}, 60_000);
afterAll(async () => {
  sse?.close();
  await int?.close();
  await repo?.dispose();
});

const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
const doc = () => int.domain(ws).doc;
const stateOf = (id: ProposalId) =>
  doc()
    .proposals()
    .find((p) => p.id === id)?.state;

async function jobUntil(id: JobId, states: string[], ms = 20_000): Promise<JobDetail> {
  const t0 = Date.now();
  for (;;) {
    const j = await api<JobDetail>("GET", `/jobs/${id}`);
    if (states.includes(j.state)) return j;
    if (j.state === "failed") throw new Error(`job ${id} failed: ${JSON.stringify(j.failure)}`);
    if (Date.now() - t0 > ms) throw new Error(`job ${id} stuck in ${j.state}`);
    await Bun.sleep(20);
  }
}

/** The token Fix on the §4 env row (the row's own code as the picked target): ready, with one doc proposal. */
async function tokenFix(): Promise<{ job: JobDetail; proposal: ProposalId }> {
  const b = doc()
    .section("s4" as never)
    ?.blocks.find((x) => x.md.includes("TSUNDOKU_API_TOKEN"));
  if (!b) throw new Error("no env table");
  const text = doc().blockText(b.id) ?? "";
  const at = text.indexOf("TSUNDOKU_API_TOKEN");
  const anchor: AnchorInput = { primary: "doc", doc: { block: b.id, selStart: at, selEnd: at + "TSUNDOKU_API_TOKEN".length } };
  const targets = await api<CodeTargets>("POST", "/jobs/targets", { anchor, text: ASK });
  const pick = targets.candidates[0] as CodeTargets["candidates"][number];
  const add = [{ path: pick.path, start: pick.start, end: pick.end }];
  const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: ASK, draft: false });
  const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [th.id], context: { add } });
  const created = await api<Job>("POST", "/jobs", { kind: "fix", threads: [th.id], context: { add }, estimateId: est.estimate.id, confirm: true });
  const job = await jobUntil(created.id, ["ready"]);
  expect(job.proposals).toHaveLength(1);
  const proposal = job.proposals[0] as ProposalId;
  expect(stateOf(proposal)).toBe("pending");
  return { job, proposal };
}

describe("EX-05 a closed job's doc proposals close with it", () => {
  test("reject the Fix ⇒ its proposal is rejected (SSE removed), the tree is unchanged, and accepting it is refused", async () => {
    const before = readFileSync(join(repo.root, CONFIG), "utf8");
    const { job, proposal } = await tokenFix();
    await api("POST", `/jobs/${job.id}/reject`, { reason: "違う" });
    expect(stateOf(proposal)).toBe("rejected");
    await sse.until((ev) => ev.some((e) => e.type === "doc.proposal.removed" && (e as { id: string }).id === proposal));
    expect((await api<{ id: string }[]>("GET", "/doc/proposals?state=pending")).map((p) => p.id)).not.toContain(proposal);
    const res = await web.req("POST", `/ws/${ws}/doc/proposals/${proposal}/accept`, {});
    expect(res.status).toBe(412); // already rejected
    expect(readFileSync(join(repo.root, CONFIG), "utf8")).toBe(before);
  });

  test("a pending proposal whose job was rejected (made before this fix) ⇒ accept is 409, reject still works", async () => {
    const { job, proposal } = await tokenFix();
    await api("POST", `/jobs/${job.id}/reject`);
    // a leftover pending proposal of that rejected job, as an older daemon left them
    const p = doc()
      .proposals()
      .find((x) => x.id === proposal);
    if (!p) throw new Error("proposal gone");
    const legacy = doc().propose({ block: p.block, section: p.section, op: p.op, baseHash: p.baseHash, md: p.md, source: p.source, reason: p.reason });
    const res = await web.req("POST", `/ws/${ws}/doc/proposals/${legacy.id}/accept`, {});
    expect(res.status).toBe(409);
    const err = ((await res.json()) as { error: { code: string; params: { job: string; jobState: string } } }).error;
    expect(err).toMatchObject({ code: "E_STATE_TRANSITION", params: { job: job.id, jobState: "rejected" } });
    expect(stateOf(legacy.id)).toBe("pending");
    expect((await web.req("POST", `/ws/${ws}/doc/proposals/${legacy.id}/reject`)).status).toBe(200);
    expect(stateOf(legacy.id)).toBe("rejected");
  });

  test("accept the code alone, then Undo ⇒ the job is reverted and its unaccepted proposal is rejected", async () => {
    const before = readFileSync(join(repo.root, CONFIG), "utf8");
    const { job, proposal } = await tokenFix();
    const acc = await api<{ checkpoint: { id: string } }>("POST", `/jobs/${job.id}/accept`, { accept: "all", acceptUnverified: true });
    expect(readFileSync(join(repo.root, CONFIG), "utf8")).not.toBe(before);
    // the env row is a static facts block: it follows the accepted code by itself, so the accept closed the AI edit
    // of it (rem/safety, cr-requests/ux.md #2; a prose block's proposal stays acceptable on its own, ux.test.ts)
    expect(stateOf(proposal)).toBe("rejected");
    await api("POST", `/checkpoints/${acc.checkpoint.id}/undo`, {});
    expect(readFileSync(join(repo.root, CONFIG), "utf8")).toBe(before);
    expect((await api<JobDetail>("GET", `/jobs/${job.id}`)).state).toBe("reverted");
    expect(stateOf(proposal)).toBe("rejected");
  });

  test("a prose sentence's proposal: still pending after the code alone is accepted, rejected by the Undo", async () => {
    // a human writes a cited sentence into the doc; the retry Fix on it proposes the sentence's rewrite (ux-router)
    const ph = doc()
      .section("s1")
      ?.blocks.find((b) => b.kind === "placeholder");
    if (!ph) throw new Error("no placeholder in s1");
    const edited = await web.req("POST", `/ws/${ws}/doc/blocks/${ph.id}/edit`, { baseHash: ph.hash, md: CITED_MD, mdForm: "file", apply: "doc" });
    expect(edited.status).toBe(200);
    const text = doc().blockText(ph.id) ?? "";
    const anchor: AnchorInput = { primary: "doc", doc: { block: ph.id, selStart: 0, selEnd: text.length } };
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: RETRY_ASK, draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [th.id] });
    const job = await api<Job>("POST", "/jobs", { kind: "fix", threads: [th.id], estimateId: est.estimate.id, confirm: true });
    const ready = await jobUntil(job.id, ["ready"]);
    const proposal = ready.proposalViews[0]?.id as ProposalId;
    expect(doc().block(ready.proposalViews[0]?.block as never)?.origin).not.toBe("static");
    const FETCH = "internal/meta/fetch.go";
    const before = readFileSync(join(repo.root, FETCH), "utf8");
    const acc = await api<{ checkpoint: { id: string } }>("POST", `/jobs/${job.id}/accept`, { accept: "all", acceptUnverified: true });
    expect(readFileSync(join(repo.root, FETCH), "utf8")).not.toBe(before);
    expect(stateOf(proposal)).toBe("pending"); // still acceptable on its own while the code is in the tree
    await api("POST", `/checkpoints/${acc.checkpoint.id}/undo`, {});
    expect(readFileSync(join(repo.root, FETCH), "utf8")).toBe(before);
    expect((await api<JobDetail>("GET", `/jobs/${job.id}`)).state).toBe("reverted");
    expect(stateOf(proposal)).toBe("rejected");
  });
});
