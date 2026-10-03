/**
 * Leaf clustering (spec §6.2–6.3 改訂 R1): directory-prior graph → atoms (directory units, `atoms.ts`) → warm start
 * (previous leaves / seeds / DirPartition) → γ search over deterministic Louvain on the atom graph + BFS split → size
 * post-processing (split > 9k LOC or > 24k sig tokens, merge < 2k LOC into a neighbour of the same scope and directory).
 */
import type { RepoPath } from "@mitori/core";
import { dirOf, type StageFile } from "../resolve/files.ts";
import { type Atoms, buildAtoms, groupsOf, induced } from "./atoms.ts";
import { edgeWeight, type FileGraph } from "./graph.ts";
import { buildUGraph, louvain, modularity, splitDisconnected, type UGraph } from "./louvain.ts";
import { TIE } from "./quantize.ts";
import type { Tuning } from "./tuning.ts";

export interface ClusterInput {
  fg: FileGraph;
  /** Stage files by path (languages, Go package clauses, scopes). */
  files: ReadonlyMap<RepoPath, StageFile>;
  /** Visit rank per node (xxh3("ord|" + path) ascending). */
  order: Int32Array;
  /** Warm-start label per node (previous leaf / seed / directory group); ints, any values. */
  init: Int32Array;
  /** True where `init` came from a previous leaf (hysteresis applies). */
  warm: Uint8Array;
  /** Estimated sig-skeleton tokens per node (split rule). */
  sigTokens: Float64Array;
  /** γ used last time (kept when it still satisfies the size rule). */
  gammaHint?: number;
  tuning: Tuning;
  /**
   * No previous leaves and no seeds: the DirPartition start is a heuristic only, so a singleton start is tried too
   * and the partition with the higher modularity wins. Warm starts are kept (id stability).
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

/** γ values tried by the search (log-spaced; the previous γ is tried first). */
const GAMMA_GRID = [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16];

/** Multipliers of the extra visit orders a first clustering tries (0 = the base order). */
const FRESH_ORDERS = [0, 48271, 69621, 16807];

/** A fixed permutation of a visit order: ranks of `order[v] · k mod (2³¹ − 1)` (k = 0 keeps the order). */
function permutedOrder(order: Int32Array, k: number): Int32Array {
  if (k === 0) return order;
  const M = 2147483647;
  const key = Array.from(order, (o) => Number((BigInt(o + 1) * BigInt(k)) % BigInt(M)));
  const idx = Array.from(order, (_, i) => i).sort((a, b) => (key[a] as number) - (key[b] as number));
  const out = new Int32Array(order.length);
  idx.forEach((v, r) => {
    out[v] = r;
  });
  return out;
}

/**
 * Undirected graphs over the file graph: with and without the directory prior. Edges between files of different
 * scopes (an example or a script using the library) are left out when `scopeOf` is given: those scopes cluster apart
 * (IDX-D12), so their usage edges are neither a reason to merge nor counted against the partition's modularity.
 */
export function undirected(fg: FileGraph, scopeOf?: (node: number) => string): { ug: UGraph; dep: UGraph } {
  const n = fg.paths.length;
  const dep: [number, number, number][] = [];
  fg.out.forEach((m, i) => {
    for (const [j, e] of m) if (scopeOf === undefined || scopeOf(i) === scopeOf(j)) dep.push([i, j, edgeWeight(e)]);
  });
  return { dep: buildUGraph(n, dep, fg.size), ug: buildUGraph(n, [...dep, ...fg.prior], fg.size) };
}

/** Scope of a graph node (`main` when unknown). */
export function nodeScope(fg: FileGraph, files: ReadonlyMap<RepoPath, StageFile>): (node: number) => string {
  return (v) => files.get(fg.paths[v] as string)?.scope ?? "main";
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
    if (locOf(all) <= P.leafLocMax || kids.length === 0) return all.length > 0 ? [group(all)] : [];
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

/** Collapse the atoms of `g` into nodes (internal weight becomes a self loop, so modularity is preserved). */
function contract(g: UGraph, atoms: Atoms): UGraph {
  const A = atoms.members.length;
  const size = new Float64Array(A);
  const self = new Float64Array(A);
  const edges = new Map<number, number>();
  for (let v = 0; v < g.n; v++) {
    const a = atoms.of[v] as number;
    size[a] = (size[a] as number) + (g.size[v] as number);
    self[a] = (self[a] as number) + (g.self[v] as number);
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const u = g.nbr[e] as number;
      if (u < v) continue;
      const b = atoms.of[u] as number;
      const w = g.w[e] as number;
      if (a === b) self[a] = (self[a] as number) + w;
      else {
        const k = a < b ? a * A + b : b * A + a;
        edges.set(k, (edges.get(k) ?? 0) + w);
      }
    }
  }
  const list: [number, number, number][] = [...edges].sort((x, y) => x[0] - y[0]).map(([k, w]) => [Math.floor(k / A), k % A, w]);
  return buildUGraph(A, list, size, self);
}

const sum = (xs: readonly number[], arr: Float64Array) => xs.reduce((a, i) => a + (arr[i] as number), 0);

const segsOf = (d: string): string[] => (d === "." || d === "" ? [] : d.split("/"));
const commonPrefixLen = (x: readonly string[], y: readonly string[]): number => {
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** The atom-level view the size post-processing works on. */
interface AtomView {
  ag: UGraph;
  order: Int32Array;
  sig: Float64Array;
  /** Dominant directory of a set of atoms. */
  dirOf(atoms: readonly number[]): string;
  /** Majority scope (by LOC) of a set of atoms. */
  scopeOf(atoms: readonly number[]): string;
  /** Majority language family (by LOC, files without a parser ignored) of a set of atoms. */
  familyOf(atoms: readonly number[]): string;
  /** First path (sort key) of a set of atoms. */
  keyOf(atoms: readonly number[]): string;
}

/** Split a leaf above the hard caps by re-running Louvain on its atom subgraph with γ' = 2γ … (≤ 4 tries, spec §6.3-1). */
function splitLarge(v: AtomView, leaf: number[], gamma: number, P: Tuning): number[][] {
  const tooBig = (xs: readonly number[]) => sum(xs, v.ag.size) > P.leafLocHard || sum(xs, v.sig) > P.leafSkeletonTokensMax;
  if (!tooBig(leaf) || leaf.length < 2) return [leaf];
  const sub = induced(v.ag, leaf);
  const subOrder = Int32Array.from(leaf, (a) => v.order[a] as number);
  let parts: number[][] = [leaf];
  for (let k = 1, g = gamma * 2; k <= 4; k++, g *= 2) {
    const labels = splitDisconnected(sub, louvain(sub, { gamma: g, maxSize: P.leafLocHard, order: subOrder }), subOrder);
    parts = groupsOf(labels, subOrder).map((p) => p.map((i) => leaf[i] as number).sort((a, b) => a - b));
    if (parts.every((p) => !tooBig(p) || p.length === 1)) break;
  }
  return parts;
}

/**
 * Merge leaves below the minimum (spec §6.3-2) into the best neighbour: same scope first (examples and tooling stay
 * apart from the main code while they are not tiny), then a leaf sharing the small leaf's parent directory, then the
 * connection weight / sqrt(LOC) of the partner. Isolated leaves go to the leaf with the longest common directory.
 * A merge never exceeds the size caps; partners that keep the result ≤ 4k, then ≤ 6k, then ≤ 9k LOC are preferred.
 */
function mergeSmall(v: AtomView, leaves: number[][], P: Tuning, minLoc: number, exempt: (leaf: readonly number[]) => boolean): number[][] {
  const { ag } = v;
  const leafOf = new Int32Array(ag.n).fill(-1);
  leaves.forEach((l, i) => {
    for (const a of l) leafOf[a] = i;
  });
  const conn: Map<number, number>[] = leaves.map(() => new Map());
  for (let a = 0; a < ag.n; a++)
    for (let e = ag.start[a] as number; e < (ag.start[a + 1] as number); e++) {
      const x = leafOf[a] as number;
      const y = leafOf[ag.nbr[e] as number] as number;
      if (x < 0 || y < 0 || x === y) continue;
      conn[x]?.set(y, (conn[x]?.get(y) ?? 0) + (ag.w[e] as number) / 2);
    }
  const members = leaves.map((l) => [...l]);
  const loc = leaves.map((l) => sum(l, ag.size));
  const tok = leaves.map((l) => sum(l, v.sig));
  const key = leaves.map((l) => v.keyOf(l));
  const dirs = leaves.map((l) => segsOf(v.dirOf(l)));
  const scopes = leaves.map((l) => v.scopeOf(l));
  const families = leaves.map((l) => v.familyOf(l));
  const fits = (a: number, b: number, cap: number) =>
    (loc[a] as number) + (loc[b] as number) <= cap && (tok[a] as number) + (tok[b] as number) <= P.leafSkeletonTokensMax;
  const alive = new Set(leaves.map((_, i) => i));
  const caps = [P.leafLocTarget, P.leafLocMax, P.leafLocHard];
  /** Preference tuple of partner b for small leaf a (compared lexicographically, higher first). */
  const pref = (a: number, b: number): number[] => {
    const da = dirs[a] as string[];
    const cp = commonPrefixLen(da, dirs[b] as string[]);
    const w = conn[a]?.get(b) ?? 0;
    // an unconnected island of another language (a Go service next to a TS app) is the last choice
    const sameFamily = families[a] === families[b] || families[a] === "" || families[b] === "" ? 1 : 0;
    return [
      scopes[a] === scopes[b] ? 1 : 0,
      w > 0 || sameFamily ? 1 : 0,
      cp >= da.length - 1 ? 1 : 0,
      w > 0 ? w / Math.sqrt(loc[b] as number) : 0,
      cp,
      -(loc[b] as number),
    ];
  };
  const better = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) {
      const d = (x[i] as number) - (y[i] as number);
      if (Math.abs(d) > 1e-12) return d > 0;
    }
    return false;
  };
  for (;;) {
    const small = [...alive]
      .filter((i) => (loc[i] as number) < minLoc)
      .sort((a, b) => (loc[a] as number) - (loc[b] as number) || ((key[a] as string) < (key[b] as string) ? -1 : 1));
    let merged = false;
    for (const a of small) {
      // (a leaf that absorbed others earlier in this round may have grown past the minimum)
      if (!alive.has(a) || alive.size < 2 || (loc[a] as number) >= minLoc || exempt(members[a] as number[])) continue;
      let best = -1;
      let bestPref: number[] = [];
      for (const cap of caps) {
        for (const b of alive) {
          if (b === a || !fits(a, b, cap)) continue;
          const p = pref(a, b);
          if (best < 0 || better(p, bestPref) || (!better(bestPref, p) && (key[b] as string) < (key[best] as string))) {
            best = b;
            bestPref = p;
          }
        }
        if (best >= 0) break;
      }
      // above the soft maximum only for a tiny leaf
      if (best >= 0 && (loc[a] as number) + (loc[best] as number) > P.leafLocMax && (loc[a] as number) >= minLoc / 2) continue;
      // a leaf of another scope (examples, tooling) that is not tiny keeps its own chapter
      if (best < 0 || (bestPref[0] === 0 && (loc[a] as number) >= minLoc / 4)) continue;
      members[best] = [...(members[best] as number[]), ...(members[a] as number[])];
      loc[best] = (loc[best] as number) + (loc[a] as number);
      tok[best] = (tok[best] as number) + (tok[a] as number);
      if ((key[a] as string) < (key[best] as string)) key[best] = key[a] as string;
      for (const [c, w] of conn[a] ?? []) {
        if (c === best) continue;
        conn[best]?.set(c, (conn[best]?.get(c) ?? 0) + w);
        conn[c]?.set(best, (conn[c]?.get(best) ?? 0) + w);
        conn[c]?.delete(a);
      }
      conn[best]?.delete(a);
      alive.delete(a);
      dirs[best] = segsOf(v.dirOf(members[best] as number[]));
      scopes[best] = v.scopeOf(members[best] as number[]);
      families[best] = v.familyOf(members[best] as number[]);
      merged = true;
    }
    if (!merged) break;
  }
  return [...alive].map((i) => (members[i] as number[]).sort((x, y) => x - y)).sort((x, y) => (x[0] as number) - (y[0] as number));
}

