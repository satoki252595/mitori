/**
 * Leaf clustering (spec §6.2–6.3 改訂 R1): directory-prior graph → warm start (previous leaves / seeds / DirPartition)
 * → γ search over deterministic Louvain + BFS split → size post-processing (split > 9k LOC, merge < 2k LOC).
 */
import type { RepoPath } from "@mitori/core";
import { dirOf } from "../resolve/files.ts";
import { edgeWeight, type FileGraph } from "./graph.ts";
import { buildUGraph, louvain, modularity, splitDisconnected, type UGraph } from "./louvain.ts";
import { TIE } from "./quantize.ts";
import type { Tuning } from "./tuning.ts";

export interface ClusterInput {
  fg: FileGraph;
  /** Visit rank per node (xxh3("ord|" + path) ascending). */
  order: Int32Array;
  /** Warm-start label per node (previous leaf / seed / directory group); ints, any values. */
  init: Int32Array;
  /** True where `init` came from a previous leaf (hysteresis applies). */
  warm: Uint8Array;
  /** Estimated sig-skeleton tokens per node (split rule). */
  sigTokens: Float64Array;
  /** γ used last time (tried first). */
  gammaHint?: number;
  tuning: Tuning;
  /**
   * No previous leaves and no seeds: the DirPartition start is a heuristic only, so a singleton start is tried too
   * and the partition with the higher modularity (clustering graph) wins. Warm starts are kept (id stability).
   */
  fresh: boolean;
}

export interface ClusterResult {
  /** Leaves as sorted node-index lists, in order of their first node. */
  leaves: number[][];
  /** Leaf is a single file above the hard cap. */
  oversize: boolean[];
  gamma: number;
  /** Clustering graph (dependency edges + directory prior). */
  ug: UGraph;
  /** Dependency-only undirected graph (modularity reporting). */
  dep: UGraph;
}

/** Undirected graphs over the file graph: with and without the directory prior. */
export function undirected(fg: FileGraph): { ug: UGraph; dep: UGraph } {
  const n = fg.paths.length;
  const dep: [number, number, number][] = [];
  fg.out.forEach((m, i) => {
    for (const [j, e] of m) dep.push([i, j, edgeWeight(e)]);
  });
  return { dep: buildUGraph(n, dep, fg.size), ug: buildUGraph(n, [...dep, ...fg.prior], fg.size) };
}

/** DirPartition (spec §6.2): directory subtrees up to 6k LOC; small direct-file groups join their smallest sibling group. */
export function dirPartition(paths: readonly RepoPath[], size: Float64Array, P: Tuning): Int32Array {
  const filesIn = new Map<string, number[]>();
  const children = new Map<string, Set<string>>();
  paths.forEach((p, i) => {
    const d = dirOf(p);
    const l = filesIn.get(d);
    if (l) l.push(i);
    else filesIn.set(d, [i]);
    for (let c = d; c !== ""; ) {
      const parent = dirOf(c);
      let set = children.get(parent);
      if (!set) {
        set = new Set();
        children.set(parent, set);
      }
      set.add(c);
      c = parent;
    }
  });
  const subtreeLoc = new Map<string, number>();
  const subtree = (d: string): number[] => [...(filesIn.get(d) ?? []), ...[...(children.get(d) ?? [])].flatMap(subtree)];
  const locOf = (xs: readonly number[]) => xs.reduce((a, i) => a + (size[i] as number), 0);
  const labels = new Int32Array(paths.length).fill(-1);
  let next = 0;
  const groupLoc: number[] = [];
  const group = (xs: readonly number[]): number => {
    const g = next++;
    for (const i of xs) labels[i] = g;
    groupLoc[g] = locOf(xs);
    return g;
  };
  const visit = (d: string): number[] => {
    const all = subtree(d);
    const kids = [...(children.get(d) ?? [])].sort();
    const loc = subtreeLoc.get(d) ?? locOf(all);
    subtreeLoc.set(d, loc);
    if (loc <= P.leafLocMax || kids.length === 0) return all.length > 0 ? [group(all)] : [];
    const made: number[] = [];
    for (const c of kids) made.push(...visit(c));
    const direct = filesIn.get(d) ?? [];
    if (direct.length === 0) return made;
    if (locOf(direct) >= P.leafLocMin || made.length === 0) made.push(group(direct));
    else {
      const smallest = made.reduce((a, b) => ((groupLoc[b] as number) < (groupLoc[a] as number) ? b : a));
      for (const i of direct) labels[i] = smallest;
      groupLoc[smallest] = (groupLoc[smallest] as number) + locOf(direct);
    }
    return made;
  };
  visit("");
  return labels;
}

