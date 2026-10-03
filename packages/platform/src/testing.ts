/**
 * @mitori/platform/testing — test-only helpers (fakes, conformance cases). Importable only from tests
 * (`*.test.ts`, `test/` dirs), bench, eval, e2e and @mitori/testkit; never from production sources
 * (scripts/check-boundaries.ts enforces it). Owner: the package's WP.
 *
 * Shapes follow the testkit contract §1–§2 (`FakeClock`, `TestLogger`, `FakeSpawner`, `ScriptedChild`); they are
 * declared structurally here because platform cannot import @mitori/testkit (CR m0-6: testkit re-exports these).
 */
import {
  type Clock,
  type GitOid,
  type GitReader,
  type Iso8601,
  type LogFields,
  type Logger,
  type Migration,
  MitoriError,
  type RepoPath,
  type SqlDb,
  type UnixMs,
  type WorkerPool,
} from "@mitori/core";
import { gitBlobOid } from "./hash/digest.ts";
import { isContentLike, LOG_CONTENT_MAX_CHARS } from "./log/logger.ts";
import { LineChannel } from "./spawn/lines.ts";
import type { ChildHandle, KillSignal, Spawner, SpawnSpec } from "./spawn/types.ts";
import { openSqlDb } from "./sqlite/db.ts";
import { runMigrations } from "./sqlite/migrate.ts";

/* ------------------------------------------------------------------ clock */

/** Controllable clock (testkit `FakeClock`). Starts at 2026-01-01T00:00:00.000Z unless given. */
export interface FakeClock extends Clock {
  /** Advance by ms (fires due timers registered via `setTimeout`, in due order). */
  advance(ms: number): void;
  /** Jump to a time (forward jumps fire due timers). */
  set(at: Iso8601 | UnixMs): void;
  /** setTimeout replacement bound to this clock. */
  setTimeout(fn: () => void, ms: number): number;
  /** clearTimeout replacement. */
  clearTimeout(id: number): void;
}

/** A {@link FakeClock}. */
export function createFakeClock(start?: Iso8601): FakeClock {
  let now = Date.parse(start ?? "2026-01-01T00:00:00.000Z");
  if (Number.isNaN(now)) throw new MitoriError("E_INVALID_INPUT", `bad FakeClock start: ${start}`);
  let seq = 0;
  const timers = new Map<number, { due: number; fn: () => void }>();
  const runUntil = (target: number) => {
    for (;;) {
      let next: [number, { due: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].due <= target && (!next || e[1].due < next[1].due || (e[1].due === next[1].due && e[0] < next[0]))) next = e;
      if (!next) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].due);
      next[1].fn();
    }
    now = Math.max(now, target);
  };
  return {
    now: () => now,
    iso: () => new Date(now).toISOString(),
    advance: (ms) => runUntil(now + ms),
    set(at) {
      const t = typeof at === "number" ? at : Date.parse(at);
      if (t >= now) runUntil(t);
      else now = t;
    },
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { due: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
}

/* ------------------------------------------------------------------ logger */

/** Recording logger (testkit `TestLogger`). */
export interface TestLogger extends Logger {
  /** Recorded lines. */
  readonly lines: readonly { lvl: "debug" | "info" | "warn" | "error"; ns: string; msg: string; fields: LogFields }[];
  /** Throws if any field value has a newline or > 200 chars (file/prompt content). */
  assertNoContent(): void;
}

/** A {@link TestLogger}: records every level; children share the record list. */
export function createTestLogger(): TestLogger {
  const lines: { lvl: "debug" | "info" | "warn" | "error"; ns: string; msg: string; fields: LogFields }[] = [];
  const make = (ns: string, bound: LogFields): Logger => {
    const rec = (lvl: "debug" | "info" | "warn" | "error") => (msg: string, fields?: LogFields) => {
      lines.push({ lvl, ns, msg, fields: { ...bound, ...fields } });
    };
    return {
      debug: rec("debug"),
      info: rec("info"),
      warn: rec("warn"),
      error: rec("error"),
      child: (child, fields) => make(ns ? `${ns}.${child}` : child, { ...bound, ...fields }),
    };
  };
  const root = make("", {});
  return {
    ...root,
    lines,
    assertNoContent() {
      for (const l of lines)
        for (const [k, v] of Object.entries(l.fields))
          if (isContentLike(v))
            throw new MitoriError(
              "E_INTERNAL",
              `log field "${k}" of "${l.msg}" (${l.ns || "root"}) looks like content (newline or > ${LOG_CONTENT_MAX_CHARS} chars)`,
            );
    },
  };
}

/* ------------------------------------------------------------------ storage */

/** bun:sqlite `:memory:` with the given migrations applied (package order of first appearance, versions ascending). */
export function memDb(migrations: readonly Migration[] = []): SqlDb {
  const db = openSqlDb(":memory:");
  const first = migrations[0];
  if (!first) return db;
  if (migrations.some((m) => m.db !== first.db)) throw new MitoriError("E_INVALID_INPUT", "memDb: migrations of one database kind only");
  runMigrations(db, { db: first.db, order: [...new Set(migrations.map((m) => m.pkg))], migrations, now: () => "2026-01-01T00:00:00.000Z" });
  return db;
}

/** GitReader over an in-memory file map (blob ids = real git blob ids, sha1). Everything is tracked and clean. */
export function memGitReader(files: Readonly<Record<RepoPath, string | Uint8Array>>, opts: { head?: GitOid | null; branch?: string | null } = {}): GitReader {
  const enc = new TextEncoder();
  const blobs = new Map<GitOid, Uint8Array>();
  const entries = Object.keys(files)
    .sort()
    .map((path) => {
      const v = files[path] as string | Uint8Array;
      const bytes = typeof v === "string" ? enc.encode(v) : v;
      const blob = gitBlobOid(bytes, "sha1");
      blobs.set(blob, bytes);
      return { path: path.normalize("NFC"), blob, mode: "100644", stage: 0 as const, tracked: true };
    });
  return {
    lsFiles: async () => entries.map((e) => ({ ...e })),
    lsOthers: async () => [],
    status: async () => [],
    statusDirty: async () => [],
    checkAttr: async () => ({}),
    async catBlob(blob) {
      const b = blobs.get(blob);
      if (!b) throw new MitoriError("E_NOT_FOUND", `blob ${blob} not found`, { params: { blob } });
      return b.slice();
    },
    head: async () => opts.head ?? null,
    headTree: async () => null,
    branch: async () => opts.branch ?? null,
    gitDir: async () => "/mem/.git",
    diffNames: async () => [],
    log: async () => [],
    revCount: async () => null,
    isShallow: async () => false,
    objectFormat: async () => "sha1",
  };
}

/* ------------------------------------------------------------------ spawner */

/** Scripted child process served by {@link FakeSpawner} (testkit `ScriptedChild`). */
export interface ScriptedChild {
  /** stdout lines. */
  stdout?: readonly string[];
  /** stderr lines. */
  stderr?: readonly string[];
  /** Exit code (default 0). */
  exitCode?: number;
  /** Delay before the first line (FakeClock time when the spawner has a clock). */
  delayMs?: number;
  /** Never exit until killed. */
  hang?: boolean;
}

/** Spawner double (testkit `FakeSpawner`). Unmatched spawns throw (no silent real processes). */
export interface FakeSpawner extends Spawner {
  /** Specs received, in order. */
  readonly calls: readonly SpawnSpec[];
  /** Register a scripted child for specs matching `match` (first registered match wins). */
  script(match: (spec: SpawnSpec) => boolean, child: ScriptedChild | ((spec: SpawnSpec) => ScriptedChild)): FakeSpawner;
}

const SIGNO: Record<KillSignal, number> = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };

