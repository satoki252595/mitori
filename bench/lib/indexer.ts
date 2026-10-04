// The indexer exactly as the daemon composes it, for the idx.* bench cases (testing spec §6.3, indexer spec §11.2):
// @mitori/platform adapters (SQLite file DB in the run's home with the indexer migrations, the GitReader, fs, hasher)
// and the daemon's own parse Worker (`packages/server/src/workers/parse.ts`, wasm from the pinned assets) in the
// platform WorkerPool — the parts `apps/cli/src/daemon/server.ts` hands `createServer`, minus the HTTP / doc layers.
// Settings are the shipped defaults (`DEFAULT_GLOBAL_SETTINGS` through the server's own `resolveSettings`).
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import {
  createSecretScanner,
  type EventSink,
  type Logger,
  type MetricName,
  type Metrics,
  type SqlDb,
  type SseEventPayload,
  type WorkspaceInfo,
  type WorkspaceKey,
} from "@mitori/core";
import { createIndexer, INDEXER_MIGRATIONS, INVENTORY_SETS, type Indexer, type IndexerDeps } from "@mitori/indexer";
import { createFsReader, createGitReader, createHasher, createWorkerPool, openSqlDb, systemClock } from "@mitori/platform";
import { DEFAULT_GLOBAL_SETTINGS, resolveSettings } from "@mitori/server";
import { assetTable, GRAMMAR_LANGS, readPinned } from "../../apps/cli/src/build/assets.ts";

export interface BenchIndexer {
  idx: Indexer;
  db: SqlDb;
  /** Deterministic counters the indexer incremented (`idx.parse.calls`, `idx.files.hashed`, `idx.sql.writes`, …). */
  counters: Map<MetricName, number>;
  /** Every event the indexer emitted (scan.progress / scan.done / doc.freshness inputs). */
  events: SseEventPayload[];
  /** Parse Workers alive right now (all pools the indexer created). */
  workers(): number;
  /** Terminate every parse Worker now (what the pool's 60 s idle shrink should already have done). */
  shrinkWorkers(): Promise<void>;
  close(): Promise<void>;
}

export interface BenchIndexerOptions {
  /** Repository root (a git working tree, or a plain directory opened through a shadow repository). */
  root: string;
  /** Where the index database and (for shadow workspaces) the shadow repository live: the run's fresh home. */
  home: string;
  /** Open `root` as a shadow workspace (gostd: a plain directory, nothing written into it). */
  shadow?: boolean;
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

let parseInit: Promise<{ runtime: Uint8Array; grammars: Record<string, Uint8Array> }> | null = null;
/** The wasm the daemon sends every parse Worker (read once per process). */
function workerInit() {
  parseInit ??= (async () => {
    const t = assetTable();
    const grammars: Record<string, Uint8Array> = {};
    for (const g of GRAMMAR_LANGS) grammars[g] = await readPinned(`grammar.${g}`, t);
    return { runtime: await readPinned("treesitter.runtime", t), grammars };
  })();
  return parseInit;
}

/** `scripts/nd`'s git env, nothing of the user's global config (the shadow repo is mitori's own). */
function initShadow(root: string, gitDir: string): void {
  const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...argv: string[]) => {
    const r = Bun.spawnSync(["git", ...argv], { cwd: root, env, stdout: "ignore", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${argv[0]} (shadow) failed: ${r.stderr.toString()}`);
  };
  mkdirSync(join(gitDir, "info"), { recursive: true });
  writeFileSync(join(gitDir, "info/exclude"), `${INVENTORY_SETS.shadowExcludes.join("\n")}\n`);
  git("init", "--quiet", "--object-format=sha1");
  git("config", "core.untrackedCache", "true");
  git("config", "core.fsmonitor", "false");
  git("config", "core.quotepath", "off");
}

/** The single writer of a workspace DB (server `ws/queue.ts`): a promise chain, each slot in one IMMEDIATE transaction. */
function writeQueue(db: SqlDb): IndexerDeps["write"] {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(_label: string, fn: () => T): Promise<T> => {
    const run = tail.then(() => db.tx(fn));
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export async function benchIndexer(o: BenchIndexerOptions): Promise<BenchIndexer> {
  mkdirSync(o.home, { recursive: true });
  const kind: WorkspaceInfo["kind"] = o.shadow ? "shadow" : "git";
  const info: WorkspaceInfo = { key: "ws_bench00000000" as WorkspaceKey, root: o.root, kind, name: "bench", docDir: ".mitori", docCommitted: false };
  const gitDir = o.shadow ? join(o.home, "repos", info.key, "shadow.git") : undefined;
  if (gitDir) initShadow(o.root, gitDir);
  const db = openSqlDb(join(o.home, "index.sqlite"));
  db.tx(() => {
    for (const m of INDEXER_MIGRATIONS) db.exec(m.up);
  });
  const init = await workerInit();
  const parseWorker = new URL("../../packages/server/src/workers/parse.ts", import.meta.url).href;
  const counters = new Map<MetricName, number>();
  const pools: ReturnType<typeof createWorkerPool>[] = [];
  const metrics: Metrics = {
    inc: (n, k = 1) => counters.set(n, (counters.get(n) ?? 0) + k),
    observe() {},
  };
  const events: SseEventPayload[] = [];
  const sink: EventSink<SseEventPayload> = { emit: (e) => events.push(e) };
  const { repoParsed: _r, ...settings } = resolveSettings({
    global: DEFAULT_GLOBAL_SETTINGS,
    overrides: {},
    repoRaw: null,
    info,
    trust: () => "unknown",
    sandbox: "none",
  });
  const git = createGitReader({ workTree: o.root, ...(gitDir ? { gitDir } : {}), env: { PATH: process.env.PATH ?? "", HOME: o.home } });
  const idx = createIndexer({
    ws: info,
    db,
    write: writeQueue(db),
    git,
    fs: createFsReader(),
    hasher: createHasher(),
    log: silent,
    clock: systemClock,
    parsePool: (size) => {
      const pool = createWorkerPool({
        create: () => {
          const w = new Worker(parseWorker);
          w.postMessage({ type: "init", init });
          return w;
        },
        size,
      });
      pools.push(pool);
      return pool as never;
    },
    hardware: { cores: availableParallelism(), perfCores: null },
    settings: () => settings,
    events: sink,
    secrets: createSecretScanner(),
    calibration: () => ({ kindFactor: () => 1, version: 0 }),
    calibrationSink: () => undefined,
    seeds: () => [],
    metrics,
  });
  return {
    idx,
    db,
    counters,
    events,
    workers: () => pools.reduce((n, p) => n + p.size(), 0),
    async shrinkWorkers() {
      await Promise.all(pools.map((p) => p.shrink(0)));
    },
    async close() {
      await idx.close();
      await git.close();
      db.close();
    },
  };
}

/** Wait until the background persistence after `scan.done` finished (it is not part of the scan's wall time). */
export async function settled(idx: Indexer, timeoutMs = 60_000): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const t = idx.lastTimings();
    if (t && t.persist !== null) return;
    await Bun.sleep(10);
  }
  throw new Error("the indexer's background persistence did not finish");
}

/** Peak RSS sampler (testing spec §6.2: `process.memoryUsage().rss` every 10 ms; Workers are threads of this process). */
export function rssSampler(): { stop(): number } {
  let peak = process.memoryUsage().rss;
  const iv = setInterval(() => {
    const v = process.memoryUsage().rss;
    if (v > peak) peak = v;
  }, 10);
  return {
    stop() {
      clearInterval(iv);
      return Math.max(peak, process.memoryUsage().rss);
    },
  };
}
