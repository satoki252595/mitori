/**
 * The real daemon (written by WP-INT, owned by WP-11 since CR m1-9): builds `ServerDeps` from `@mitori/platform`
 * adapters, the embedded assets and the Worker pools, then hands them to the composition root (`@mitori/server`
 * `createServer`, which runs the state migrations of every package — CR m0-14 is done there).
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createSecretScanner, type HealthRes, MitoriError, type WorkspaceInfo } from "@mitori/core";
import {
  createFsReader,
  createFsWatcher,
  createGitReader,
  createHasher,
  createLogger,
  createMetrics,
  createSafeWriter,
  createSelfWriteLog,
  createSpawner,
  createWorkerPool,
  cryptoRandom,
  detectGateSandbox,
  hardwareInfo,
  openLogFile,
  openSqlDb,
  resolveSafePath,
  systemClock,
} from "@mitori/platform";
import { createServer, type ServerDeps, type ServerHandle, withPrecompiled } from "@mitori/server";
import { type AssetTable, assetTable, GRAMMAR_LANGS, loadInitialUiRenderer, loadWebAssets, pinnedScriptUrl, readPinned } from "../build/assets.ts";
import { materializeWindowsJob } from "../build/windows-job.ts";
import { viewerBundle } from "../commands/export-assets.ts";
import { createElkPool } from "./elk.ts";

export interface ServerDaemonOptions {
  /** `~/.mitori` (created 0700 by the caller). */
  home: string;
  /** Preferred port (0 = previous one, else OS-assigned). */
  port: number;
  version: string;
  build: HealthRes["build"];
  /** Replace parts of the deps (tests: a fake spawner, a log sink). */
  overrides?: Partial<ServerDeps>;
  /** Log to stderr instead of `~/.mitori/logs/`. */
  logToStderr?: boolean;
}

export interface ServerDaemon {
  handle: ServerHandle;
  port: number;
  url: string;
  /** Bearer token (registry). */
  token: string;
  /** Resolves with the reason once the daemon stopped (signal, idle exit, `POST /daemon/shutdown`). */
  stopped: Promise<string>;
  stop(reason?: string): Promise<void>;
}

/** Worker factory that posts the init message first (`packages/server/src/workers/protocol.ts`). */
const withInit = (spec: string, init: unknown) => () => {
  const w = new Worker(spec);
  w.postMessage({ type: "init", init });
  return w;
};

async function parseInit(t: AssetTable) {
  const grammars: Record<string, Uint8Array> = {};
  for (const g of GRAMMAR_LANGS) grammars[g] = await readPinned(`grammar.${g}`, t);
  return withPrecompiled({ runtime: await readPinned("treesitter.runtime", t), grammars });
}

/** Realpath of `p`, or `p` itself. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * mitori's own executable for the hook / `.mcp.json` templates (`{mitoriBin}`, SEC-21): the compiled binary's realpath;
 * from a source checkout (`bun apps/cli/src/main.ts`) the `mitori` on PATH, else the bare name.
 */
export function mitoriBinary(path: string): string {
  if (Bun.isStandaloneExecutable) return real(process.execPath);
  const onPath = Bun.which("mitori", { PATH: path });
  return onPath ? real(onPath) : "mitori";
}

export async function startServerDaemon(o: ServerDaemonOptions): Promise<ServerDaemon> {
  const t = assetTable();
  const clock = systemClock;
  const selfWrites = createSelfWriteLog();
  const safeWrite = createSafeWriter({ selfWrites, random: cryptoRandom });
  const fs = createFsReader();
  const safePath = resolveSafePath(process.env.PATH ?? "", { workspaceRoots: [], startCwd: process.cwd() });
  const sink = o.logToStderr ? (line: string) => process.stderr.write(`${line}\n`) : openLogFile({ dir: `${o.home}/logs`, clock }).write;
  const log = createLogger({ sink, clock, level: process.env.MITORI_LOG === "debug" ? "debug" : "info" });
  const [init, onig, assets] = await Promise.all([parseInit(t), readPinned("shiki.onig", t), loadWebAssets(t)]);
  const uiRenderer = await loadInitialUiRenderer(t);
  const userHome = homedir();
  // remote-readonly clones (`mitori <github-url>`) need `gh` on SAFE_PATH; without it GitHub targets are refused
  const gh = Bun.which("gh", { PATH: safePath });
  const windowsJobLauncher = process.platform === "win32" ? await materializeWindowsJob(o.home, safeWrite, t) : undefined;
  const deps: ServerDeps = {
    home: o.home,
    version: o.version,
    pid: process.pid,
    userHome,
    port: o.port,
    // F2 / CR m1-119: the machine's gate sandbox (macOS sandbox-exec, Linux bwrap), so typecheck / test / lint gates run
    // without a click. CR m1-116: `hardwareInfo()` (WP-01) replaces the hardware default.
    gateSandbox: detectGateSandbox(safePath),
    hardware: hardwareInfo(),
    ...(gh ? { gh: real(gh) } : {}),
    build: o.build,
    clock,
    random: cryptoRandom,
    hasher: createHasher(),
    log,
    metrics: createMetrics(),
    openDb: (path) => openSqlDb(path),
    spawner: createSpawner({ safePath, ...(windowsJobLauncher ? { windowsJobLauncher } : {}) }),
    fs,
    safeWrite,
    watcher: createFsWatcher({ selfWrites }),
    git: (info: WorkspaceInfo) =>
      createGitReader({
        workTree: info.root,
        ...(info.kind === "shadow" ? { gitDir: `${o.home}/repos/${info.key}/shadow.git` } : {}),
        env: { PATH: safePath, HOME: userHome },
      }),
    pools: {
      parse: (size) => createWorkerPool({ create: withInit(t.workers.serverParse, init), size }),
      elk: createElkPool(() => pinnedScriptUrl("elk.worker", t)) as ServerDeps["pools"]["elk"],
      compute: createWorkerPool({ create: withInit(t.workers.serverCompute, { onig }), size: 1, keepWarm: 1 }),
    },
    secrets: createSecretScanner(),
    assets,
    viewerAssets: viewerBundle(assets),
    ...(uiRenderer ? { uiRenderer } : {}),
    safePath,
    env: process.env,
    mitoriBin: mitoriBinary(process.env.PATH ?? ""),
    ...o.overrides,
  };
  let handle: ServerHandle;
  try {
    handle = await createServer(deps);
  } catch (err) {
    await Promise.allSettled([deps.pools.compute.close(), deps.pools.elk.close()]);
    throw err;
  }
  const ext = handle as ServerHandle & { url: string; token: string; stopped: Promise<string> };
  if (!ext.url) throw new MitoriError("E_INTERNAL", "createServer returned no url");
  return { handle, port: handle.port, url: ext.url, token: ext.token, stopped: ext.stopped, stop: (reason = "requested") => handle.stop(reason) };
}