interface RunResult {
  /** Leaves as atom lists. */
  leaves: number[][];
  /** Modularity of the leaf partition on the dependency graph (γ = 1). */
  q: number;
}

interface Stats {
  median: number;
  inRange: number;
}

function stats(leaves: readonly number[][], size: Float64Array, P: Tuning, minLoc: number): Stats {
  const locs = leaves.map((l) => sum(l, size)).sort((a, b) => a - b);
  if (locs.length === 0) return { median: 0, inRange: 1 };
  const mid = locs.length >> 1;
  const median = locs.length % 2 === 1 ? (locs[mid] as number) : ((locs[mid - 1] as number) + (locs[mid] as number)) / 2;
  const inRange = locs.filter((x) => x >= minLoc / 2 && x <= P.leafLocHard).length / locs.length;
  return { median, inRange };
}

/** Atom labels from node labels: the label holding most of the atom's LOC (ties: smallest label). */
function atomLabels(atoms: Atoms, labels: Int32Array, size: Float64Array): Int32Array {
  return Int32Array.from(atoms.members, (m) => {
    const by = new Map<number, number>();
    for (const v of m) by.set(labels[v] as number, (by.get(labels[v] as number) ?? 0) + (size[v] as number));
    return [...by].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  });
}

const FAMILY: Record<string, string> = { typescript: "js", tsx: "js", javascript: "js", jsx: "js" };

