/** Personalized weighted PageRank over the directed file graph (spec §6.4). Deterministic: index-order sums. */
import { STRUCTURE_PARAMS } from "../contract.ts";

/**
 * `out[i]` = (target, weight) pairs. Dangling mass returns to the personalization vector.
 * Returns a probability vector (Σ = 1).
 */
export function pagerank(n: number, out: readonly (readonly [number, number])[][], personalization: Float64Array): Float64Array {
  if (n === 0) return new Float64Array(0);
  const alpha = STRUCTURE_PARAMS.pagerankAlpha;
  const p = new Float64Array(n);
  let ps = 0;
  for (let i = 0; i < n; i++) ps += personalization[i] as number;
  for (let i = 0; i < n; i++) p[i] = ps > 0 ? (personalization[i] as number) / ps : 1 / n;
  const outW = new Float64Array(n);
  for (let i = 0; i < n; i++) for (const [, w] of out[i] ?? []) outW[i] = (outW[i] as number) + w;
  let r = Float64Array.from(p);
  let next = new Float64Array(n);
  for (let iter = 0; iter < STRUCTURE_PARAMS.pagerankMaxIter; iter++) {
    let dangling = 0;
    for (let i = 0; i < n; i++) if ((outW[i] as number) === 0) dangling += r[i] as number;
    for (let i = 0; i < n; i++) next[i] = (1 - alpha) * (p[i] as number) + alpha * dangling * (p[i] as number);
    for (let i = 0; i < n; i++) {
      const wi = outW[i] as number;
      if (wi === 0) continue;
      const share = (alpha * (r[i] as number)) / wi;
      for (const [j, w] of out[i] ?? []) next[j] = (next[j] as number) + share * w;
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs((next[i] as number) - (r[i] as number));
    [r, next] = [next, r];
    if (diff < STRUCTURE_PARAMS.pagerankTol) break;
  }
  return r;
}
