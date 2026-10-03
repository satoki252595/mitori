import type { Clock } from "@mitori/core";

/** Timer handle (opaque). */
export type TimerHandle = unknown;

/** Timer port derived from the injected clock. */
export interface Timers {
  set(fn: () => void, ms: number): TimerHandle;
  clear(h: TimerHandle): void;
}

/** A clock that may also schedule (the testkit FakeClock does; production clocks usually don't). */
type SchedulingClock = Clock & { setTimeout?: (fn: () => void, ms: number) => number; clearTimeout?: (id: number) => void };

/**
 * Timers bound to `clock`: a FakeClock's `setTimeout`/`clearTimeout` when present (virtual time in tests), else the
 * host timers. Host timers are unref'd so a parked process' TTL never keeps the daemon alive on its own.
 */
export function timersFor(clock: Clock): Timers {
  const c = clock as SchedulingClock;
  if (typeof c.setTimeout === "function" && typeof c.clearTimeout === "function") {
    const set = c.setTimeout.bind(c);
    const clear = c.clearTimeout.bind(c);
    return { set: (fn, ms) => set(fn, ms), clear: (h) => clear(h as number) };
  }
  return {
    set: (fn, ms) => {
      const h = globalThis.setTimeout(fn, Math.max(0, ms)) as unknown as { unref?: () => void };
      h.unref?.();
      return h;
    },
    clear: (h) => globalThis.clearTimeout(h as Parameters<typeof globalThis.clearTimeout>[0]),
  };
}