/** Majority language family (by LOC) of graph nodes; files without a parser only when nothing else is there. */
function familyOfNodes(c: ClusterInput, nodes: readonly number[]): string {
  const by = new Map<string, number>();
  for (const v of nodes) {
    const lang = c.files.get(c.fg.paths[v] as string)?.lang ?? "generic";
    const f = lang === "generic" ? "" : (FAMILY[lang] ?? lang);
    by.set(f, (by.get(f) ?? 0) + (c.fg.size[v] as number));
  }
  if (by.size > 1) by.delete("");
  return [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "";
}

/** Majority scope (by LOC) of graph nodes. */
function scopeOfNodes(c: ClusterInput, nodes: readonly number[]): string {
  const by = new Map<string, number>();
  for (const v of nodes) {
    const s = c.files.get(c.fg.paths[v] as string)?.scope ?? "main";
    by.set(s, (by.get(s) ?? 0) + (c.fg.size[v] as number));
  }
  return [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "main";
}

/** Cluster the file graph into leaves, searching γ (spec §6.2 "γ の決め方"; selection: modularity among size-valid γ). */
export function clusterLeaves(c: ClusterInput, domDir: (xs: readonly number[]) => string): ClusterResult {
  const P = c.tuning;
  const { ug, dep } = undirected(c.fg, nodeScope(c.fg, c.files));
  const n = c.fg.paths.length;
  const total = sum(
    Array.from({ length: n }, (_, i) => i),
    c.fg.size,
  );
  if (n === 0) return { leaves: [], oversize: [], gamma: 1, ug, dep };
  if (total < P.leafLocMin) return { leaves: [Array.from({ length: n }, (_, i) => i)], oversize: [false], gamma: c.gammaHint ?? 1, ug, dep };
  // a small repo still gets a few chapters (IDX-AT-32: flask / m3e have ≥ 3 leaves)
  const minLoc = Math.min(P.leafLocMin, Math.max(P.leafLocMin / 4, total / 6));
  const atoms = buildAtoms({ fg: c.fg, files: c.files, ug, order: c.order, sig: c.sigTokens, tuning: P });
  const A = atoms.members.length;
  const ag = contract(ug, atoms);
  const ad = contract(dep, atoms);
  const aOrder = Int32Array.from(atoms.members, (m) => Math.min(...m.map((v) => c.order[v] as number)));
  const aSig = Float64Array.from(atoms.members, (m) => sum(m, c.sigTokens));
  const aInit = atomLabels(atoms, c.init, c.fg.size);
  const aWarm = Uint8Array.from(atoms.members, (m) => (m.every((v) => c.warm[v] === 1 && c.init[v] === c.init[m[0] as number]) ? 1 : 0));
  const nodesOf = (xs: readonly number[]) => xs.flatMap((a) => atoms.members[a] as number[]);
  const view: AtomView = {
    ag,
    order: aOrder,
    sig: aSig,
    dirOf: (xs) => domDir(nodesOf(xs)),
    scopeOf: (xs) => scopeOfNodes(c, nodesOf(xs)),
    familyOf: (xs) => familyOfNodes(c, nodesOf(xs)),
    keyOf: (xs) => {
      let k = "";
      for (const v of nodesOf(xs)) {
        const p = c.fg.paths[v] as string;
        if (k === "" || p < k) k = p;
      }
      return k;
    },
  };
  // a leaf that is exactly a previous small leaf survived as such: merging it now would only churn its id (§6.6-2)
  const warmCount = new Map<number, number>();
  for (let a = 0; a < A; a++) if (aWarm[a]) warmCount.set(aInit[a] as number, (warmCount.get(aInit[a] as number) ?? 0) + 1);
  const exempt = (leaf: readonly number[]) => {
    const label = aInit[leaf[0] as number] as number;
    return leaf.every((a) => aWarm[a] === 1 && aInit[a] === label) && warmCount.get(label) === leaf.length;
  };
  const run = (gamma: number, init: Int32Array | null, visit: Int32Array): RunResult => {
    const labels = splitDisconnected(
      ag,
      louvain(ag, { gamma, maxSize: P.leafLocMax, order: visit, init, hysteresis: P.hysteresis, maxLevels: P.maxLevels }),
      aOrder,
    );
    let leaves = groupsOf(labels, aOrder).flatMap((l) => splitLarge(view, l, gamma, P));
    leaves = mergeSmall(view, leaves, P, minLoc, exempt);
    // polish: single-atom moves at γ = 1 (the reported modularity) within the soft cap, then re-merge what fell short
    const cur = new Int32Array(A);
    leaves.forEach((l, i) => {
      for (const a of l) cur[a] = i;
    });
    const polished = splitDisconnected(ag, louvain(ag, { gamma: 1, maxSize: P.leafLocMax, order: visit, init: cur, maxLevels: 1 }), aOrder);
    leaves = mergeSmall(view, groupsOf(polished, aOrder), P, minLoc, exempt);
    const out = new Int32Array(A);
    leaves.forEach((l, i) => {
      for (const a of l) out[a] = i;
    });
    return { leaves, q: modularity(ad, out) };
  };
  type Best = { gamma: number; r: RunResult; s: Stats };
  const ok = (s: Stats) => s.median >= minLoc && s.median <= P.leafLocMax && s.inRange >= 0.8;
  const dist = (s: Stats) => Math.abs(Math.log(Math.max(1, s.median) / P.leafLocTarget));
  const better = (x: Best, y: Best | null) => {
    if (y === null) return true;
    if (ok(x.s) !== ok(y.s)) return ok(x.s);
    if (!ok(x.s)) return dist(x.s) < dist(y.s) - 1e-12;
    if (Math.abs(x.r.q - y.r.q) > TIE) return x.r.q > y.r.q;
    return dist(x.s) < dist(y.s) - 1e-12;
  };
  const consider = (gamma: number, init: Int32Array | null, visit: Int32Array = aOrder): Best => {
    const r = run(gamma, init, visit);
    return { gamma, r, s: stats(r.leaves, ag.size, P, minLoc) };
  };
  let best: Best | null = null;
  if (c.gammaHint !== undefined) {
    const b = consider(c.gammaHint, aInit);
    // the previous γ is kept while it still satisfies the size rule (stable partitions across refreshes)
    if (ok(b.s) && !c.fresh) return finish(b, atoms, c.fg, ug, dep, P);
    best = b;
  }
  // a first clustering starts from the atoms alone (they already carry the directory structure); a warm one from
  // the previous leaves
  // (several fixed visit orders per γ: Louvain is greedy, and a first clustering has no previous leaves to keep)
  const start = c.fresh ? null : aInit;
  const visits = c.fresh ? FRESH_ORDERS.map((k) => permutedOrder(aOrder, k)) : [aOrder];
  for (const g of GAMMA_GRID)
    for (const visit of visits) {
      const b = consider(g, start, visit);
      if (better(b, best)) best = b;
    }
  return finish(best as Best, atoms, c.fg, ug, dep, P);
}

function finish(b: { gamma: number; r: RunResult }, atoms: Atoms, fg: FileGraph, ug: UGraph, dep: UGraph, P: Tuning): ClusterResult {
  const leaves = b.r.leaves
    .map((l) => l.flatMap((a) => atoms.members[a] as number[]).sort((x, y) => x - y))
    .sort((x, y) => (x[0] as number) - (y[0] as number));
  return {
    leaves,
    oversize: leaves.map((l) => l.length === 1 && (fg.size[l[0] as number] as number) > P.leafLocHard),
    gamma: b.gamma,
    ug,
    dep,
  };
}
