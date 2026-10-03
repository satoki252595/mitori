/**
 * Parent modules (spec §6.3-6). With more than 10 leaves, parents follow the directory tree: leaves are grouped by
 * the first path segments of their dominant directory, at the shallowest depth that separates them (a repo that is
 * all `packages/…` is grouped by `packages/<name>`, never under one `packages` parent); a group of ≥ 2 leaves becomes
 * a parent named after its directory, a group with more than 15 children is grouped once more (depth ≤ 3 including
 * the leaves). When the directory tree cannot separate the leaves (a flat or layered repo), the leaf graph is
 * clustered instead (warm start = depth-1 directory, γ chosen for parents ≈ ceil(N/10) with fan-out in [5, 15]).
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

/** A parent of the directory tree. */
export interface TreeParent {
  /** Directory the parent stands for (its name). */
  dir: string;
  /** Leaf indices directly below it. */
  leaves: number[];
  /** Parent indices directly below it. */
  parents: number[];
  /** 1 = directly above leaves only, 2 = above parents. */
  level: number;
}

const segs = (d: string): string[] => (d === "" || d === "." ? [] : d.split("/"));
const keyAt = (home: readonly string[], k: number): string => (home.length === 0 ? "." : home.slice(0, k).join("/"));

/**
 * Directory-tree parents over leaves whose dominant directories are `homes`. Returns no parents when the tree does
 * not separate the leaves (the caller falls back to {@link groupLevel}).
 */
export function directoryTree(homes: readonly string[], P: Tuning): TreeParent[] {
  const n = homes.length;
  if (n <= P.fanoutTarget) return [];
  const split = homes.map(segs);
  const parents: TreeParent[] = [];
  /** Group `units` below `depth` path segments; returns the entries of that level (leaves and parents). */
  const build = (units: readonly number[], depth: number, levels: number): { leaves: number[]; parents: number[] } => {
    const deepest = Math.max(0, ...units.map((u) => (split[u] as string[]).length));
    let groups = new Map<string, number[]>();
    for (let k = depth + 1; k <= deepest; k++) {
      groups = new Map();
      for (const u of units) {
        const h = split[u] as string[];
        // a leaf whose home is shallower than k keys on its own home (it is not below any deeper directory)
        const key = h.length < k ? `${keyAt(h, h.length)}\u0000` : keyAt(h, k);
        const g = groups.get(key);
        if (g) g.push(u);
        else groups.set(key, [u]);
      }
      if (groups.size >= 2) {
        depth = k;
        break;
      }
    }
    if (groups.size < 2) return { leaves: [...units], parents: [] };
    const out = { leaves: [] as number[], parents: [] as number[] };
    for (const key of [...groups.keys()].sort()) {
      const g = groups.get(key) as number[];
      if (g.length === 1 || key.endsWith("\u0000")) {
        out.leaves.push(...g);
        continue;
      }
      const inner = g.length > P.fanoutMax && levels > 1 ? build(g, depth, levels - 1) : { leaves: [...g], parents: [] };
      const level = 1 + Math.max(0, ...inner.parents.map((p) => (parents[p] as TreeParent).level));
      parents.push({ dir: key, leaves: inner.leaves, parents: inner.parents, level });
      out.parents.push(parents.length - 1);
    }
    return out;
  };
  build(
    Array.from({ length: n }, (_, i) => i),
    0,
    P.maxDepth - 1,
  );
  return parents;
}