/** A {@link FakeSpawner}. Killing a child ends it with 128 + signal number. */
export function createFakeSpawner(opts: { clock?: Clock } = {}): FakeSpawner {
  const calls: SpawnSpec[] = [];
  const scripts: { match: (s: SpawnSpec) => boolean; child: ScriptedChild | ((s: SpawnSpec) => ScriptedChild) }[] = [];
  const clock = opts.clock as Partial<FakeClock> | undefined;
  const later = (fn: () => void, ms: number) => {
    if (clock?.setTimeout) clock.setTimeout(fn, ms);
    else if (ms > 0) setTimeout(fn, ms);
    else queueMicrotask(fn);
  };
  let nextPid = 10_000;
  const enc = new TextEncoder();
  const self: FakeSpawner = {
    calls,
    script(match, child) {
      scripts.push({ match, child });
      return self;
    },
    spawn(spec): ChildHandle {
      calls.push(spec);
      const hit = scripts.find((s) => s.match(spec));
      if (!hit) throw new MitoriError("E_INTERNAL", `FakeSpawner: unexpected spawn of ${spec.command} ${spec.argv.join(" ")}`);
      const sc = typeof hit.child === "function" ? hit.child(spec) : hit.child;
      const out = new LineChannel();
      const err = new LineChannel();
      let finish: (code: number) => void = () => {};
      let done = false;
      let stdinOpen = true;
      const exited = new Promise<number>((resolve) => {
        finish = (code) => {
          if (done) return;
          done = true;
          stdinOpen = false;
          out.end();
          err.end();
          resolve(code);
        };
      });
      later(() => {
        if (done) return;
        for (const l of sc.stdout ?? []) out.push(enc.encode(`${l}\n`));
        for (const l of sc.stderr ?? []) err.push(enc.encode(`${l}\n`));
        if (!sc.hang) finish(sc.exitCode ?? 0);
      }, sc.delayMs ?? 0);
      return {
        pid: nextPid++,
        stdout: out,
        stderr: err,
        write(text) {
          if (!stdinOpen) throw new MitoriError("E_PRECONDITION", "stdin of the child is closed");
          void text;
        },
        closeStdin() {
          stdinOpen = false;
        },
        kill(signal) {
          finish(128 + SIGNO[signal]);
        },
        exited,
      };
    },
  };
  return self;
}

/* ------------------------------------------------------------------ workers */

/** WorkerPool running `fn` in-thread (unit tests; no wasm worker start-up cost). */
export function inlineWorkerPool<Req, Res>(fn: (req: Req) => Res | Promise<Res>): WorkerPool<Req, Res> {
  let n = 1;
  let closed = false;
  return {
    async run(req, signal) {
      if (closed) throw new MitoriError("E_SHUTTING_DOWN", "worker pool closed");
      if (signal?.aborted) throw new MitoriError("E_CANCELLED", "cancelled");
      return fn(req);
    },
    size: () => n,
    async resize(k) {
      n = k;
    },
    async shrink(keep = 0) {
      n = Math.min(n, keep);
    },
    async close() {
      closed = true;
      n = 0;
    },
  };
}
