// srv.* — daemon budgets (server spec §1.4, bench/budgets/server.json):
// - srv.rss.idleEmpty / srv.rss.idleLoaded: the shipped CLI daemon as its own process (the compiled binary when dist/
//   holds a current one, else `bun apps/cli/src/main.ts`, which carries the transpiler: the result says which), idle, its
//   memory read from the OS (CR m1-117: macOS phys_footprint, otherwise ps RSS). Loaded = a copy of crit
//   (100k LOC class) opened and scanned, then 60 s idle (PT-14). Both macOS values are kept in stderr evidence.
// - srv.sse.p99: 200 SSE clients in their own thread (packages/server/src/sse/test/sse-clients.worker.ts), the hub's
//   publish → arrival latency, p99 of one round of 40 events per run (the SSE int test now asserts delivery, not time).
// - srv.ttfb.shell / srv.ttfb.health (no budget of their own; ui.shellPaint is the user-facing one): time to the first
//   response byte of `GET /` and `GET /api/v1/health` on a warm in-process daemon.
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SseEventPayload, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo, startTestDaemon, type TestDaemon } from "@mitori/testkit";
import { footprint } from "../packages/indexer/src/update/test/footprint.ts";
import { type Harness, startHarness } from "../packages/server/src/http/test/harness.ts";
import { type Int, startInt } from "../test/int/harness.ts";
import { REPO_ROOT, scratch } from "./lib/child.ts";
import { type BenchContext, defineBench } from "./runner/define.ts";

const BIN = join(REPO_ROOT, `dist/mitori-${process.platform}-${process.arch}`);
/** "compiled" when dist/ holds a binary at least as new as the CLI entry, else "source". */
const binary = (): "compiled" | "source" =>
  existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(join(REPO_ROOT, "apps/cli/src/main.ts")).mtimeMs ? "compiled" : "source";

/** CR m1-117 idle memory in MB (2^20); do not fall back to a different metric on macOS. */
function rssMB(pid: number): number {
  const r = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
  const kb = Number(r.stdout.toString().trim());
  if (!Number.isFinite(kb) || kb <= 0) throw new Error(`no RSS for pid ${pid}`);
  if (process.platform === "darwin") {
    const f = footprint(pid);
    if (!f) throw new Error(`no physical footprint for pid ${pid}`);
    console.error(JSON.stringify({ memory: "darwin", pid, residentMB: kb / 1024, footprintMB: f.footprint / 1_048_576 }));
    return f.footprint / 1_048_576;
  }
  return kb / 1024;
}

async function pidOf(d: TestDaemon): Promise<number> {
  const h = (await (await fetch(`${d.url}/api/v1/health`)).json()) as { pid?: number };
  if (!h.pid) throw new Error("the daemon's health has no pid");
  return h.pid;
}

/** The daemon's registry (`$MITORI_HOME/daemon.json`): the CLI's bearer token (the printed URL carries a login nonce). */
const registry = (d: TestDaemon): { token: string; pid: number } => JSON.parse(readFileSync(join(d.home.dir, "daemon.json"), "utf8"));

async function waitReady(d: TestDaemon, timeoutMs = 120_000): Promise<void> {
  const end = performance.now() + timeoutMs;
  const auth = { authorization: `Bearer ${registry(d).token}`, "x-mitori-client": "cli/bench" };
  while (performance.now() < end) {
    const list = (await (await fetch(`${d.url}/api/v1/workspaces`, { headers: auth })).json()) as
      | { items?: { info: { key: WorkspaceKey } }[] }
      | { info: { key: WorkspaceKey } }[];
    const items = Array.isArray(list) ? list : (list.items ?? []);
    const key = items[0]?.info.key;
    if (key) {
      const st = (await (await fetch(`${d.url}/api/v1/ws/${key}`, { headers: auth })).json()) as { state?: string };
      if (st.state === "ready") return;
      if (st.state === "error") throw new Error("the workspace failed to open");
    }
    await Bun.sleep(100);
  }
  throw new Error("the workspace did not become ready");
}

const idleMs = (name: string, fallback: number): number => Number(process.env[name] ?? fallback);

export const rssIdleEmpty = defineBench({
  id: "srv.rss.idleEmpty",
  suite: "srv",
  mode: "process",
  unit: "MB",
  runs: 3,
  warmup: 0,
  async run() {
    const d = await startTestDaemon({ binary: binary() });
    try {
      const pid = await pidOf(d);
      await Bun.sleep(idleMs("MITORI_BENCH_IDLE_EMPTY_MS", 15_000));
      return rssMB(pid);
    } finally {
      await d.stop();
    }
  },
});

/** A copy of crit (opening a workspace writes its .mitori/ doc into it: the pinned corpus stays untouched). */
export const rssIdleLoaded = defineBench({
  id: "srv.rss.idleLoaded",
  suite: "srv",
  mode: "process",
  unit: "MB",
  repo: "crit",
  runs: 1,
  warmup: 0,
  async run(_s, ctx: BenchContext) {
    if (!ctx.repo) throw new Error("crit is not resolved");
    const copy = scratch("srv-crit");
    const root = join(copy.dir, "crit");
    cpSync(ctx.repo, root, { recursive: true, verbatimSymlinks: true });
    const d = await startTestDaemon({ binary: binary(), repoPath: root });
    try {
      await waitReady(d);
      const pid = await pidOf(d);
      await Bun.sleep(idleMs("MITORI_BENCH_IDLE_LOADED_MS", 60_000));
      return rssMB(pid);
    } finally {
      await d.stop();
      copy.dispose();
    }
  },
});

