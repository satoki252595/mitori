// Exclusive lock files (`~/.mitori/daemon.lock`, server spec §1.1): created atomically WITH their content
// (write a temp, then link(2) — fails when the lock exists), reclaimed when the holder is gone: its PID is dead, or
// alive but `verifyHolder` says it is someone else (PID reuse), on `probes` consecutive checks.
import { closeSync, linkSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { MitoriError } from "@mitori/core";
import { cryptoRandom } from "../random/index.ts";

/** Options of {@link acquireLock}. */
export interface LockOptions<T> {
  /**
   * For a holder whose PID is alive: is it really the process that took the lock? (daemon: `GET /health` proof and
   * pid match). `false` ⇒ the PID was reused ⇒ stale. Omitted ⇒ an alive PID always holds.
   */
  verifyHolder?: (holder: T) => Promise<boolean>;
  /** Consecutive stale verdicts needed before reclaiming (server `DAEMON.lockStaleProbes` = 2). */
  probes?: number;
  /** Delay between probes (default 100 ms). */
  probeDelayMs?: number;
  /** PID liveness (default `kill(pid, 0)`). */
  isPidAlive?: (pid: number) => boolean;
}

/** Outcome of {@link acquireLock}. */
export type LockResult<T> =
  | {
      /** Acquired. */
      ok: true;
      /** Remove the lock if it is still ours. Idempotent. */
      release(): void;
    }
  | {
      /** Held by a live process. */
      ok: false;
      /** Its content (null when unreadable). */
      holder: T | null;
    };

/** A reclaim marker older than this belongs to a reclaimer that died mid-way. */
const RECLAIM_STALE_MS = 10_000;

/** `kill(pid, 0)`: true when the process exists (EPERM also means it exists). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

function readRaw(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

function parse<T extends { pid: number }>(raw: string): T | null {
  try {
    const v = JSON.parse(raw) as T;
    return v !== null && typeof v === "object" && Number.isInteger(v.pid) ? v : null;
  } catch {
    return null;
  }
}

/** Atomically create `path` holding `content` (0600). False when it already exists. */
function tryCreate(path: string, content: string): boolean {
  const tmp = `${path}.${process.pid}.${Buffer.from(cryptoRandom.bytes(6)).toString("hex")}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, path);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "EEXIST") return false;
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/** Delete the lock only if it still holds `expected` — serialized through an O_EXCL `.reclaim` marker. */
function reclaim(path: string, expected: string): void {
  const marker = `${path}.reclaim`;
  try {
    closeSync(openSync(marker, "wx", 0o600));
  } catch (err) {
    if ((err as { code?: string }).code !== "EEXIST") throw err;
    try {
      if (Date.now() - statSync(marker).mtimeMs > RECLAIM_STALE_MS) unlinkSync(marker);
    } catch {}
    return; // someone else is reclaiming; the caller retries
  }
  try {
    if (readRaw(path) === expected) unlinkSync(path);
  } finally {
    unlinkSync(marker);
  }
}

/** Take the lock at `path` with `data` (JSON; must carry the holder `pid`). */
export async function acquireLock<T extends { pid: number }>(path: string, data: T, opts: LockOptions<T> = {}): Promise<LockResult<T>> {
  const content = `${JSON.stringify(data)}\n`;
  const probes = Math.max(1, opts.probes ?? 2);
  const delay = opts.probeDelayMs ?? 100;
  const alive = opts.isPidAlive ?? pidAlive;

  const staleOnce = async (raw: string): Promise<boolean> => {
    const holder = parse<T>(raw);
    if (!holder) return true; // unreadable content can never be released by its owner
    if (!alive(holder.pid)) return true;
    return opts.verifyHolder ? !(await opts.verifyHolder(holder)) : false;
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    if (tryCreate(path, content)) {
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          if (readRaw(path) === content) unlinkSync(path);
        },
      };
    }
    const raw = readRaw(path);
    if (raw === null) continue; // released in between
    let stale = true;
    let changed = false;
    for (let i = 0; i < probes && stale; i++) {
      if (i > 0) await Bun.sleep(delay);
      if (readRaw(path) !== raw) {
        changed = true; // the lock changed hands meanwhile: start over
        break;
      }
      stale = await staleOnce(raw);
    }
    if (changed) continue;
    if (!stale) return { ok: false, holder: parse<T>(raw) };
    reclaim(path, raw);
  }
  throw new MitoriError("E_LOCK_TIMEOUT", "could not acquire the lock (contended)", { params: { path } });
}
