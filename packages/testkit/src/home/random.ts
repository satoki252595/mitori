// Seedable randomness (core `Random` port shape): the same seed always yields the same byte stream.
import type { RandomSource } from "../contract.ts";

/** xmur3: string → 32-bit seed. */
function seedOf(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 over the seed; one 32-bit step yields four bytes. */
export function seeded(seed: string | number): RandomSource {
  let a = seedOf(seed);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    bytes(n: number): Uint8Array {
      if (!Number.isInteger(n) || n < 0) throw new RangeError(`bytes(n): n must be a non-negative integer, got ${n}`);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 4) {
        const w = next();
        for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = (w >>> (8 * j)) & 0xff;
      }
      return out;
    },
  };
}
