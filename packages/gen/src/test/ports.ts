/**
 * Minimal port fakes for gen tests (the shared ones in @mitori/platform/testing and @mitori/testkit are still
 * M0 stubs). Deterministic: seeded random, manual clock, in-memory SQLite.
 */
import { Database } from "bun:sqlite";
import {
  type Clock,
  createSecretScanner,
  type EventSink,
  type FsReader,
  type FsStat,
  type Hasher,
  type IdKind,
  type Logger,
  type MetricName,
  type Metrics,
  type Migration,
  newId,
  type Random,
  type SafeWriteKind,
  type SafeWriter,
  type SecretScanner,
  type SqlDb,
  type SqlParams,
  type SseEventPayload,
  type WriteQueue,
} from "@mitori/core";
import type { GenIdSource } from "@mitori/doc";

/** Hasher over Bun.hash / Bun.CryptoHasher. */
export function testHasher(): Hasher {
  return {
    xxh3: (data) => Bun.hash.xxHash3(data).toString(16).padStart(16, "0"),
    sha256: (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
    gitBlob: (data, algo) => {
      const head = new TextEncoder().encode(`blob ${data.length}\0`);
      const all = new Uint8Array(head.length + data.length);
      all.set(head);
      all.set(data, head.length);
      return new Bun.CryptoHasher(algo).update(all).digest("hex");
    },
  };
}

/** Seeded xorshift32 `Random`. */
export function seededRandom(seed = 0x9e3779b9): Random {
  let x = seed >>> 0 || 1;
  return {
    bytes(n) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        out[i] = x & 0xff;
      }
      return out;
    },
  };
}

/** Deterministic id source over `newId`. */
export function testIds(seed = 7): GenIdSource {
  const r = seededRandom(seed);
  return { next: (kind) => newId(kind as IdKind, r) };
}

/** Manual clock (starts at 2026-10-03T00:00:00Z). */
export interface TestClock extends Clock {
  /** Advance by ms. */
  advance(ms: number): void;
  /** Set epoch ms. */
  set(ms: number): void;
}

/** Manual clock. */
export function testClock(start = Date.parse("2026-10-03T00:00:00.000Z")): TestClock {
  let now = start;
  return {
    now: () => now,
    iso: () => new Date(now).toISOString(),
    advance(ms) {
      now += ms;
    },
    set(ms) {
      now = ms;
    },
  };
}

/** bun:sqlite `:memory:` SqlDb with the given migrations applied. */
export function memDb(migrations: readonly Migration[] = []): SqlDb {
  const db = new Database(":memory:");
  const bind = (params?: SqlParams) => (params === undefined ? [] : Array.isArray(params) ? params : [params]);
  const sql: SqlDb = {
    exec: (s) => {
      db.exec(s);
    },
    run: (s, params) => {
      const r = db.query(s).run(...(bind(params) as never[]));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(s: string, params?: SqlParams) => db.query(s).all(...(bind(params) as never[])) as T[],
    get: <T>(s: string, params?: SqlParams) => (db.query(s).get(...(bind(params) as never[])) as T | undefined) ?? null,
    tx: <T>(fn: () => T) => db.transaction(fn)() as T,
    close: () => db.close(),
  };
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) sql.exec(m.up);
  return sql;
}

/** Single-writer queue that serializes `fn`s and records labels. */
export function testWriteQueue(): WriteQueue & { labels: string[]; depth: () => number } {
  let chain: Promise<unknown> = Promise.resolve();
  const labels: string[] = [];
  let inside = 0;
  const q = (<T>(label: string, fn: () => T): Promise<T> => {
    labels.push(label);
    const p = chain.then(() => {
      inside++;
      try {
        return fn();
      } finally {
        inside--;
      }
    });
    chain = p.catch(() => undefined);
    return p;
  }) as WriteQueue & { labels: string[]; depth: () => number };
  q.labels = labels;
  q.depth = () => inside;
  return q;
}

/** In-memory SafeWriter: files keyed by `<root>/<rel>`. */
export function memSafeWriter(): SafeWriter & { files: Map<string, string>; kinds: Map<string, SafeWriteKind> } {
  const files = new Map<string, string>();
  const kinds = new Map<string, SafeWriteKind>();
  return {
    files,
    kinds,
    async write(root, rel, bytes, kind) {
      if (rel.includes("..") || rel.startsWith("/")) throw new Error(`unsafe rel ${rel}`);
      const key = `${root}/${rel}`;
      files.set(key, typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
      kinds.set(key, kind);
    },
    async remove(root, rel) {
      files.delete(`${root}/${rel}`);
    },
  };
}

/** FsReader over a map of absolute paths (plus optional symlinks). */
export function memFs(files: Map<string, string>, symlinks: ReadonlySet<string> = new Set()): FsReader {
  const stat = (abs: string): FsStat | null => {
    if (symlinks.has(abs)) return { size: 0, mtimeNs: 0n, ino: 0n, isFile: false, isDir: false, isSymlink: true };
    const t = files.get(abs);
    return t === undefined ? null : { size: t.length, mtimeNs: 0n, ino: 0n, isFile: true, isDir: false, isSymlink: false };
  };
  return {
    stat,
    read: async (abs) => new TextEncoder().encode(files.get(abs) ?? ""),
    readHead: async (abs, n) => new TextEncoder().encode((files.get(abs) ?? "").slice(0, n)),
    realpath: (abs) => (files.has(abs) ? abs : null),
    readdir: () => null,
  };
}

/** Logger that records lines. */
export function testLogger(): Logger & { lines: { level: string; msg: string; fields?: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const make = (): Logger & { lines: typeof lines } => ({
    lines,
    debug: (msg, fields) => lines.push({ level: "debug", msg, ...(fields ? { fields } : {}) }),
    info: (msg, fields) => lines.push({ level: "info", msg, ...(fields ? { fields } : {}) }),
    warn: (msg, fields) => lines.push({ level: "warn", msg, ...(fields ? { fields } : {}) }),
    error: (msg, fields) => lines.push({ level: "error", msg, ...(fields ? { fields } : {}) }),
    child: () => make(),
  });
  return make();
}

/** Counting metrics. */
export function testMetrics(): Metrics & { counts: Map<MetricName, number> } {
  const counts = new Map<MetricName, number>();
  return {
    counts,
    inc: (name, n = 1) => counts.set(name, (counts.get(name) ?? 0) + n),
    observe: () => undefined,
  };
}

/** Event sink that records events and lets tests wait for one. */
export interface TestEvents extends EventSink<SseEventPayload> {
  /** Emitted events. */
  events: SseEventPayload[];
  /** Resolve once an event matching `pred` was (or is) emitted. */
  waitFor(pred: (e: SseEventPayload) => boolean, timeoutMs?: number): Promise<SseEventPayload>;
}

/** Event sink fake. */
export function testEvents(): TestEvents {
  const events: SseEventPayload[] = [];
  const waiters: { pred: (e: SseEventPayload) => boolean; resolve: (e: SseEventPayload) => void }[] = [];
  return {
    events,
    emit(e) {
      events.push(e);
      for (const w of [...waiters]) {
        if (w.pred(e)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(e);
        }
      }
    },
    waitFor(pred, timeoutMs = 2000) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("waitFor: timed out")), timeoutMs);
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(timer);
            resolve(e);
          },
        });
      });
    },
  };
}

/** The core secret scanner. */
export function testSecrets(): SecretScanner {
  return createSecretScanner();
}
