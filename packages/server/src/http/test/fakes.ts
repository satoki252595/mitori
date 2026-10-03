/**
 * Minimal local fakes of the core ports for WP-09 tests. The shared ones (`@mitori/platform/testing`,
 * `@mitori/testkit`) are M0 stubs while WP-01 / WP-12 are in flight; switch to them once they land.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Clock, FsReader, FsStat, Hasher, Logger, Metrics, Migration, Random, SafeWriter, SqlDb, SqlParams } from "@mitori/core";
import type { TimerHandle, Timers } from "../timers.ts";

/** SqlDb over bun:sqlite (`strict` named params, IMMEDIATE transactions with savepoint nesting). */
export function sqliteDb(path = ":memory:"): SqlDb & { raw: Database } {
  const db = new Database(path, { strict: true, create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 0;");
  const args = (p?: SqlParams): unknown[] => (p === undefined ? [] : Array.isArray(p) ? p : [p]);
  return {
    raw: db,
    exec: (sql) => void db.exec(sql),
    run(sql, params) {
      const r = db.query(sql).run(...(args(params) as never[]));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params?: SqlParams) => db.query(sql).all(...(args(params) as never[])) as T[],
    get: <T>(sql: string, params?: SqlParams) => (db.query(sql).get(...(args(params) as never[])) as T | undefined) ?? null,
    tx: <T>(fn: () => T) => db.transaction(fn).immediate(),
    close: () => db.close(),
  };
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

/** Manually advanced clock (starts at 2026-10-03T10:00:00.000Z). */
export function fakeClock(start = Date.UTC(2026, 9, 3, 10, 0, 0)): FakeClock {
  let t = start;
  return {
    now: () => t,
    iso: () => new Date(t).toISOString(),
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
}

/** Real clock for integration tests. */
export const realClock: Clock = { now: () => Date.now(), iso: () => new Date().toISOString() };

/** Deterministic xorshift32 random. */
export function seededRandom(seed = 0x9e3779b9): Random {
  let s = seed >>> 0 || 1;
  return {
    bytes(n) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        out[i] = s & 0xff;
      }
      return out;
    },
  };
}

/** Real entropy for integration tests. */
export const cryptoRandom: Random = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };

export const testHasher: Hasher = {
  xxh3: (data) => Bun.hash.xxHash3(data).toString(16).padStart(16, "0"),
  sha256: (data) => createHash("sha256").update(data).digest("hex"),
  gitBlob: (data, algo) => createHash(algo).update(`blob ${data.byteLength}\0`).update(data).digest("hex"),
};

export const noopMetrics: Metrics & { counts: Map<string, number> } = {
  counts: new Map(),
  inc() {},
  observe() {},
};

/** Metrics that record counters (assertions on `srv.*`). */
export function recordingMetrics(): Metrics & { counts: Map<string, number>; samples: Map<string, number[]> } {
  const counts = new Map<string, number>();
  const samples = new Map<string, number[]>();
  return {
    counts,
    samples,
    inc(name, n = 1) {
      counts.set(name, (counts.get(name) ?? 0) + n);
    },
    observe(name, ms) {
      const list = samples.get(name) ?? [];
      list.push(ms);
      samples.set(name, list);
    },
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};

/** SafeWriter over the real filesystem (tests only: no symlink/allowlist checks). */
export function fsSafeWriter(): SafeWriter & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async write(root, rel, bytes) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, abs);
      writes.push(rel);
    },
    async remove(root, rel) {
      rmSync(join(root, rel), { force: true });
    },
  };
}

/** FsReader over the real filesystem. */
export const fsReader: FsReader = {
  stat(abs) {
    try {
      const s = lstatSync(abs, { bigint: true });
      const st: FsStat = { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: s.isSymbolicLink() };
      return st;
    } catch {
      return null;
    }
  },
  read: async (abs) => new Uint8Array(readFileSync(abs)),
  readHead: async (abs, n) => new Uint8Array(readFileSync(abs).subarray(0, n)),
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

export interface FakeTimers extends Timers {
  /** Run every timer due within `ms` (advancing the paired clock). */
  advance(ms: number): void;
  pending(): number;
}

/** Timers driven by a {@link FakeClock}. */
export function fakeTimers(clock: FakeClock): FakeTimers {
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const handle = (id: number) => ({ __timer: true, id }) as unknown as TimerHandle;
  return {
    setTimeout(fn, ms) {
      const id = next++;
      queue.set(id, { at: clock.now() + Math.max(0, ms), fn });
      return handle(id);
    },
    clearTimeout(h) {
      if (h) queue.delete((h as unknown as { id: number }).id);
    },
    advance(ms) {
      const end = clock.now() + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const e of queue) if (e[1].at <= end && (due === null || e[1].at < due[1].at)) due = e;
        if (!due) break;
        queue.delete(due[0]);
        clock.set(Math.max(clock.now(), due[1].at));
        due[1].fn();
      }
      clock.set(end);
    },
    pending: () => queue.size,
  };
}

/** Fresh temp directory under the OS tmp dir. */
export function tempDir(prefix = "mitori-srv-"): string {
  const base = join(process.env.TMPDIR ?? "/tmp", `${prefix}${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(base, { recursive: true });
  return realpathSync(base);
}

export function removeDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Apply `up` scripts in order (the platform migration runner is WP-01's). */
export function migrate(db: SqlDb, migrations: readonly Migration[]): SqlDb {
  for (const m of migrations) db.exec(m.up);
  return db;
}
