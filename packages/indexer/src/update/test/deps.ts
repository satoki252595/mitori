// Test-only IndexerDeps: bun:sqlite, a serial write queue, the git CLI, node:fs, Bun hashes, an in-thread WorkerPool
// (or real Bun Workers for the bench), collecting event / metric sinks. Swap for @mitori/platform/testing once WP-01
// lands.
import { Database } from "bun:sqlite";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import {
  createSecretScanner,
  DEFAULT_DENY_GLOBS,
  type EffectiveSettings,
  type FsReader,
  type Logger,
  type MetricName,
  type SqlDb,
  type SseEventPayload,
  type WorkerPool,
  type WorkspaceInfo,
} from "@mitori/core";
import type { CalibrationSample, IndexerDeps, ParseBatchRequest, ParseBatchResponse } from "../../contract.ts";
import { env, hasher, workerInit } from "../../parse/test/env.ts";
import { createWorkerHandler, type WorkerHandlerImpl } from "../../parse/worker.ts";
import { INDEXER_MIGRATIONS } from "../index.ts";
import { cliGit, type TestGit } from "./git.ts";

export function memoryDb(path = ":memory:"): SqlDb & { raw: Database } {
  const d = new Database(path, { strict: true, safeIntegers: false });
  d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  let depth = 0;
  return {
    raw: d,
    exec: (sql) => d.exec(sql),
    run: (sql, params) => {
      const r = d.query(sql).run(...((params ?? []) as never[]));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params?: unknown) => d.query(sql).all(...((params ?? []) as never[])) as T[],
    get: <T>(sql: string, params?: unknown) => (d.query(sql).get(...((params ?? []) as never[])) as T | undefined) ?? null,
    tx<T>(fn: () => T): T {
      if (depth > 0) {
        d.exec(`SAVEPOINT sp${depth}`);
        depth++;
        try {
          const r = fn();
          depth--;
          d.exec(`RELEASE sp${depth}`);
          return r;
        } catch (e) {
          depth--;
          d.exec(`ROLLBACK TO sp${depth}`);
          throw e;
        }
      }
      d.exec("BEGIN IMMEDIATE");
      depth = 1;
      try {
        const r = fn();
        d.exec("COMMIT");
        return r;
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      } finally {
        depth = 0;
      }
    },
    close: () => d.close(),
  };
}

export function migrate(db: SqlDb): void {
  for (const m of INDEXER_MIGRATIONS) db.exec(m.up);
}

export function nodeFs(reads?: string[]): FsReader {
  return {
    stat(abs) {
      try {
        const s = lstatSync(abs, { bigint: true });
        return { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: s.isSymbolicLink() };
      } catch {
        return null;
      }
    },
    async read(abs) {
      reads?.push(abs);
      return readFileSync(abs);
    },
    async readHead(abs, n) {
      reads?.push(abs);
      return readFileSync(abs).subarray(0, n);
    },
    realpath(abs) {
      try {
        return realpathSync(abs);
      } catch {
        return null;
      }
    },
    readdir(abs) {
      try {
        return readdirSync(abs);
      } catch {
        return null;
      }
    },
  };
}

const noopLog: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => noopLog };

/** In-thread pool: one handler, `size` is bookkeeping only (tests). */
export function inlinePool(
  handler: Promise<WorkerHandlerImpl> = createWorkerHandler(env, workerInit()),
): (n: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse> & { handler: Promise<WorkerHandlerImpl> } {
  return (n) => {
    let size = n;
    let chain: Promise<unknown> = Promise.resolve();
    return {
      handler,
      run(req) {
        const next = chain.then(async () => (await handler).handle(req));
        chain = next.catch(() => undefined);
        return next;
      },
      size: () => size,
      async resize(k) {
        size = k;
      },
      async shrink(keep = 0) {
        size = Math.min(size, keep);
      },
      async close() {
        size = 0;
      },
    };
  };
}

export function settings(over: Partial<{ deny: string[]; include: string[]; exclude: string[]; secretScan: boolean }> = {}): EffectiveSettings {
  return {
    global: { security: { denyGlobs: [], secretScan: over.secretScan ?? true, allowNonLoopback: false, gateSandbox: "auto" } },
    repo: { schemaVersion: 1, include: over.include ?? [], exclude: over.exclude ?? [] },
    overrides: {},
    ignoredRepoKeys: [],
    denyGlobs: over.deny ?? [...DEFAULT_DENY_GLOBS],
  } as unknown as EffectiveSettings;
}

export interface TestDeps extends IndexerDeps {
  events: { emit(e: SseEventPayload): void; list: SseEventPayload[] };
  counters: Map<MetricName, number>;
  reads: string[];
  samples: CalibrationSample[];
  git: TestGit;
}

export function testDeps(
  root: string,
  opts: { git?: TestGit; db?: SqlDb; pool?: IndexerDeps["parsePool"]; kind?: WorkspaceInfo["kind"]; settings?: () => EffectiveSettings } = {},
): TestDeps {
  const db = opts.db ?? memoryDb();
  if (opts.db === undefined) migrate(db);
  let queue: Promise<unknown> = Promise.resolve();
  const counters = new Map<MetricName, number>();
  const list: SseEventPayload[] = [];
  const reads: string[] = [];
  const samples: CalibrationSample[] = [];
  const s = settings();
  return {
    ws: { key: "ws_test", root, kind: opts.kind ?? "git", name: "test", docDir: ".mitori", docCommitted: false },
    db,
    write: <T>(_label: string, fn: () => T) => {
      const next = queue.then(fn);
      queue = next.catch(() => undefined);
      return next;
    },
    git: opts.git ?? cliGit(root),
    fs: nodeFs(reads),
    hasher,
    log: noopLog,
    clock: { now: () => Date.now(), iso: () => new Date().toISOString() },
    parsePool: opts.pool ?? inlinePool(),
    hardware: { cores: availableParallelism(), perfCores: 6 },
    settings: opts.settings ?? (() => s),
    events: { emit: (e) => list.push(e), list },
    secrets: createSecretScanner(),
    calibration: () => ({ kindFactor: () => 1, version: 0 }),
    calibrationSink: (x) => samples.push(x),
    seeds: () => [],
    metrics: {
      inc: (n, k = 1) => counters.set(n, (counters.get(n) ?? 0) + k),
      observe() {},
    },
    counters,
    reads,
    samples,
  };
}
