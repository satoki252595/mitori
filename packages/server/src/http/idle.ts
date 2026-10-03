/**
 * Idle exit (server spec §1.3, UXP-07): the daemon stops after `DAEMON.idleExitMs` (4 h) with no SSE client, job,
 * review waiter or generation run. Polled (cheap) plus `poke()` on connection changes, so a quiet daemon needs no
 * bookkeeping on the hot path.
 */
import type { Clock } from "@mitori/core";
import { DAEMON } from "../contract.ts";
import type { TimerHandle, Timers } from "./timers.ts";

export interface IdleMonitor {
  /** Re-evaluate now (connection opened/closed). */
  poke(): void;
  /** Idle since (epoch ms) or null while busy. */
  idleSince(): number | null;
  stop(): void;
}

export function createIdleMonitor(opts: {
  clock: Clock;
  timers: Timers;
  busy: () => boolean;
  onIdle: () => void;
  idleMs?: number;
  pollMs?: number;
}): IdleMonitor {
  const idleMs = opts.idleMs ?? DAEMON.idleExitMs;
  const pollMs = opts.pollMs ?? 60_000;
  let since: number | null = null;
  let timer: TimerHandle | null = null;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    let busy = true;
    try {
      busy = opts.busy();
    } catch {
      // a failing probe counts as busy
    }
    const now = opts.clock.now();
    if (busy) since = null;
    else {
      since ??= now;
      if (now - since >= idleMs) {
        stopped = true;
        opts.onIdle();
        return;
      }
    }
    arm();
  };
  const arm = () => {
    opts.timers.clearTimeout(timer);
    timer = opts.timers.setTimeout(check, pollMs, { unref: true });
  };
  arm();
  return {
    poke: check,
    idleSince: () => since,
    stop() {
      stopped = true;
      opts.timers.clearTimeout(timer);
    },
  };
}
