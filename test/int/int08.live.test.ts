// INT-08 live (WP-08c real-engine verification, docs/progress/agent-mode.md): the REAL `claude` (the user's
// subscription, mitori's own lean argv — never default `claude -p` flags) behind the in-process daemon, on a scratch
// git copy of go-small, with the macOS gate sandbox:
//   1. a cross-file Fix that needs agent mode (3 files via `@` chips) → gates (sandboxed) → per-hunk accept → undo;
//   2. two patch jobs in parallel on different files, then two on the same line (lock wait, then the accept conflict).
// It spends nothing unless MITORI_LIVE=1 and MITORI_MAX_USD > 0; every new job first checks the API-equivalent spend
// (job usage from the ledger) + its estimate against the cap and stops the run when it would be exceeded.
//
//   MITORI_LIVE=1 MITORI_MAX_USD=1.5 scripts/nd bun test test/int/int08.live.test.ts
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcceptRes, EngineStatus, Job, JobDetail, JobEstimate, JobId, JobState, ThreadDetail, TrustRequest, UndoRes, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { type Int, startInt } from "./harness.ts";

const LIVE = process.env.MITORI_LIVE === "1";
const MAX_USD = Number(process.env.MITORI_MAX_USD ?? "0");
const OUT = join(import.meta.dir, "../../docs/progress/agent-mode");
setDefaultTimeout(600_000);

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let web: Awaited<ReturnType<Int["browser"]>>;
let sessionAt = 0;
const report: Record<string, unknown> = { at: new Date().toISOString(), capUsd: MAX_USD };
const jobsSeen = new Set<JobId>();

const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
const raw = (method: string, path: string, body?: unknown) => int.cli(method, `/ws/${ws}${path}`, body);
const webApi = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await web.req(method, `/ws/${ws}${path}`, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const read = (p: string) => readFileSync(join(repo.root, p), "utf8");
const lineOf = (p: string, needle: string) =>
  read(p)
    .split("\n")
    .findIndex((l) => l.includes(needle)) + 1;
const run = (cmd: string[]) => {
  const r = Bun.spawnSync(cmd, {
    cwd: repo.root,
    env: { ...process.env, GOTOOLCHAIN: "local", GOFLAGS: "-mod=mod", GOCACHE: join(int.home, "gocache-check") },
  });
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim().slice(0, 2000) };
};

async function spent(): Promise<number> {
  let usd = 0;
  for (const id of jobsSeen) usd += (await api<JobDetail>("GET", `/jobs/${id}`)).usage?.apiUsd ?? 0;
  return Math.round(usd * 1e6) / 1e6;
}
/** Stop the run before a job whose estimate (×1.5 slack) would cross the cap. */
async function capFor(est: JobEstimate, label: string): Promise<void> {
  const now = await spent();
  if (now + est.estimate.apiUsd * 1.5 > MAX_USD) throw new Error(`cap: ${label} would exceed $${MAX_USD} (spent $${now}, estimate $${est.estimate.apiUsd})`);
}

async function jobUntil(id: JobId, states: JobState[], ms = 300_000): Promise<JobDetail> {
  const t0 = Date.now();
  for (;;) {
    const j = await api<JobDetail>("GET", `/jobs/${id}`);
    if (states.includes(j.state)) return j;
    if (j.state === "failed" && !states.includes("failed")) throw new Error(`job ${id} failed: ${JSON.stringify(j.failure)}`);
    if (Date.now() - t0 > ms) throw new Error(`job ${id} stuck in ${j.state}`);
    await Bun.sleep(200);
  }
}

async function thread(path: string, start: number, end: number, body: string): Promise<ThreadDetail> {
  return api<ThreadDetail>("POST", "/threads", { anchor: { primary: "code", code: { path, start, end } }, intent: "change", body, draft: false });
}

