// UX-INT (finishing pass, track ux): the concept's loop on the REAL daemon routes — in-process daemon, scripted claude,
// zero tokens — for the three things that did not work before:
//   1. Fix WITHOUT `@` (CR ux-F1): a comment on a design-doc sentence finds its code — the anchor's cites
//      (automatic), else the row's own code reference / names as candidates the user picks; nothing ⇒ nothing.
//   2. Doc proposals end to end: the AI's doc edit arrives (SSE) as a suggestion-mode diff, a job's proposal is decided
//      in its Review while the job is under review, then on its own; reject discards; a human-edited block stays locked.
//   3. The human edit of a block (`POST /doc/blocks/:block/edit`, apply doc | code) — co-editing the doc.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import type {
  AnchorInput,
  BlockView,
  CodeTargets,
  DocEditRes,
  DocProposalView,
  Job,
  JobDetail,
  JobEstimate,
  JobId,
  ThreadDetail,
  WorkspaceKey,
} from "@mitori/core";
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
const prompts: string[] = [];

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({
    spawner: fakeClaude({
      dtMs: 1,
      respond(prompt, spec) {
        const r = routeUx(prompt);
        if (!r) return null;
        prompts.push(prompt);
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
const webApi = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await web.req(method, `/ws/${ws}${path}`, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const doc = () => int.domain(ws).doc;
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
/** A selection anchor on `exact` inside the block of section `sec` whose Markdown contains `has` (the Composer's AnchorInput). */
function anchorOn(sec: string, has: string, exact: string, nth = 0): AnchorInput {
  const b = doc()
    .section(sec as never)
    ?.blocks.find((x) => x.md.includes(has));
  if (!b) throw new Error(`no block with ${has} in ${sec}`);
  const text = doc().blockText(b.id) ?? "";
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(exact, at + 1);
  const end = at + exact.length;
  return {
    primary: "doc",
    doc: { block: b.id, selStart: at, selEnd: end, quote: { prefix: text.slice(Math.max(0, at - 32), at), exact, suffix: text.slice(end, end + 32) } },
  };
}

describe("UX-INT-01 Fix without @ (CR ux-F1)", () => {
  test("(b) a static facts row offers ITS code (the env read in Load), and the pick is the whole write scope", async () => {
    const anchor = anchorOn("s4", "TSUNDOKU_API_TOKEN", "TSUNDOKU_API_TOKEN");
    const t0 = performance.now();
    const targets = await api<CodeTargets>("POST", "/jobs/targets", { anchor, text: ASK });
    const ms = performance.now() - t0;
    expect(targets.cited).toEqual([]);
    expect(targets.candidates[0]).toMatchObject({ path: CONFIG, start: 19, end: 38, symbol: "Load", source: "ref", label: "config.go:19-38" });
    expect(ms).toBeLessThan(200); // deterministic, index-only (≈ 1 ms warm)

    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: ASK, draft: false });
    // the API's own rule is unchanged — no target, no write scope — but the Composer never asks this any more
    const bare = await int.cli("POST", `/ws/${ws}/jobs/estimate`, { kind: "fix", threads: [th.id] });
    expect(bare.status).toBe(412);
    const pick = targets.candidates[0] as CodeTargets["candidates"][number];
    const add = [{ path: pick.path, start: pick.start, end: pick.end }];
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [th.id], context: { add } });
    expect(est.route.mode).toBe("patch");
    expect(est.estimate.items.map((i) => i.key)).toContain(`code:${CONFIG}:19-38`);
    const job = await api<Job>("POST", "/jobs", { kind: "fix", threads: [th.id], context: { add }, estimateId: est.estimate.id, confirm: true });
    const ready = await jobUntil(job.id, ["ready"]);
    expect(ready.writeScope).toEqual([CONFIG]);
    expect(prompts.at(-1)).toContain(`WRITE ${CONFIG}\n`);
    expect(prompts.at(-1)).toContain("CODE internal/config/config.go:19-38");
    expect(ready.diff.map((f) => f.path)).toEqual([CONFIG]);
  });

  test("(b) the request text finds names too; a whole-block anchor offers every row's code, distinct files first", async () => {
    const a = anchorOn("s8", "/api/books", "GET");
    const routes = await api<CodeTargets>("POST", "/jobs/targets", { anchor: { primary: "doc", doc: { ...a.doc, selStart: 0, selEnd: 100_000 } }, limit: 8 });
    // every row's handler (the table's own references), not the words of the table
    expect(routes.candidates.every((t) => t.source === "ref" && t.path === "internal/server/server.go")).toBe(true);
    expect(routes.candidates.map((t) => t.symbol)).toEqual(expect.arrayContaining(["Server.listBooks", "Server.createBook", "Server.deleteBook"]));
    const named = await api<CodeTargets>("POST", "/jobs/targets", { anchor: anchorOn("s4", "# 4.", "動かして"), text: "Client.Fetch の再試行を設定可能に" });
    expect(named.candidates[0]).toMatchObject({ path: "internal/meta/fetch.go", symbol: "Client.Fetch", source: "symbol" });
  });

  test("(c) a heading with no code and no name in the request ⇒ no target at all (the Composer explains how to point)", async () => {
    const none = await api<CodeTargets>("POST", "/jobs/targets", { anchor: anchorOn("s4", "# 4.", "動かして"), text: "もっと分かりやすくして" });
    expect(none).toEqual({ cited: [], candidates: [] });
    const bad = await int.cli("POST", `/ws/${ws}/jobs/targets`, { anchor: { primary: "doc" } });
    expect(bad.status).toBe(400);
  });

  test("(a) a sentence that cites code: the cite IS the target — the estimate needs no pick", async () => {
    // a human writes a sentence with a cite link into the doc (the edit route below), the store stamps the claim
    const ph = doc()
      .section("s1")
      ?.blocks.find((b) => b.kind === "placeholder");
    if (!ph) throw new Error("no placeholder in s1");
    const res = await webApi<DocEditRes>("POST", `/doc/blocks/${ph.id}/edit`, { baseHash: ph.hash, md: CITED_MD, mdForm: "file", apply: "doc" });
    expect(res.block?.lock).toBe("human-edited");
    expect(doc().claims(ph.id)[0]?.cites[0]).toMatchObject({ path: "internal/meta/fetch.go", start: 46, end: 61 });
    const text = doc().blockText(ph.id) ?? "";
    const anchor: AnchorInput = { primary: "doc", doc: { block: ph.id, selStart: 0, selEnd: text.length } };
    const t = await api<CodeTargets>("POST", "/jobs/targets", { anchor });
    expect(t.cited).toEqual([expect.objectContaining({ path: "internal/meta/fetch.go", start: 46, end: 61, source: "cite", symbol: "Client.Fetch" })]);
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: RETRY_ASK, draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [th.id] });
    expect(est.route.mode).toBe("patch");
    expect(est.estimate.items.map((i) => i.key)).toContain("code:internal/meta/fetch.go:46-61");
    const job = await api<Job>("POST", "/jobs", { kind: "fix", threads: [th.id], estimateId: est.estimate.id, confirm: true });
    const ready = await jobUntil(job.id, ["ready"]);
    expect(ready.writeScope).toEqual(["internal/meta/fetch.go"]);
  });
});

