// FsWatcher (server contract §2, indexer spec §10.1): Bun recursive fs.watch on every platform (FSEvents on macOS,
// inotify on Linux — O3 decision, docs/design/specs/platform-watch.md), batched leading 5 ms + max-wait 30 ms.
// Raw events are only hints: each batched path is lstat'ed, so duplicates and touch-free events vanish, missing
// files become `delete`, and mitori's own atomic writes (SelfWriteLog, matched by content hash) are dropped.
import { type FSWatcher, lstatSync, readdirSync, readFileSync, watch } from "node:fs";
import { join, relative } from "node:path";
import { type Clock, type Glob, MitoriError, type RepoPath } from "@mitori/core";
import { systemClock } from "../clock/index.ts";
import { realTimers, type TimerId, type Timers } from "../clock/timers.ts";
import { SAFE_WRITE_TEMP_RE } from "../fs/safe-writer.ts";
import type { SelfWriteLog } from "../fs/self-writes.ts";
import { nfc } from "../git/run.ts";

/** Structural copy of indexer `FsChange`. */
export type FsChange = { kind: "add" | "change" | "delete"; path: RepoPath; source?: Uint8Array } | { kind: "git" };

/** Structural copy of server `FsWatcher`. */
export interface FsWatcher {
  /** Watch `root`; `cb` receives batched, repo-relative changes (+ `{kind:"git"}` for index/HEAD/refs). Returns stop. */
  watch(root: string, opts: { ignore: readonly Glob[]; gitDir: string | null }, cb: (batch: FsChange[]) => void): () => void;
}

/** Options of {@link createFsWatcher}. */
export interface FsWatcherOptions {
  /** mitori's own writes (shared with the SafeWriter): their echo is not reported. */
  selfWrites?: SelfWriteLog;
  /** Batching (default = server `WATCH_BATCH`: leading 5 ms, max-wait 30 ms). */
  batch?: { leadingMs: number; maxWaitMs: number };
  /** Timers (tests: a FakeClock, passed as both `timers` and `clock`). */
  timers?: Timers;
  /** Time source of the batching decisions (default wall clock). */
  clock?: Clock;
  /** Watcher failures after start (root removed, inotify limits). Default: ignored. */
  onError?: (err: unknown) => void;
  /** Files read for the self-write check above this size are not attached as `source` (default 1 MiB). */
  maxSourceBytes?: number;
}

/** server `WATCH_BATCH` (CR idx-10). */
const DEFAULT_BATCH = { leadingMs: 5, maxWaitMs: 30 } as const;
/** git metadata whose change means "warm scan" (commit, checkout, pull, rebase). */
const GIT_META = /^(?:index|HEAD|packed-refs|refs\/.*)$/;
const TEMP = SAFE_WRITE_TEMP_RE;
/** Upper bound of files enumerated under one newly created directory per batch. */
const NEW_DIR_LIMIT = 20_000;

interface Pending {
  /** Raw event types seen in this batch (`rename` = create/delete/move, `change` = modify). */
  types: Set<string>;
}