/** Induced subgraph on `nodes` (indices into g) with local ids in the given order. */
function induced(g: UGraph, nodes: readonly number[]): UGraph {
  const local = new Map(nodes.map((v, i) => [v, i]));
  const edges: [number, number, number][] = [];
  nodes.forEach((v, i) => {
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const j = local.get(g.nbr[e] as number);
      if (j !== undefined && j > i) edges.push([i, j, g.w[e] as number]);
    }
  });
  return buildUGraph(
    nodes.length,
    edges,
    Float64Array.from(nodes, (v) => g.size[v] as number),
  );
}

const sum = (xs: readonly number[], arr: Float64Array) => xs.reduce((a, i) => a + (arr[i] as number), 0);

function groupsOf(labels: Int32Array, order: Int32Array): number[][] {
  const by = new Map<number, number[]>();
  for (let v = 0; v < labels.length; v++) {
    const l = labels[v] as number;
    const g = by.get(l);
    if (g) g.push(v);
    else by.set(l, [v]);
  }
  const out = [...by.values()].map((g) => g.sort((a, b) => a - b));
  const first = (g: number[]) => Math.min(...g.map((v) => order[v] as number));
  return out.sort((a, b) => first(a) - first(b));
}

/** Split a leaf above the hard caps by re-running Louvain on its subgraph with γ' = 2γ … (≤ 4 tries, spec §6.3-1). */
function splitLarge(ug: UGraph, leaf: number[], order: Int32Array, sig: Float64Array, gamma: number, P: Tuning): number[][] {
  const tooBig = (xs: readonly number[]) => sum(xs, ug.size) > P.leafLocHard || sum(xs, sig) > P.leafSkeletonTokensMax;
  if (!tooBig(leaf) || leaf.length < 2) return [leaf];
  const sub = induced(ug, leaf);
  const subOrder = Int32Array.from(leaf, (v) => order[v] as number);
  let parts: number[][] = [leaf];
  for (let k = 1, g = gamma * 2; k <= 4; k++, g *= 2) {
    const labels = splitDisconnected(sub, louvain(sub, { gamma: g, maxSize: P.leafLocHard, order: subOrder }), subOrder);
    parts = groupsOf(labels, subOrder).map((p) => p.map((i) => leaf[i] as number).sort((a, b) => a - b));
    if (parts.every((p) => !tooBig(p) || p.length === 1)) break;
  }
  return parts;
}

