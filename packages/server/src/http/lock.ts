/**
 * `~/.mitori/daemon.lock` (server spec §1.1 (a)): created with `O_CREAT|O_EXCL`. When it exists, the holder wins if
 * its PID is alive AND its `/health` answers; a lock whose PID is dead on `DAEMON.lockStaleProbes` consecutive probes
 * — or whose live PID never answers health after the start-up grace (PID reuse, hung process) — is taken over.
 * Two daemons starting together therefore leave exactly one (SRV-I-023).
 */
import { type Clock, type Iso8601, MitoriError } from "@mitori/core";
import { DAEMON, type DaemonLock } from "../contract.ts";
import { sleep, type Timers } from "./timers.ts";

/**
 * Exclusive lock-file primitive. CR-PENDING(WP-09): platform's `lock/` (WP-01) has no contract and `ServerDeps`
 * no lock port yet; the composition root adapts `openSync(path, "wx", 0o600)` / `readFileSync` / `unlinkSync`.
 */
export interface LockFilePort {
  /** Create `path` with `content` iff it does not exist (O_CREAT|O_EXCL, 0600). */
  tryCreate(path: string, content: string): boolean;
  /** Content, or null when missing. */
  read(path: string): string | null;
  /** Remove (missing is fine). */
  remove(path: string): void;
}

export const LOCK_FILE = "daemon.lock";

export function parseLock(text: string | null): DaemonLock | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<DaemonLock>;
    if (typeof v.pid === "number" && typeof v.startedAt === "string" && typeof v.port === "number") return { pid: v.pid, startedAt: v.startedAt, port: v.port };
  } catch {
    // corrupt ⇒ treated like a dead holder
  }
  return null;
}

export type LockResult = { acquired: true; lock: DaemonLock } | { acquired: false; holder: DaemonLock };

export async function acquireDaemonLock(opts: {
  path: string;
  lock: LockFilePort;
  pid: number;
  startedAt: Iso8601;
  clock: Clock;
  timers: Timers;
  pidAlive: (pid: number) => boolean;
  /** Holder's `/health` answered (within `DAEMON.healthTimeoutMs`). */
  healthy: (port: number) => Promise<boolean>;
  /** A live holder younger than this may still be binding its port (default 10 s). */
  startupGraceMs?: number;
  probeIntervalMs?: number;
  /** Give up (`E_LOCK_TIMEOUT`) after this long (default 15 s). */
  maxWaitMs?: number;
}): Promise<LockResult> {
  const mine: DaemonLock = { pid: opts.pid, startedAt: opts.startedAt, port: 0 };
  const content = JSON.stringify(mine);
  const grace = opts.startupGraceMs ?? 10_000;
  const interval = opts.probeIntervalMs ?? 250;
  const deadline = opts.clock.now() + (opts.maxWaitMs ?? 15_000);
  let strikes = 0;
  let seen: string | null = null;
  let tookOver = false;
  for (;;) {
    if (opts.lock.tryCreate(opts.path, content)) {
      if (!tookOver) return { acquired: true, lock: mine };
      // Taking over races other contenders: one that read the stale content before our remove may still delete the
      // lock we just created (its read-compare-remove is not atomic). Hold still one probe and keep the lock only if
      // it is still ours; otherwise contend for whoever holds it now.
      await sleep(opts.timers, interval);
      if (opts.lock.read(opts.path) === content) return { acquired: true, lock: mine };
      tookOver = false;
      continue;
    }
    const text = opts.lock.read(opts.path);
    if (text === null) continue; // vanished between create and read: retry at once
    if (text !== seen) {
      seen = text;
      strikes = 0;
    }
    const holder = parseLock(text);
    const alive = holder !== null && opts.pidAlive(holder.pid);
    if (holder && alive && holder.port > 0 && (await opts.healthy(holder.port))) return { acquired: false, holder };
    const young = holder !== null && alive && opts.clock.now() - Date.parse(holder.startedAt) < grace;
    if (!young) strikes += 1;
    if (strikes >= DAEMON.lockStaleProbes) {
      if (opts.lock.read(opts.path) === text) opts.lock.remove(opts.path);
      tookOver = true;
      strikes = 0;
      seen = null;
      continue;
    }
    if (opts.clock.now() >= deadline)
      throw new MitoriError("E_LOCK_TIMEOUT", "another mitori daemon holds the lock but does not answer", { params: { path: opts.path } });
    await sleep(opts.timers, interval);
  }
}
