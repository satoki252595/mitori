// `startTestDaemon` (testing spec §5.1): the daemon as a subprocess for e2e and eval — from source (`bun apps/cli/src/main.ts`)
// or the compiled binary — with an isolated MITORI_HOME, an optional fixture repo and cassette replay switched on.
// The walking skeleton (M0.5) prints its URL and nothing else; the fields that need the real daemon (`/__test/*` routes, the
// bearer token, nonce login) are best-effort and become exact when the composition root (WP-INT) lands.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MitoriError } from "@mitori/core";
import { OBSERVERS_SOURCE } from "../browser/observers.ts";
import type { PwPage } from "../browser/page.ts";
import type { FixtureName, FixtureRepo, PageLike, TestDaemon, TestMetricName } from "../contract.ts";
import { buildFixture } from "../fixtures/index.ts";
import { REPO_ROOT, safeName } from "../fixtures/spec.ts";
import { createTestHome } from "../home/index.ts";

export interface DaemonOptions {
  fixture?: FixtureName;
  repoPath?: string;
  seedDoc?: "none" | "static" | "generated";
  cassetteDirs?: readonly string[];
  scenario?: Readonly<Record<string, string>>;
  speed?: number;
  maxDtMs?: number;
  binary?: "source" | "compiled";
  env?: Readonly<Record<string, string>>;
}

const URL_LINE = /https?:\/\/127\.0\.0\.1:\d+\/?\S*/;
const START_TIMEOUT_MS = 15_000;
const STOP_KILL_AFTER_MS = 10_000;

/** argv of the CLI for the chosen binary: `[exe, ...prefix]`. */
function cliArgv(binary: "source" | "compiled"): string[] {
  if (binary === "compiled") {
    const exe = join(REPO_ROOT, `dist/mitori-${process.platform}-${process.arch}`);
    if (!existsSync(exe)) throw new MitoriError("E_NOT_FOUND", `${exe} does not exist — run \`bun run build:bin\``);
    return [exe];
  }
  return ["bun", "--preload", join(REPO_ROOT, "packages/testkit/src/server/test-flag.ts"), join(REPO_ROOT, "apps/cli/src/main.ts")];
}

function run(argv: readonly string[], opts: { cwd: string; env: Record<string, string>; stdin?: string }) {
  const [exe, ...args] = argv as [string, ...string[]];
  const child = spawn(exe, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    stdout += d;
  });
  child.stderr.setEncoding("utf8").on("data", (d: string) => {
    stderr += d;
  });
  if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
  else child.stdin.end();
  const exited = new Promise<number>((resolve) => child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1))));
  return { child, out: () => stdout, err: () => stderr, exited };
}

export async function startDaemon(opts: DaemonOptions): Promise<TestDaemon> {
  const home = await createTestHome();
  let repo: FixtureRepo | undefined;
  const cleanup = async () => {
    await home.cleanup();
    await repo?.dispose();
  };
  try {
    if (opts.fixture && opts.repoPath) throw new MitoriError("E_INVALID_INPUT", "startTestDaemon: pass either `fixture` or `repoPath`");
    if (opts.fixture) repo = await buildFixture(opts.fixture);
    const root = repo?.root ?? opts.repoPath;
    if (opts.seedDoc && opts.seedDoc !== "none") {
      // the golden doc of the fixture (`doc-static/` or `doc-generated/`) becomes the repo's `.mitori/`
      if (!opts.fixture || !root) throw new MitoriError("E_INVALID_INPUT", "startTestDaemon: seedDoc needs a `fixture` (its golden doc is the seed)");
      const from = join(REPO_ROOT, "fixtures/golden", safeName(opts.fixture), opts.seedDoc === "static" ? "doc-static" : "doc-generated");
      if (!existsSync(from)) throw new MitoriError("E_NOT_FOUND", `seedDoc "${opts.seedDoc}": ${from} does not exist (goldens arrive with WP-04 / WP-06)`);
      cpSync(from, join(root, ".mitori"), { recursive: true });
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...home.env, ...opts.env };
    const argv = cliArgv(opts.binary ?? "source");
    const start = run([...argv, ...(root ? [root, "--no-open"] : ["_serve"])], { cwd: root ?? home.dir, env });

    const printed = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new MitoriError("E_INTERNAL", `the daemon printed no URL within ${START_TIMEOUT_MS} ms\n${start.out()}${start.err()}`)),
        START_TIMEOUT_MS,
      );
      const poll = setInterval(() => {
        const m = URL_LINE.exec(start.out());
        if (m) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve(m[0]);
        }
      }, 10);
      start.exited.then((code) => {
        clearTimeout(timer);
        clearInterval(poll);
        reject(new MitoriError("E_INTERNAL", `the daemon exited with ${code} before printing a URL\n${start.out()}${start.err()}`));
      });
    });

    const u = new URL(printed);
    const url = `${u.protocol}//${u.host}`;
    const token = u.hash.replace(/^#(?:nonce=)?/, "");
    const bearer = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

    const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
      fetch(`${url}${path}`, { ...init, headers: { ...bearer(), ...(init.headers as Record<string, string> | undefined) } });

    if (opts.cassetteDirs) {
      const res = await api("/__test/engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cassetteDirs: opts.cassetteDirs,
          speed: opts.speed ?? 1,
          maxDtMs: opts.maxDtMs ?? 200,
          ...(opts.scenario ? { scenario: opts.scenario } : {}),
        }),
      });
      // the skeleton has no test routes (404): replay then simply is not wired yet
      if (!res.ok && res.status !== 404) throw new MitoriError("E_INTERNAL", `POST /__test/engine answered ${res.status}`);
    }

    let stopped = false;
    return {
      url,
      token,
      home,
      ...(repo ? { repo } : {}),
      async login(page: PageLike, path = "/") {
        const p = page as Partial<PwPage> & PageLike;
        // collectors must exist before the first script of the document runs (buffered observers miss fast interactions otherwise)
        await p.addInitScript?.(OBSERVERS_SOURCE);
        await p.goto(printed);
        if (path !== "/" && path !== "") await p.goto(`${url}${path}`);
      },
      async cli(args, o) {
        const t0 = performance.now();
        const r = run([...argv, ...args], { cwd: o?.cwd ?? root ?? home.dir, env, ...(o?.stdin !== undefined ? { stdin: o.stdin } : {}) });
        const timeout = setTimeout(() => r.child.kill("SIGKILL"), o?.timeoutMs ?? 30_000);
        const code = await r.exited;
        clearTimeout(timeout);
        return { code, stdout: r.out(), stderr: r.err(), ms: performance.now() - t0 };
      },
      spawnCli(args, o) {
        const r = run([...argv, ...args], { cwd: o?.cwd ?? root ?? home.dir, env });
        return { stdout: r.out, stderr: r.err, exited: r.exited, kill: () => void r.child.kill("SIGTERM") };
      },
      async metrics() {
        const res = await api("/__test/metrics");
        // the skeleton answers unknown paths with its SPA shell (HTML 200): only JSON is a metrics document
        return res.ok && (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as Partial<Record<TestMetricName, number>>) : {};
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        start.child.kill("SIGTERM");
        const killer = setTimeout(() => start.child.kill("SIGKILL"), STOP_KILL_AFTER_MS);
        await start.exited;
        clearTimeout(killer);
        await cleanup();
      },
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
