/**
 * Timer port of the server (heartbeats, coalescing windows, idle exit, nonce/waiter grace). Core's `Clock` has no
 * timers, and the SSE / idle tests drive time with a fake clock, so every server timer goes through this.
 */

/** Opaque timer handle. */
export interface TimerHandle {
  readonly __timer: true;
}

/** setTimeout / clearTimeout. `unref` timers do not keep the process alive (idle exit, grace windows). */
export interface Timers {
  setTimeout(fn: () => void, ms: number, opts?: { unref?: boolean }): TimerHandle;
  clearTimeout(handle: TimerHandle | null | undefined): void;
}

/** The platform timers. */
export const realTimers: Timers = {
  setTimeout(fn, ms, opts) {
    const t = setTimeout(fn, ms);
    if (opts?.unref) (t as unknown as { unref?: () => void }).unref?.();
    return t as unknown as TimerHandle;
  },
  clearTimeout(handle) {
    if (handle) clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

/** Resolve after `ms` on the given timers. */
export function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}
