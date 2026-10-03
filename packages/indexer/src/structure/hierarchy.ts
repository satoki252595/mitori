/**
 * Parent modules (spec §6.3-6): with more than 10 leaves, cluster the leaf graph (warm start = depth-1 directory of
 * each leaf's dominant dir) with γ chosen so that parents ≈ ceil(N/10) with fan-out in [5, 15]; one more level when
 * parents exceed 10. Depth ≤ 3 including leaves.
 */
import { buildUGraph, louvain } from "./louvain.ts";
import type { Tuning } from "./tuning.ts";

export interface LevelInput {
  /** Undirected weights between units (leaves or parents), i < j. */
  edges: readonly (readonly [number, number, number])[];
  /** Unit sizes (LOC). */
  size: Float64Array;
  /** Warm-start label per unit (depth-1 directory). */
  init: Int32Array;
  /** Visit rank per unit. */
  order: Int32Array;
}

/** Groups of units (each ≥ 2 members) forming the next level; units in no group stay at the current level. */
export function groupLevel(x: LevelInput, P: Tuning): number[][] {
  const n = x.size.length;
  if (n <= P.fanoutTarget) return [];
  const g = buildUGraph(n, x.edges, x.size);
  const target = Math.ceil(n / P.fanoutTarget);
  const groupsFor = (gamma: number): number[][] => {
    const labels = louvain(g, { gamma, maxSize: Number.POSITIVE_INFINITY, order: x.order, init: x.init });
    const by = new Map<number, number[]>();
    for (let v = 0; v < n; v++) {
      const l = labels[v] as number;
      const list = by.get(l);
      if (list) list.push(v);
      else by.set(l, [v]);
    }
    return [...by.values()].filter((m) => m.length >= 2).map((m) => m.sort((a, b) => a - b));
  };
  const score = (gs: number[][]) => {
    const fanOk = gs.filter((m) => m.length >= P.fanoutMin && m.length <= P.fanoutMax).length;
    return Math.abs(gs.length - target) * 10 - fanOk;
  };
  let best: number[][] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  let lo = Math.log(P.gammaMin);
  let hi = Math.log(P.gammaMax);
  for (let step = 0; step < P.gammaSteps; step++) {
    const mid = (lo + hi) / 2;
    const gs = groupsFor(Math.round(Math.exp(mid) * 1e6) / 1e6);
    const s = score(gs);
    if (s < bestScore) {
      best = gs;
      bestScore = s;
    }
    if (gs.length > target) hi = mid;
    else lo = mid;
  }
  return best.sort((a, b) => Math.min(...a.map((v) => x.order[v] as number)) - Math.min(...b.map((v) => x.order[v] as number)));
}
