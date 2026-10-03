// Minimal local fakes for @mitori/doc tests (the shared ones in @mitori/platform/testing and @mitori/testkit are
// still M0 stubs). Replace with the shared fakes once WP-01 / WP-12 land.
import { Database } from "bun:sqlite";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Clock,
  type EventSink,
  type FsReader,
  type Hasher,
  type Logger,
  type MetricName,
  type Metrics,
  type Migration,
  MitoriError,
  newId,
  type Random,
  type SafeWriteKind,
  type SafeWriter,
  type SqlDb,
  type SqlParams,
  type WorkerPool,
  type WriteQueue,
} from "@mitori/core";
import type { GenIdSource } from "../contract.ts";

export const hasher: Hasher = {
  xxh3: (d) => Bun.hash.xxHash3(d).toString(16).padStart(16, "0"),
  sha256: (d) => new Bun.CryptoHasher("sha256").update(d).digest("hex"),
  gitBlob: (d, algo) => {
    const h = new Bun.CryptoHasher(algo === "sha1" ? "sha1" : "sha256");
    h.update(`blob ${d.length}\0`);
    h.update(d);
    return h.digest("hex");
  },
};

/** Deterministic Random (xorshift32 over a seed). */
export function seededRandom(seed = 1): Random {
  let x = seed >>> 0 || 1;
  return {
    bytes(n) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        out[i] = x & 0xff;
      }
      return out;
    },
  };
}

export function seededIds(seed = 1): GenIdSource {
  const r = seededRandom(seed);
  return { next: (kind) => newId(kind, r) };
}

