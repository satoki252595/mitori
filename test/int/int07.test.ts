// INT-07 (integrate/live): regressions found by driving the review → AI fix loop through the real web UI against the
// real claude. Each test is a bug that no scenario test could see because its harness never did what the browser does:
//   LIVE-02  the Composer saves the draft's text 500 ms after the last key, the estimate runs after 300 ms — so the plan
//            a send reuses was made for an EMPTY ask (the real claude answered "the ASK body was empty").
//   LIVE-03  the web store asks `GET /doc/proposals?state=pending` on every enter; the route answered 501.
//   LIVE-06  `[[path:a-b]]` cites of an answer reached the thread card as raw text.
// (LIVE-01, the SSE `rev` dedupe, is `apps/web/src/stores/sse.test.ts`; the UI flow itself is `live-ui.test.ts`.)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { synth } from "@mitori/agent/testing";
import type { CreateJobReq, Job, JobDetail, JobEstimate, JobId, ThreadDetail, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";
import { RETRY_ANCHOR, RETRY_FILE, routeLoop } from "./router.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let web: Awaited<ReturnType<Int["browser"]>>;
/** Every loop bundle the scripted claude was sent (the user message of the turn). */
const prompts: string[] = [];

const spawner = fakeClaude({
  dtMs: 1,
  respond(prompt, spec) {
    const r = routeLoop(prompt);
    if (!r) return null;
    prompts.push(prompt);
    const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
    return r.kind === "answer" ? synth.text(r.text, { model, dtMs: 1 }) : synth.text("", { model, dtMs: 1, structured: r.patch });
  },
});

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({ spawner, config: FAKE_CLAUDE_CONFIG });
  ws = (await int.open(repo.root)).ws;
  web = await int.browser();
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
});

const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
/** A call the way the browser makes it (the thread transitions are web-only routes). */
const webApi = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await web.req(method, `/ws/${ws}${path}`, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
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
const anchor = { primary: "code" as const, code: { path: RETRY_FILE, start: RETRY_ANCHOR.start, end: RETRY_ANCHOR.end } };

describe("INT-07 live findings", () => {
  test("LIVE-02: a draft saved AFTER its estimate is what the engine is asked — the remembered plan is not reused", async () => {
    // what the Composer does: draft created with the first (empty) text, estimate, text saved, submit, send
    const draft = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "", draft: true });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [draft.id] });
    const ask = "この再試行は最大何回で、その回数はどこで決まっていますか？";
    const saved = await api<ThreadDetail>("PATCH", `/threads/${draft.id}`, { version: draft.version, body: ask, intent: "question" });
    await webApi<ThreadDetail>("POST", `/threads/${draft.id}/transition`, { on: "submit", version: saved.version });
    const before = prompts.length;
    const job = await api<Job>("POST", "/jobs", {
      kind: "explain",
      threads: [draft.id],
      estimateId: est.estimate.id,
      confirm: est.estimate.requiresConfirm,
    } satisfies CreateJobReq);
    await jobUntil(job.id, ["done"]);
    expect(prompts.length).toBe(before + 1);
    const sent = prompts.at(-1) ?? "";
    expect(sent).toContain(`ASK\n> ${ask}`);
    expect(sent).not.toMatch(/ASK\n> ?\n/);
  });

  test("LIVE-02: a create whose context chips differ from the estimate's is a new plan — the user confirms it, then it reaches the engine", async () => {
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "どう動く？", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    const req = { kind: "explain", threads: [th.id], context: { add: [{ path: "internal/meta/fetch.go", start: 63, end: 89 }] } } as const;
    // used to run the remembered plan WITHOUT the added range, silently
    const res = await int.cli("POST", `/ws/${ws}/jobs`, { ...req, estimateId: est.estimate.id });
    expect(res.status).toBe(409);
    const fresh = ((await res.json()) as { error: { params: { estimateId: string } } }).error.params.estimateId;
    const before = prompts.length;
    const job = await api<Job>("POST", "/jobs", { ...req, estimateId: fresh, confirm: true } as unknown as CreateJobReq);
    await jobUntil(job.id, ["done"]);
    expect(prompts.length).toBe(before + 1);
    expect(prompts.at(-1)).toContain("fetchOnce");
  });

  test("LIVE-03: GET /doc/proposals answers (an empty list), filters by state, and rejects an unknown state", async () => {
    expect(await api<unknown[]>("GET", "/doc/proposals?state=pending")).toEqual([]);
    expect(await api<unknown[]>("GET", "/doc/proposals")).toEqual([]);
    const res = await int.cli("GET", `/ws/${ws}/doc/proposals?state=nope`);
    expect(res.status).toBe(400);
  });

  test("LIVE-06: the cite of an answer is a link to the code view in the message HTML", async () => {
    const th = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "説明して", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    const job = await api<Job>("POST", "/jobs", {
      kind: "explain",
      threads: [th.id],
      estimateId: est.estimate.id,
      confirm: est.estimate.requiresConfirm,
    } satisfies CreateJobReq);
    await jobUntil(job.id, ["done"]);
    const done = await api<ThreadDetail>("GET", `/threads/${th.id}`);
    const answer = done.messages.find((m) => m.by.startsWith("agent:"));
    expect(answer?.body).toContain(`[[${RETRY_FILE}:${RETRY_ANCHOR.start}-${RETRY_ANCHOR.end}]]`);
    expect(answer?.html).toContain(`href="/w/${ws}/code/internal/meta/fetch.go#L${RETRY_ANCHOR.start}-L${RETRY_ANCHOR.end}"`);
    expect(answer?.html).not.toContain("[[");
  });
});
