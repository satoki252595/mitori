/**
 * `bunfig.toml [test] preload` (testing spec §1.5): isolation every test file gets before it runs.
 * Enabling it is a root change (architect): `[test] preload = ["./packages/testkit/src/preload.ts"]` — see
 * docs/design/cr-requests/WP-12.md. Until then run it explicitly: `bun test --preload ./packages/testkit/src/preload.ts`.
 *
 *   1. `__MITORI_TEST__` and `MITORI_TEST=1`          5. network guard (loopback only, `MITORI_TEST_NET=1` lifts it)
 *   2. TZ=UTC, LANG/LC_ALL=C.UTF-8                    6. spawn guard: `claude` / `codex` on PATH exit 97, and every hit
 *   3. MITORI_HOME sentinel                              fails the run (`agent.spawns.real` = 0, AC-5)
 *   4. git isolation (identity, clock, no global cfg) 7. MITORI_TEST_SEED (default 20261003)
 *                                                     8. unhandled rejections and console.error fail the run
 */
import { afterAll } from "bun:test";
import { createRecordingGuard, type RecordingGuard } from "./home/guard.ts";
import { DEFAULT_SEED, GIT_TEST_ENV, guardedPath } from "./home/home.ts";

declare global {
  var __MITORI_TEST__: boolean | undefined;
}

globalThis.__MITORI_TEST__ = true;
const env = process.env;
env.MITORI_TEST = "1";
env.TZ = "UTC";
env.LANG = "C.UTF-8";
env.LC_ALL = "C.UTF-8";
// a sentinel: code that resolves ~/.mitori without createTestHome() fails at once instead of touching the user's home
env.MITORI_HOME = "/nonexistent/mitori-home-not-set";
Object.assign(env, GIT_TEST_ENV);
env.MITORI_TEST_SEED ??= DEFAULT_SEED;
// a recording copy of the guard per run: children of children still find it on PATH, whatever env allowlist they get
const live = env.MITORI_LIVE === "1";
const spawnGuard: RecordingGuard | null = live ? null : createRecordingGuard();
if (spawnGuard) env.MITORI_SPAWN_GUARD_DIR = spawnGuard.dir;
env.PATH = guardedPath(env.PATH, live, spawnGuard?.dir);

/* ------------------------------------------------------------------ network guard */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function assertLocal(input: string | URL | Request): void {
  let host: string;
  try {
    host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname;
  } catch {
    return; // not an absolute URL: nothing to connect to
  }
  if (!LOOPBACK.has(host)) throw new Error(`network blocked in tests: ${host} (MITORI_TEST_NET=1 for contract, live and eval suites)`);
}

if (env.MITORI_TEST_NET !== "1") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => {
    try {
      assertLocal(input);
    } catch (err) {
      return Promise.reject(err);
    }
    return realFetch(input as never, init);
  }, realFetch) as typeof fetch;

  const RealWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      assertLocal(url);
      super(url, protocols);
    }
  } as typeof WebSocket;
}

/* ------------------------------------------------------------- noisy failures (#8) */

const problems: string[] = [];
process.on("unhandledRejection", (reason) => {
  problems.push(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});
const realError = console.error;
console.error = (...args: unknown[]) => {
  problems.push(`console.error: ${args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(" ")}`);
  realError(...args);
};

// a preload's afterAll runs once, after the last test file
afterAll(() => {
  const hits = spawnGuard?.hits() ?? [];
  spawnGuard?.dispose();
  if (hits.length > 0) problems.push(`agent.spawns.real = ${hits.length} (the spawn guard refused: ${hits.slice(0, 3).join(" | ")})`);
  if (problems.length === 0) return;
  const list = problems.splice(0).map((p) => `  - ${p.split("\n")[0]}`);
  throw new Error(`${list.length} problem(s) during this test run (unhandled rejections, console.error, real LLM CLI spawns):\n${list.join("\n")}`);
});