describe("UX-INT-02 doc proposals end to end", () => {
  let jobId: JobId;
  let proposal: DocProposalView;

  test("the Fix's doc update arrives as a suggestion (SSE + JobDetail), and is decided in the job's Review while it is under review", async () => {
    const jobs = await api<{ items: Job[] }>("GET", "/jobs?limit=50");
    const fix = jobs.items.find((j) => j.state === "ready" && j.writeScope.includes(CONFIG));
    if (!fix) throw new Error("no ready token fix");
    jobId = fix.id;
    const detail = await api<JobDetail>("GET", `/jobs/${jobId}`);
    expect(detail.proposalViews).toHaveLength(1);
    proposal = detail.proposalViews[0] as DocProposalView;
    expect(proposal.diffHtml).toContain('<del class="d">なし</del><ins class="a">dev</ins>');
    expect(proposal.diffHtml).not.toBe(proposal.html);
    await sse.until((ev) => ev.some((e) => e.type === "doc.proposal.upsert" && (e as { proposal: DocProposalView }).proposal.id === proposal.id));
    const pushed = sse.events.find((e) => e.type === "doc.proposal.upsert") as unknown as { proposal: DocProposalView };
    expect(pushed.proposal.diffHtml).toBe(proposal.diffHtml);
    // standalone accept while the job is under review: decided in its Review instead (one accept, one Undo)
    const res = await web.req("POST", `/ws/${ws}/doc/proposals/${proposal.id}/accept`, {});
    expect(res.status).toBe(412);
    expect(((await res.json()) as { error: { params: { job: string } } }).error.params.job).toBe(jobId);
  });

  test("code accepted without the doc change: the static row follows the code by itself, so the AI's edit of it conflicts (409) and is rejected", async () => {
    await api("POST", `/jobs/${jobId}/accept`, { accept: "all", acceptUnverified: true });
    expect(readFileSync(join(repo.root, CONFIG), "utf8")).toContain('cmp.Or(os.Getenv("TSUNDOKU_API_TOKEN"), "dev")');
    expect((await api<DocProposalView[]>("GET", "/doc/proposals?state=pending")).map((p) => p.id)).toContain(proposal.id);
    // the env table is a static facts block: re-indexing the accepted code rewrote the row (default now detected)
    await sse.until((ev) => ev.some((e) => e.type === "doc.block.upsert" && (e as { block: BlockView }).block.id === proposal.block), 5000);
    const res = await web.req("POST", `/ws/${ws}/doc/proposals/${proposal.id}/accept`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("E_DOC_BASE_MISMATCH");
    expect(await webApi<{ ok: boolean }>("POST", `/doc/proposals/${proposal.id}/reject`)).toEqual({ ok: true });
    await sse.until((ev) => ev.some((e) => e.type === "doc.proposal.removed" && (e as { id: string }).id === proposal.id));
    expect((await api<DocProposalView[]>("GET", "/doc/proposals?state=pending")).map((p) => p.id)).not.toContain(proposal.id);
  });

  test("a prose sentence: the Fix's doc update, accepted on its own after the code, rewrites it — and the human lock stays", async () => {
    const jobs = await api<{ items: Job[] }>("GET", "/jobs?limit=50");
    const fix = jobs.items.find((j) => j.state === "ready" && j.writeScope.includes("internal/meta/fetch.go"));
    if (!fix) throw new Error("no ready retry fix");
    const detail = await api<JobDetail>("GET", `/jobs/${fix.id}`);
    const p = detail.proposalViews[0] as DocProposalView;
    expect(p.diffHtml).toContain('<del class="d">1</del>');
    expect(p.diffHtml).toContain('<ins class="a">MaxRetries</ins>');
    await api("POST", `/jobs/${fix.id}/accept`, { accept: "all", acceptUnverified: true });
    const view = await webApi<BlockView>("POST", `/doc/proposals/${p.id}/accept`, {});
    expect(view.id as string).toBe(p.block as string);
    expect(view.lock as string | undefined).toBe("human-edited"); // a human wrote this sentence: an accepted AI edit does not unlock it
    expect(doc().block(p.block as never)?.md).toContain("`MaxRetries` 回まで再試行する");
    // the claim kept its cite — re-anchored by the accepted code (the retry patch moved `Fetch` one line up)
    expect(doc().claims(p.block as never)[0]?.cites[0]).toMatchObject({ path: "internal/meta/fetch.go", symbol: "internal/meta/fetch.go#Client.Fetch" });
    await sse.until((ev) => ev.some((e) => e.type === "doc.proposal.removed" && (e as { id: string }).id === p.id));
    const again = await web.req("POST", `/ws/${ws}/doc/proposals/${p.id}/accept`, {});
    expect(again.status).toBe(412);
  });

  test("an answer promoted to the doc is an INSERT proposal; reject discards it and the doc is unchanged", async () => {
    const anchor = anchorOn("s4", "TSUNDOKU_API_TOKEN", "LOG_LEVEL");
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "どこで読む？", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    const job = await api<Job>("POST", "/jobs", { kind: "explain", threads: [th.id], estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
    await jobUntil(job.id, ["done"]);
    const before = doc().section("s4")?.blocks.length;
    const res = await webApi<{ proposal?: DocProposalView }>("POST", `/threads/${th.id}/promote`, { to: "doc" });
    const p = res.proposal as DocProposalView;
    expect(p.op).toBe("insert");
    expect(p.diffHtml).toContain('<ins class="a">');
    await sse.until((ev) => ev.some((e) => e.type === "doc.proposal.upsert" && (e as { proposal: DocProposalView }).proposal.id === p.id));
    expect(await webApi<{ ok: boolean }>("POST", `/doc/proposals/${p.id}/reject`)).toEqual({ ok: true });
    expect(
      doc()
        .proposals({ state: "rejected" })
        .map((x) => x.id),
    ).toContain(p.id);
    expect(doc().section("s4")?.blocks.length).toBe(before);
    const twice = await web.req("POST", `/ws/${ws}/doc/proposals/${p.id}/reject`);
    expect(twice.status).toBe(412);
  });
});

describe("UX-INT-03 the human edit route", () => {
  test("removing a cite is reported BEFORE saving (UXP-20); confirmDrop saves; a stale base is a 409-class mismatch", async () => {
    const b = doc()
      .section("s1")
      ?.blocks.find((x) =>
        doc()
          .claims(x.id)
          .some((c) => c.cites.some((ct) => ct.path === "internal/meta/fetch.go")),
      );
    if (!b) throw new Error("no cited block");
    // keeping the link keeps the claim: saved at once
    const kept = await webApi<DocEditRes>("POST", `/doc/blocks/${b.id}/edit`, { baseHash: b.hash, md: CITED_MD, mdForm: "file", apply: "doc" });
    expect(kept.dropped).toBeUndefined();
    expect(kept.block?.lock).toBe("human-edited");
    const cur = doc().block(b.id);
    if (!cur) throw new Error("block gone");
    const dropped = await webApi<DocEditRes>("POST", `/doc/blocks/${b.id}/edit`, { baseHash: cur.hash, md: "再試行はしない。", mdForm: "file", apply: "doc" });
    expect(dropped.dropped).toEqual([expect.objectContaining({ label: "fetch.go:46-61" })]);
    expect(dropped.block).toBeUndefined();
    expect(doc().claims(b.id)).toHaveLength(1);
    const saved = await webApi<DocEditRes>("POST", `/doc/blocks/${b.id}/edit`, {
      baseHash: cur.hash,
      md: "再試行はしない。",
      mdForm: "file",
      apply: "doc",
      confirmDrop: true,
    });
    expect(saved.block?.lock).toBe("human-edited");
    expect(doc().claims(b.id)).toEqual([]);
    const stale = await web.req("POST", `/ws/${ws}/doc/blocks/${b.id}/edit`, { baseHash: cur.hash, md: "x", mdForm: "file", apply: "doc" });
    expect(stale.status).toBe(409);
    const marker = await web.req("POST", `/ws/${ws}/doc/blocks/${b.id}/edit`, { baseHash: b.hash, md: "x", mdForm: "marker", apply: "doc" });
    expect(marker.status).toBe(400);
  });

  test("apply: code on a block without code answers a precondition that names the way out (Fix offers the code)", async () => {
    const b = doc()
      .section("s4")
      ?.blocks.find((x) => x.kind === "heading");
    if (!b) throw new Error("no heading");
    const res = await web.req("POST", `/ws/${ws}/doc/blocks/${b.id}/edit`, { baseHash: b.hash, md: "# 4. 動かす", mdForm: "file", apply: "code" });
    expect(res.status).toBe(412);
    const e = ((await res.json()) as { error: { hint: string; params: { reason: string } } }).error;
    expect(e.params.reason).toBe("no_target");
    expect(e.hint).toContain("Fix");
  });
});