async function dispatch(th: ThreadDetail, label: string, context?: unknown): Promise<{ est: JobEstimate; job: Job; createdAt: number }> {
  const req = { kind: "fix", threads: [th.id], ...(context ? { context } : {}) };
  const est = await api<JobEstimate>("POST", "/jobs/estimate", req);
  await capFor(est, label);
  const createdAt = Date.now();
  const job = await api<Job>("POST", "/jobs", { ...req, estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
  jobsSeen.add(job.id);
  return { est, job, createdAt };
}

/** The numbers of one job for the report. */
function facts(est: JobEstimate, j: JobDetail, createdAt: number) {
  const at = (phase: string) => j.events.find((e) => e.t === "phase" && e.phase === phase)?.at ?? null;
  const first = j.events.find((e) => e.t === "phase")?.at ?? null;
  return {
    id: j.id,
    state: j.state,
    route: { mode: j.route.mode, reason: j.route.reason, model: j.route.model },
    estimate: {
      in: est.estimate.inTokens,
      out: est.estimate.outTokens,
      usd: est.estimate.apiUsd,
      seconds: est.estimate.seconds,
      bundleTokens: est.bundle.tokens,
    },
    usage: j.usage,
    timings: j.timings,
    wallToReadyMs: first !== null ? (at("ready") ?? at("done") ?? 0) - first : null,
    sinceCreateMs: Date.now() - createdAt,
    attempt: j.attempt,
    repairs: j.events.filter((e) => e.t === "phase" && e.phase === "repair").map((e) => (e as { detail?: string }).detail),
    tools: j.events.filter((e) => e.t === "phase" && (e.phase === "read" || e.phase === "edit")).map((e) => (e as { detail?: string }).detail),
    gates: j.gates.map((g) => ({ gate: g.gate, status: g.status, ms: g.ms, sandboxed: g.sandboxed === true, excerpt: g.excerpt?.slice(0, 300) })),
    gateVerdict: j.gateVerdict,
    diff: j.diff.map((d) => ({ path: d.path, additions: d.additions, deletions: d.deletions, hunks: d.hunks.length })),
    writeScope: j.writeScope,
    failure: j.failure,
  };
}

/** Trust decisions need a browser session that is ≥ 60 s old (SEC-19): wait the rest, then trust every pending gate set. */
async function trustGates(): Promise<number> {
  const wait = sessionAt + 62_000 - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  const pending = (await api<TrustRequest[]>("GET", "/trust")).filter((t) => t.item === "gates" && t.status === "pending");
  for (const t of pending) await webApi("POST", `/trust/${t.id}`, { decision: "trusted" });
  return pending.length;
}

describe.if(LIVE && MAX_USD > 0)("INT-08 live: agent mode and parallel jobs with the real claude", () => {
  beforeAll(async () => {
    repo = await buildFixture("go-small");
    int = await startInt({ overrides: { gateSandbox: process.platform === "darwin" ? "sandbox-exec" : "none" } });
    ws = (await int.open(repo.root)).ws;
    web = await int.browser();
    sessionAt = Date.now();
    const engines = await int.json<EngineStatus[]>("GET", "/engines");
    const claude = engines.find((e) => e.engine === "claude-cli");
    report.engine = { version: claude?.version, auth: claude?.auth, billing: claude?.billing };
    // never on an API key (CLAUDE.md: a cost increase needs the user's approval)
    expect(claude?.installed).toBe(true);
    expect(claude?.auth).not.toBe("api-key");
  }, 120_000);
  afterAll(async () => {
    report.spentUsd = await spent().catch(() => null);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "measurements.json"), `${JSON.stringify(report, null, 2)}\n`);
    await int?.close();
    await repo?.dispose();
  });

  test("1. a cross-file Fix in agent mode: worktree, sandboxed gates, per-hunk accept (uncommitted), undo", async () => {
    const STORE = "internal/store/store.go";
    const MEMORY = "internal/store/memory.go";
    const SERVER = "internal/server/server.go";
    const original = { store: read(STORE), memory: read(MEMORY), server: read(SERVER) };
    const s = lineOf(STORE, "type Store interface");
    const th = await thread(STORE, s, s + 9, "Store に件数を返す Count(ctx) を追加して MemoryStore に実装し、/healthz の応答に books として件数を含めて");
    const h = lineOf(SERVER, "func (s *Server) health");
    const m = lineOf(MEMORY, "func (m *MemoryStore) Delete");
    const ctx = {
      add: [
        { path: SERVER, start: h, end: h + 2 },
        { path: MEMORY, start: m, end: m + 9 },
      ],
    };
    const { est, job, createdAt } = await dispatch(th, "agent fix", ctx);
    expect(est.route.mode).toBe("agent");
    let j = await jobUntil(job.id, ["ready", "done", "failed"]);
    const first = facts(est, j, createdAt);
    report.agent = { first };
    expect(j.state).toBe("ready");
    // the gates of a new workspace need trust: one set, one decision
    const trusted = await trustGates();
    const t0 = Date.now();
    await webApi("POST", `/jobs/${j.id}/gates/run`, {});
    j = await jobUntil(j.id, ["ready", "failed"]);
    report.agent = { first, trustedSets: trusted, afterGates: { ...facts(est, j, createdAt), gatesWallMs: Date.now() - t0 } };
    expect(j.state).toBe("ready");
    const hunks = Object.keys(j.hunkDecisions ?? {});
    const all = await raw("POST", `/jobs/${j.id}/accept`, { accept: "all" });
    expect(all.status).toBe(412); // agent jobs: no one-key accept
    const acceptT0 = Date.now();
    const res = await webApi<AcceptRes>("POST", `/jobs/${j.id}/accept`, { accept: hunks });
    const acceptMs = Date.now() - acceptT0;
    expect(res.kind).toBe("applied");
    const status = run(["git", "status", "--porcelain"]).out;
    const vet = run(["go", "vet", "./..."]);
    const testRun = run(["go", "test", "./..."]);
    const ck = (res as Extract<AcceptRes, { kind: "applied" }>).checkpoint.id;
    const undo = await api<UndoRes>("POST", `/checkpoints/${ck}/undo`, { force: false });
    const restored = read(STORE) === original.store && read(MEMORY) === original.memory && read(SERVER) === original.server;
    report.agent = {
      ...(report.agent as object),
      accept: { ms: acceptMs, files: (res as { files: string[] }).files, status, vet, test: testRun },
      undo: { diverged: undo.diverged, restored },
    };
    expect(vet.code).toBe(0);
    expect(restored).toBe(true);
  });

  test("2. two patch jobs in parallel on different files, then two on the same line (lock wait, accept conflict)", async () => {
    const CONFIG = "internal/config/config.go";
    const FETCH = "internal/meta/fetch.go";
    const lv = lineOf(CONFIG, 'level = "info"');
    const mr = lineOf(FETCH, "maxRetries");
    const a = await thread(CONFIG, lv - 2, lv + 1, "LOG_LEVEL が空のときの既定を warn にして");
    const b = await thread(FETCH, mr, mr + 1, "失敗した取得の再試行回数を 2 回にして");
    const [ja, jb] = await Promise.all([dispatch(a, "parallel a"), dispatch(b, "parallel b")]);
    const [ra, rb] = await Promise.all([jobUntil(ja.job.id, ["ready", "done", "failed"]), jobUntil(jb.job.id, ["ready", "done", "failed"])]);
    const overlap = (x: JobDetail, y: JobDetail): number => {
      const at = (j: JobDetail, phases: string[]): number => {
        const e = j.events.find((ev) => ev.t === "phase" && phases.includes(ev.phase));
        return e?.at ?? 0;
      };
      const [xs, xe, ys, ye] = [at(x, ["spawn"]), at(x, ["ready", "done"]), at(y, ["spawn"]), at(y, ["ready", "done"])];
      return Math.max(0, Math.min(xe, ye) - Math.max(xs, ys));
    };
    report.parallel = { a: facts(ja.est, ra, ja.createdAt), b: facts(jb.est, rb, jb.createdAt), overlapMs: overlap(ra, rb) };
    expect(ra.state).toBe("ready");
    expect(rb.state).toBe("ready");
    const accA = await webApi<AcceptRes>("POST", `/jobs/${ra.id}/accept`, { accept: "all" });
    const accB = await webApi<AcceptRes>("POST", `/jobs/${rb.id}/accept`, { accept: "all" });
    (report.parallel as Record<string, unknown>).accepted = [accA.kind, accB.kind, run(["git", "status", "--porcelain"]).out];
    for (const r of [accB, accA]) if (r.kind === "applied") await api("POST", `/checkpoints/${r.checkpoint.id}/undo`, { force: false });

    // the same line: the second waits for the first's lock, both become ready, the second accept conflicts
    const c = await thread(CONFIG, lv - 2, lv + 1, "LOG_LEVEL が空のときの既定を error にして");
    const d = await thread(CONFIG, lv - 2, lv + 1, "LOG_LEVEL が空のときの既定を debug にして");
    const jc = await dispatch(c, "same-line c");
    const jd = await dispatch(d, "same-line d");
    const waited: string[] = [];
    const watch = (async () => {
      for (let i = 0; i < 600; i++) {
        const x = await api<JobDetail>("GET", `/jobs/${jd.job.id}`);
        if (!waited.includes(x.state)) waited.push(x.state);
        if (["ready", "failed", "done"].includes(x.state)) return;
        await Bun.sleep(100);
      }
    })();
    const [rc, rd] = await Promise.all([jobUntil(jc.job.id, ["ready", "failed", "done"]), jobUntil(jd.job.id, ["ready", "failed", "done"])]);
    await watch;
    const accC = await webApi<AcceptRes>("POST", `/jobs/${rc.id}/accept`, { accept: "all" });
    const conflict = await raw("POST", `/jobs/${rd.id}/accept`, { accept: "all" });
    const conflictBody = await conflict.text();
    const afterConflict = await api<JobDetail>("GET", `/jobs/${rd.id}`);
    report.sameLine = {
      c: facts(jc.est, rc, jc.createdAt),
      d: facts(jd.est, rd, jd.createdAt),
      dStates: waited,
      secondAccept: { status: conflict.status, body: conflictBody.slice(0, 400), stateAfter: afterConflict.state },
      fileAfter: read(CONFIG).split("\n")[lv - 1],
    };
    expect(waited).toContain("waiting_lock");
    expect(conflict.status).toBe(409);
    expect(afterConflict.state).toBe("ready");
    await api("POST", `/jobs/${rd.id}/reject`, {});
    if (accC.kind === "applied") await api("POST", `/checkpoints/${accC.checkpoint.id}/undo`, { force: false });
  });
});