/** bun:sqlite `:memory:` with the migrations applied. */
export function memDb(migrations: readonly Migration[] = []): SqlDb {
  const db = new Database(":memory:", { strict: true });
  const bind = (p?: SqlParams) => (p === undefined ? [] : Array.isArray(p) ? p : [p]) as never[];
  let depth = 0;
  const sql: SqlDb = {
    exec: (s) => db.exec(s),
    run: (s, p) => {
      const r = db.query(s).run(...bind(p));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(s: string, p?: SqlParams) => db.query(s).all(...bind(p)) as T[],
    get: <T>(s: string, p?: SqlParams) => (db.query(s).get(...bind(p)) as T | undefined) ?? null,
    tx: <T>(fn: () => T): T => {
      const sp = `sp${depth++}`;
      db.exec(depth === 1 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      try {
        const v = fn();
        db.exec(depth === 1 ? "COMMIT" : `RELEASE ${sp}`);
        return v;
      } catch (e) {
        db.exec(depth === 1 ? "ROLLBACK" : `ROLLBACK TO ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) sql.exec(m.up);
  return sql;
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export function fakeClock(start = Date.parse("2026-01-01T00:00:00.000Z")): FakeClock {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    iso: () => new Date(now).toISOString(),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = until;
    },
    setTimeout(fn, ms) {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
}

export const silentLog: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLog,
};

export function countingMetrics(): Metrics & { counts: Map<MetricName, number> } {
  const counts = new Map<MetricName, number>();
  return { counts, inc: (n, by = 1) => counts.set(n, (counts.get(n) ?? 0) + by), observe() {} };
}

export function collect<E>(): EventSink<E> & { events: E[] } {
  const events: E[] = [];
  return { events, emit: (e) => events.push(e) };
}

/** Serial in-process write queue. */
export function serialQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(_label: string, fn: () => T): Promise<T> => {
    const run = tail.then(async () => await fn());
    tail = run.catch(() => undefined);
    return run as Promise<T>;
  };
}

/** WorkerPool running `fn` in-thread. */
export function inlinePool<Req, Res>(fn: (req: Req) => Res | Promise<Res>): WorkerPool<Req, Res> & { calls: number } {
  const pool = {
    calls: 0,
    async run(req: Req) {
      pool.calls++;
      return await fn(req);
    },
    size: () => 1,
    resize: async () => {},
    shrink: async () => {},
    close: async () => {},
  };
  return pool;
}

/** FsReader over node:fs. */
export const nodeFs: FsReader = {
  stat(abs) {
    try {
      const s = lstatSync(abs, { bigint: true });
      return { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: s.isSymbolicLink() };
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

/** One write as seen by the spy. */
export interface WriteRecord {
  abs: string;
  bytes: number;
  kind: SafeWriteKind;
}

/**
 * SafeWriter over node:fs implementing the ADR-0014 path checks (allowlist-free: the doc store's own allowlist is
 * what is under test) plus a spy of every attempted write.
 */
export function spySafeWriter(): SafeWriter & { writes: WriteRecord[]; refused: string[] } {
  const writes: WriteRecord[] = [];
  const refused: string[] = [];
  const check = (rootReal: string, rel: string) => {
    if (rel === "" || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || rel.split("/").some((s) => s === ".." || s === "." || s === "")) {
      refused.push(rel);
      throw new MitoriError("E_PATH_OUTSIDE", `bad rel ${rel}`);
    }
    // CR-PENDING(WP-04): the doc root (docDir) may not exist yet; it is created when its parent is a realpath
    let rootOk = false;
    try {
      rootOk = realpathSync(rootReal) === rootReal;
    } catch {
      const parent = rootReal.slice(0, rootReal.lastIndexOf("/"));
      if (realpathSync(parent) === parent) {
        mkdirSync(rootReal);
        rootOk = true;
      }
    }
    if (!rootOk) {
      refused.push(rel);
      throw new MitoriError("E_PATH_SYMLINK", "root is not a realpath");
    }
    let at = rootReal;
    const parts = rel.split("/");
    for (const p of parts.slice(0, -1)) {
      at = join(at, p);
      try {
        if (lstatSync(at).isSymbolicLink()) {
          refused.push(rel);
          throw new MitoriError("E_PATH_SYMLINK", at);
        }
      } catch (e) {
        if (MitoriError.is(e)) throw e;
        mkdirSync(at);
      }
    }
    const target = join(rootReal, rel);
    try {
      if (lstatSync(target).isSymbolicLink()) {
        refused.push(rel);
        throw new MitoriError("E_PATH_SYMLINK", target);
      }
    } catch (e) {
      if (MitoriError.is(e)) throw e;
    }
    return target;
  };
  return {
    writes,
    refused,
    async write(rootReal, rel, bytes, kind) {
      const target = check(rootReal, rel);
      const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
      writes.push({ abs: target, bytes: data.length, kind });
      const tmp = `${target}.tmp-${writes.length}`;
      writeFileSync(tmp, data, { flag: "wx" });
      renameSync(tmp, target);
    },
    async remove(rootReal, rel) {
      rmSync(check(rootReal, rel), { force: true });
    },
  };
}

/** Golden comparison against `fixtures/golden/<rel>` (`MITORI_UPDATE_GOLDEN=1` rewrites). Local stand-in for testkit's. */
export function expectGoldenFile(rel: string, actual: string): { ok: boolean; expected: string | null } {
  const abs = join(import.meta.dir, "../../../../fixtures/golden", rel);
  if (process.env.MITORI_UPDATE_GOLDEN === "1") {
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, actual);
    return { ok: true, expected: actual };
  }
  let expected: string | null = null;
  try {
    expected = readFileSync(abs, "utf8");
  } catch {
    expected = null;
  }
  return { ok: expected === actual, expected };
}

/** In-memory SafeWriter (bench / unit tests that never touch disk). */
export function memSafeWriter(): SafeWriter & { files: Map<string, string>; writes: number } {
  const files = new Map<string, string>();
  const w = {
    files,
    writes: 0,
    async write(_root: string, rel: string, bytes: Uint8Array | string) {
      w.writes++;
      files.set(rel, typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
    },
    async remove(_root: string, rel: string) {
      files.delete(rel);
    },
  };
  return w;
}
