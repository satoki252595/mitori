/**
 * @mitori/platform — `random/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Random } from "@mitori/core";

/** `crypto.getRandomValues` fills at most 64 KiB per call. */
const CHUNK = 65_536;

/** Cryptographic randomness (production) [CR test-1]. */
export const cryptoRandom: Random = {
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let at = 0; at < n; at += CHUNK) crypto.getRandomValues(out.subarray(at, Math.min(n, at + CHUNK)));
    return out;
  },
};
