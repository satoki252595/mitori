import type { Iso8601, Random, UnixMs } from "@mitori/core";

/** Controllable clock (testkit `FakeClock` shape). Starts at 2026-01-01T00:00:00.000Z unless given. */
export interface FakeClock {
  now(): UnixMs;
  iso(): Iso8601;
  advance(ms: number): void;
  set(at: Iso8601 | UnixMs): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** Pending timers (diagnostics). */
  pending(): number;
}

export function createFakeClock(start: Iso8601 | UnixMs = "2026-01-01T00:00:00.000Z" as Iso8601): FakeClock {
  let t = typeof start === "number" ? start : Date.parse(start);
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; order: number }>();
  const fire = (until: number): void => {
    for (;;) {
      let next: [number, { at: number; fn: () => void; order: number }] | null = null;
      for (const e of timers) if (e[1].at <= until && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[1].order < next[1].order))) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = Math.max(t, next[1].at);
      next[1].fn();
    }
    t = Math.max(t, until);
  };
  return {
    now: () => t as UnixMs,
    iso: () => new Date(t).toISOString() as Iso8601,
    advance(ms: number): void {
      fire(t + ms);
    },
    set(at: Iso8601 | UnixMs): void {
      fire(typeof at === "number" ? at : Date.parse(at));
    },
    setTimeout(fn: () => void, ms: number): number {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, ms), fn, order: id });
      return id;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
    },
    pending: () => timers.size,
  };
}

/** Deterministic Random (xorshift32) for tests. */
export function seededRandom(seed = 1): Random {
  let x = seed >>> 0 || 1;
  return {
    bytes(n: number): Uint8Array {
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