/** The production {@link FsWatcher}. */
export function createFsWatcher(opts: FsWatcherOptions = {}): FsWatcher {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const timers = opts.timers ?? realTimers;
  const clock = opts.clock ?? systemClock;
  const onError = opts.onError ?? (() => {});
  const maxSource = opts.maxSourceBytes ?? 1 << 20;

  return {
    watch(root, wopts, cb) {
      const globs = wopts.ignore.map((g) => new Bun.Glob(g));
      const ignored = (rel: string) => globs.some((g) => g.match(rel) || g.match(`${rel}/`));
      const gitDir = wopts.gitDir;
      const gitRel = gitDir && (gitDir === root || gitDir.startsWith(`${root}/`)) ? relative(root, gitDir) : null;
      const startedMs = Date.now(); // compared with file timestamps: always the wall clock
      /** Paths reported (or proven echo) as existing since the watch started. */
      const known = new Set<string>();
      const pending = new Map<string, Pending>();
      let gitChanged = false;
      let timer: TimerId | null = null;
      let lastFlush = Number.NEGATIVE_INFINITY;
      let stopped = false;

      const schedule = () => {
        if (timer !== null || stopped) return;
        const now = clock.now();
        // idle → leading edge after 5 ms; inside a burst → at most 30 ms after the batch's first event
        timer = timers.setTimeout(flush, now - lastFlush >= batch.maxWaitMs ? batch.leadingMs : batch.maxWaitMs);
      };

      const onGitEvent = (sub: string) => {
        if (GIT_META.test(sub)) {
          gitChanged = true;
          schedule();
        }
      };

      const onRaw = (type: string, name: string | Buffer | null) => {
        if (stopped) return;
        if (name === null) {
          // the OS lost track (overflow): a warm scan re-derives everything
          gitChanged = true;
          schedule();
          return;
        }
        const rel = nfc(String(name));
        if (gitRel !== null && (rel === gitRel || rel.startsWith(`${gitRel}/`))) return onGitEvent(rel.slice(gitRel.length + 1));
        if (rel === "" || rel.split("/").includes(".git") || TEMP.test(rel) || ignored(rel)) return;
        const p = pending.get(rel);
        if (p) p.types.add(type);
        else pending.set(rel, { types: new Set([type]) });
        schedule();
      };

      const lstat = (abs: string) => {
        try {
          return lstatSync(abs);
        } catch {
          return null;
        }
      };

      /** Files below a directory created (or moved in) after the watch started; its own events may predate our watch. */
      const enumerateNewDir = (rel: string, out: Map<string, Pending>) => {
        let budget = NEW_DIR_LIMIT;
        const walk = (dirRel: string) => {
          let names: string[];
          try {
            names = readdirSync(join(root, dirRel));
          } catch {
            return;
          }
          for (const n of names) {
            if (budget-- <= 0) return;
            const r = `${dirRel}/${nfc(n)}`;
            if (n === ".git" || TEMP.test(r) || ignored(r) || out.has(r)) continue;
            const st = lstat(join(root, r));
            if (st?.isDirectory()) walk(r);
            else if (st) out.set(r, { types: new Set(["rename"]) });
          }
        };
        walk(rel);
      };

      const flush = () => {
        timer = null;
        lastFlush = clock.now();
        if (stopped) return;
        const paths = new Map(pending);
        pending.clear();
        const git = gitChanged;
        gitChanged = false;
        for (const [rel] of [...paths]) {
          const st = lstat(join(root, rel));
          if (st?.isDirectory() && Math.max(st.birthtimeMs || 0, st.ctimeMs) >= startedMs) enumerateNewDir(rel, paths);
        }
        const out: FsChange[] = [];
        for (const [rel, p] of paths) {
          const abs = join(root, rel);
          const st = lstat(abs);
          if (!st) {
            known.delete(rel);
            if (opts.selfWrites?.has(abs) && opts.selfWrites.isEcho(abs, null)) continue;
            out.push({ kind: "delete", path: rel });
            continue;
          }
          if (st.isDirectory()) continue;
          // No stat-based dedupe here: on coarse-mtime filesystems two saves can share size+mtime; the indexer's own
          // stat cache (indexer spec §10.2 step 3) drops true no-ops.
          const seen = known.has(rel);
          known.add(rel);
          let source: Uint8Array | undefined;
          if (opts.selfWrites?.has(abs) && st.isFile()) {
            try {
              source = readFileSync(abs);
            } catch {
              source = undefined;
            }
            if (source && opts.selfWrites.isEcho(abs, source)) continue;
          }
          // first sight of an existing path: `add` unless the OS said "modified" (inotify); FSEvents reports `rename`
          // for everything, so a rename is always delete(old) + add(new) in one batch (indexer rename detection)
          const kind = seen ? "change" : p.types.has("rename") ? "add" : "change";
          out.push(source && source.byteLength <= maxSource ? { kind, path: rel, source } : { kind, path: rel });
        }
        if (git) out.push({ kind: "git" });
        if (out.length === 0) return;
        try {
          cb(out);
        } catch (err) {
          onError(err);
        }
      };

      const handles: FSWatcher[] = [];
      const open = (dir: string, listener: (type: string, name: string | Buffer | null) => void) => {
        let w: FSWatcher;
        try {
          w = watch(dir, { recursive: true }, listener);
        } catch (err) {
          for (const h of handles) h.close();
          throw new MitoriError("E_IDX_WATCH", `cannot watch ${dir}`, { cause: err, params: { code: (err as { code?: string }).code ?? "?" } });
        }
        w.on("error", (err) => onError(err));
        handles.push(w);
      };
      open(root, onRaw);
      // a git dir outside the tree (linked worktree, shadow repo): watch it separately for index/HEAD/refs
      if (gitDir && gitRel === null)
        open(gitDir, (_t, name) => {
          if (!stopped && name !== null) onGitEvent(nfc(String(name)));
        });

      return () => {
        stopped = true;
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
        for (const h of handles) h.close();
      };
    },
  };
}