const commonPrefixLen = (a: string, b: string): number => {
  const x = a.split("/");
  const y = b.split("/");
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** Merge leaves below the soft minimum into their best neighbour (spec §6.3-2). */
function mergeSmall(
  ug: UGraph,
  leaves: number[][],
  paths: readonly RepoPath[],
  domDir: (xs: readonly number[]) => string,
  P: Tuning,
  exempt: (leaf: readonly number[]) => boolean = () => false,
): number[][] {
  const leafOf = new Int32Array(ug.n).fill(-1);
  leaves.forEach((l, i) => {
    for (const v of l) leafOf[v] = i;
  });
  const conn: Map<number, number>[] = leaves.map(() => new Map());
  for (let v = 0; v < ug.n; v++)
    for (let e = ug.start[v] as number; e < (ug.start[v + 1] as number); e++) {
      const a = leafOf[v] as number;
      const b = leafOf[ug.nbr[e] as number] as number;
      if (a < 0 || b < 0 || a === b) continue;
      conn[a]?.set(b, (conn[a]?.get(b) ?? 0) + (ug.w[e] as number) / 2);
    }
  const members = leaves.map((l) => [...l]);
  const loc = leaves.map((l) => sum(l, ug.size));
  const key = leaves.map((l) => paths[l[0] as number] as string);
  const dirs = members.map((m) => domDir(m));
  const alive = new Set(leaves.map((_, i) => i));
  for (;;) {
    const small = [...alive]
      .filter((i) => (loc[i] as number) < P.leafLocMin)
      .sort((a, b) => (loc[a] as number) - (loc[b] as number) || ((key[a] as string) < (key[b] as string) ? -1 : 1));
    let merged = false;
    for (const a of small) {
      if (!alive.has(a) || alive.size < 2 || exempt(members[a] as number[])) continue;
      let best = -1;
      let bestScore = -1;
      const better = (b: number, score: number) => {
        if (best < 0 || score > bestScore + 1e-12) return true;
        if (Math.abs(score - bestScore) > 1e-12) return false;
        const sameA = dirOf(dirs[a] as string) === dirOf(dirs[b] as string);
        const sameBest = dirOf(dirs[a] as string) === dirOf(dirs[best] as string);
        if (sameA !== sameBest) return sameA;
        if (loc[b] !== loc[best]) return (loc[b] as number) < (loc[best] as number);
        return (key[b] as string) < (key[best] as string);
      };
      // prefer partners that keep the merged leaf within the soft maximum (2k–6k target), then the hard cap
      for (const cap of [P.leafLocTarget, P.leafLocMax, P.leafLocHard]) {
        for (const [b, w] of conn[a] ?? []) {
          if (!alive.has(b) || (loc[a] as number) + (loc[b] as number) > cap) continue;
          const s = w / Math.sqrt(loc[b] as number);
          if (better(b, s)) {
            best = b;
            bestScore = s;
          }
        }
        if (best >= 0) break;
      }
      if (best < 0)
        for (const cap of [P.leafLocTarget, P.leafLocMax, P.leafLocHard]) {
          for (const b of alive) {
            if (b === a || (loc[a] as number) + (loc[b] as number) > cap) continue;
            const s = commonPrefixLen(dirs[a] as string, dirs[b] as string);
            // unrelated islands (no edge, no shared directory) stay apart; root-level files may join anything
            if (s === 0 && dirs[a] !== ".") continue;
            if (better(b, s)) {
              best = b;
              bestScore = s;
            }
          }
          if (best >= 0) break;
        }
      if (best < 0) continue;
      // merge a into best
      members[best] = [...(members[best] as number[]), ...(members[a] as number[])];
      loc[best] = (loc[best] as number) + (loc[a] as number);
      if ((key[a] as string) < (key[best] as string)) key[best] = key[a] as string;
      for (const [c, w] of conn[a] ?? []) {
        if (c === best) continue;
        conn[best]?.set(c, (conn[best]?.get(c) ?? 0) + w);
        conn[c]?.set(best, (conn[c]?.get(best) ?? 0) + w);
        conn[c]?.delete(a);
      }
      conn[best]?.delete(a);
      alive.delete(a);
      dirs[best] = domDir(members[best] as number[]);
      merged = true;
    }
    if (!merged) break;
  }
  return [...alive].map((i) => (members[i] as number[]).sort((x, y) => x - y)).sort((x, y) => (x[0] as number) - (y[0] as number));
}

/** Leaf partition for one γ (Louvain → BFS split → size post-processing). */
interface RunResult {
  leaves: number[][];
  oversize: boolean[];
  /** LOC-weighted median community size before merging (monotone in γ; steers the search). */
  raw: number;
}

function runOnce(c: ClusterInput, ug: UGraph, gamma: number, domDir: (xs: readonly number[]) => string): RunResult {
  const a = runFrom(c, ug, gamma, domDir, c.init);
  if (!c.fresh) return a;
  const b = runFrom(c, ug, gamma, domDir, null);
  return modularity(ug, labelsOf(b.leaves, ug.n)) > modularity(ug, labelsOf(a.leaves, ug.n)) + TIE ? b : a;
}

function labelsOf(leaves: readonly number[][], n: number): Int32Array {
  const out = new Int32Array(n);
  leaves.forEach((l, i) => {
    for (const v of l) out[v] = i;
  });
  return out;
}

function runFrom(c: ClusterInput, ug: UGraph, gamma: number, domDir: (xs: readonly number[]) => string, init: Int32Array | null): RunResult {
  const P = c.tuning;
  const labels = splitDisconnected(
    ug,
    louvain(ug, { gamma, maxSize: P.leafLocHard, order: c.order, init, hysteresis: P.hysteresis, maxLevels: P.maxLevels }),
    c.order,
  );
  let leaves = groupsOf(labels, c.order).flatMap((l) => splitLarge(ug, l, c.order, c.sigTokens, gamma, P));
  const raw = weightedMedian(leaves.map((l) => sum(l, ug.size)));
  leaves = mergeSmall(ug, leaves, c.fg.paths, domDir, P, unchangedWarmLeaf(c));
  return { leaves, oversize: leaves.map((l) => l.length === 1 && (ug.size[l[0] as number] as number) > P.leafLocHard), raw };
}

/**
 * A leaf that is exactly a previous leaf (every member warm-started in the same community, none missing) was already
 * below the minimum and survived: merging it now would only churn its id (spec §6.6 requirement 2).
 */
function unchangedWarmLeaf(c: ClusterInput): (leaf: readonly number[]) => boolean {
  const warmCount = new Map<number, number>();
  for (let v = 0; v < c.init.length; v++) if (c.warm[v]) warmCount.set(c.init[v] as number, (warmCount.get(c.init[v] as number) ?? 0) + 1);
  return (leaf) => {
    const label = c.init[leaf[0] as number] as number;
    return leaf.every((v) => c.warm[v] === 1 && c.init[v] === label) && warmCount.get(label) === leaf.length;
  };
}

/** Size of the community holding the median LOC unit (tiny communities barely move it). */
function weightedMedian(sizes: readonly number[]): number {
  const sorted = [...sizes].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x;
    if (acc >= total / 2) return x;
  }
  return 0;
}

