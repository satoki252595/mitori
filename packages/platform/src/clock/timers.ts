// Injectable timer pair: the real one, or a FakeClock (`@mitori/platform/testing`) in tests.

/** Timer handle (opaque). */
export type TimerId = unknown;

/** setTimeout/clearTimeout pair (method syntax so a FakeClock with numeric ids is assignable). */
export interface Timers {
  /** Schedule `fn` after `ms`. */
  setTimeout(fn: () => void, ms: number): TimerId;
  /** Cancel. */
  clearTimeout(id: TimerId): void;
}

/** Process timers. Handles are unref'd: a pending grace/idle timer never keeps the daemon alive. */
export const realTimers: Timers = {
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimeout(id) {
    clearTimeout(id as ReturnType<typeof setTimeout>);
  },
};