/* ------------------------------------------------------------------------------------------ spawn → health */

/**
 * MILESTONES WP-00 acceptance (SKEL-AT-01): `mitori <go-small> --no-open`, started from a directory without
 * node_modules, answers `GET /api/v1/health` within 1 s of the spawn. The skeleton test checks that it answers (a
 * generous deadline); the time is this case, load-gated like every time budget. The compiled binary only — the
 * acceptance is about the shipped artifact. Every run: a fresh copy of go-small and a fresh MITORI_HOME (cold).
 */
export const binHealth = defineBench<{ src: FixtureRepo }>({
  id: "bin.health",
  suite: "srv",
  mode: "process",
  runs: 5,
  async setup() {
    if (binary() !== "compiled") throw new Error(`${BIN} is missing or older than apps/cli/src/main.ts (bun run build:bin)`);
    return { src: await buildFixture("go-small") };
  },
  async run(s, ctx) {
    const work = scratch("bin-health");
    const root = join(work.dir, "go-small");
    cpSync(s.src.root, root, { recursive: true, verbatimSymlinks: true });
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: work.dir, MITORI_HOME: ctx.home };
    const t0 = performance.now();
    const proc = Bun.spawn([BIN, root, "--no-open"], { cwd: work.dir, env, stdout: "pipe", stderr: "pipe" });
    const stderr = new Response(proc.stderr).text(); // drained from the start: a full pipe would stall the daemon
    try {
      const reader = proc.stdout.getReader();
      let out = "";
      let origin: string | undefined;
      while (!origin) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`mitori exited before printing its URL: ${(await stderr).slice(-300)}`);
        out += new TextDecoder().decode(value);
        origin = /http:\/\/127\.0\.0\.1:\d+/.exec(out)?.[0];
      }
      const res = await fetch(`${origin}/api/v1/health`);
      const ms = performance.now() - t0;
      if (!res.ok) throw new Error(`GET /api/v1/health answered ${res.status}`);
      return ms;
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
      work.dispose();
    }
  },
  teardown: (s) => s.src.dispose(),
});

/* ---------------------------------------------------------------------------------------------------- SSE */

const WARM = 10;
const N = 40;
const removed = (id: string): SseEventPayload => ({ type: "thread.removed", id: `th_${id}` as never });

export const sseP99 = defineBench<{ h: Harness; ws: WorkspaceKey; auth: string; seq: number }>({
  id: "srv.sse.p99",
  suite: "srv",
  mode: "inproc",
  runs: 5,
  warmup: 1,
  async setup() {
    const h = await startHarness();
    const ws = await h.openProject("a");
    return { h, ws, auth: `Mitori-Session ${(await h.browser()).token}`, seq: 0 };
  },
  async run(s) {
    const worker = new Worker(join(REPO_ROOT, "packages/server/src/sse/test/sse-clients.worker.ts"));
    const message = (kind: string) =>
      new Promise<{ kind: string; arrivals?: number[][] }>((resolve) => {
        const on = (e: MessageEvent<{ kind: string; arrivals?: number[][] }>) => {
          if (e.data.kind !== kind) return;
          worker.removeEventListener("message", on);
          resolve(e.data);
        };
        worker.addEventListener("message", on);
      });
    try {
      const ready = message("ready");
      worker.postMessage({ origin: s.h.origin, auth: s.auth, query: `?ws=${s.ws}`, connections: 200, expect: WARM + N });
      await ready;
      const done = message("done");
      const publishedAt: number[] = [];
      for (let i = 0; i < WARM + N; i++) {
        publishedAt.push(performance.timeOrigin + performance.now());
        s.h.daemon.services.hub.publish(removed(`b${String(s.seq++).padStart(7, "0")}`), s.ws, s.seq);
        await Bun.sleep(10);
      }
      const { arrivals = [] } = await done;
      const lat = arrivals.flatMap((times) => times.slice(WARM, WARM + N).map((t, i) => t - (publishedAt[WARM + i] as number))).sort((a, b) => a - b);
      if (lat.length !== 200 * N) throw new Error(`SSE lost events: ${lat.length} of ${200 * N} arrivals`);
      return lat[Math.floor(lat.length * 0.99)] as number;
    } finally {
      worker.terminate();
    }
  },
  teardown: (s) => s.h.close(),
});

/* ---------------------------------------------------------------------------------------------------- TTFB */

/** Time to the first body byte of a GET (headers + first chunk), ms. */
async function ttfb(url: string): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(url);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  const ms = performance.now() - t0;
  await reader.cancel();
  return ms;
}

export const ttfbShell = defineBench<{ int: Int }>({
  id: "srv.ttfb.shell",
  suite: "srv",
  mode: "inproc",
  runs: 30,
  setup: async () => ({ int: await startInt() }),
  run: (s) => ttfb(`${s.int.origin}/`),
  teardown: (s) => s.int.close(),
});

export const ttfbHealth = defineBench<{ int: Int }>({
  id: "srv.ttfb.health",
  suite: "srv",
  mode: "inproc",
  runs: 30,
  setup: async () => ({ int: await startInt() }),
  run: (s) => ttfb(`${s.int.origin}/api/v1/health`),
  teardown: (s) => s.int.close(),
});