function stats(leaves: readonly number[][], size: Float64Array, P: Tuning): { median: number; inRange: number } {
  const locs = leaves.map((l) => sum(l, size)).sort((a, b) => a - b);
  if (locs.length === 0) return { median: 0, inRange: 1 };
  const mid = locs.length >> 1;
  const median = locs.length % 2 === 1 ? (locs[mid] as number) : ((locs[mid - 1] as number) + (locs[mid] as number)) / 2;
  const inRange = locs.filter((x) => x >= P.leafLocMin / 2 && x <= P.leafLocHard).length / locs.length;
  return { median, inRange };
}

/** Cluster the file graph into leaves, searching γ (spec §6.2 "γ の決め方"). */
export function clusterLeaves(c: ClusterInput, domDir: (xs: readonly number[]) => string): ClusterResult {
  const P = c.tuning;
  const { ug, dep } = undirected(c.fg);
  const n = c.fg.paths.length;
  const total = sum(
    Array.from({ length: n }, (_, i) => i),
    c.fg.size,
  );
  if (n === 0) return { leaves: [], oversize: [], gamma: 1, ug, dep };
  if (total < P.leafLocMin) return { leaves: [Array.from({ length: n }, (_, i) => i)], oversize: [false], gamma: c.gammaHint ?? 1, ug, dep };
  type Stats = ReturnType<typeof stats>;
  type Best = { gamma: number; r: ReturnType<typeof runOnce>; s: Stats };
  const ok = (s: Stats) => s.median >= P.leafLocMin && s.median <= P.leafLocMax && s.inRange >= 0.8;
  const dist = (s: Stats) => Math.abs(Math.log(Math.max(1, s.median) / P.leafLocTarget));
  const state: { best: Best | null } = { best: null };
  const consider = (gamma: number): { stats: Stats; best: Best; raw: number } => {
    const r = runOnce(c, ug, gamma, domDir);
    const st = stats(r.leaves, c.fg.size, P);
    const cur = state.best;
    if (!cur || (ok(st) && !ok(cur.s)) || (ok(st) === ok(cur.s) && dist(st) < dist(cur.s) - 1e-12)) state.best = { gamma, r, s: st };
    return { stats: st, best: state.best as Best, raw: r.raw };
  };
  if (c.gammaHint !== undefined) {
    const { stats: st, best } = consider(c.gammaHint);
    if (ok(st)) return finish(best, ug, dep);
  }
  let lo = Math.log(P.gammaMin);
  let hi = Math.log(P.gammaMax);
  let last: Best | null = null;
  for (let step = 0; step < P.gammaSteps; step++) {
    const mid = (lo + hi) / 2;
    // the final median is not monotone in γ (merging re-grows small leaves): steer on the pre-merge weighted median
    const { best, raw } = consider(Math.round(Math.exp(mid) * 1e6) / 1e6);
    last = best;
    if (raw > P.leafLocTarget) lo = mid;
    else hi = mid;
  }
  return finish(last as Best, ug, dep);
}

function finish(b: { gamma: number; r: RunResult }, ug: UGraph, dep: UGraph): ClusterResult {
  return { leaves: b.r.leaves, oversize: b.r.oversize, gamma: b.gamma, ug, dep };
}
