// What mitori itself wrote or removed recently, so the watcher can drop the echo of its own atomic writes
// (PLAT-I-007: matched by content hash, not by timing alone).
import type { Clock } from "@mitori/core";
import { systemClock } from "../clock/index.ts";
import { xxh3Hex } from "../hash/digest.ts";

/** Shared between the {@link SafeWriter} (records) and the {@link FsWatcher} (queries). */
export interface SelfWriteLog {
  /** Record a completed write of `bytes` to the absolute path `abs`. */
  noteWrite(abs: string, bytes: Uint8Array): void;
  /** Record a completed removal of `abs`. */
  noteRemove(abs: string): void;
  /** True when a record for `abs` is pending (only then is the file read to compare). */
  has(abs: string): boolean;
  /** True when `current` (null = absent) is exactly what mitori last wrote/removed at `abs`. */
  isEcho(abs: string, current: Uint8Array | null): boolean;
}

/** Options of {@link createSelfWriteLog}. */
export interface SelfWriteLogOptions {
  /** How long a record suppresses events (default 10 s; FSEvents may deliver late). */
  ttlMs?: number;
  /** Expiry clock. */
  clock?: Clock;
}

/** An in-memory {@link SelfWriteLog}. */
export function createSelfWriteLog(opts: SelfWriteLogOptions = {}): SelfWriteLog {
  const ttl = opts.ttlMs ?? 10_000;
  const clock = opts.clock ?? systemClock;
  const recs = new Map<string, { hash: string | null; size: number; at: number }>();
  const live = (abs: string) => {
    const r = recs.get(abs);
    if (r && clock.now() - r.at > ttl) {
      recs.delete(abs);
      return undefined;
    }
    return r;
  };
  const prune = () => {
    if (recs.size < 512) return;
    const now = clock.now();
    for (const [k, r] of recs) if (now - r.at > ttl) recs.delete(k);
  };
  return {
    noteWrite(abs, bytes) {
      prune();
      recs.set(abs, { hash: xxh3Hex(bytes), size: bytes.byteLength, at: clock.now() });
    },
    noteRemove(abs) {
      prune();
      recs.set(abs, { hash: null, size: 0, at: clock.now() });
    },
    has: (abs) => live(abs) !== undefined,
    isEcho(abs, current) {
      const r = live(abs);
      if (!r) return false;
      if (r.hash === null || current === null) return r.hash === null && current === null;
      return current.byteLength === r.size && xxh3Hex(current) === r.hash;
    },
  };
}
