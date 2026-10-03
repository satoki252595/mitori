/**
 * Structure refresh without re-clustering (spec §6.8): when ≤ 10 % of the graph files changed since the last
 * clustering and no leaf left its size range, the previous leaves are carried over — deleted files leave, new files
 * join the module of their strongest resolved neighbours (else a module of the same directory, else the nearest one).
 */
import type { RepoPath } from "@mitori/core";
import { STRUCTURE_PARAMS } from "../contract.ts";
import { dirOf } from "../resolve/files.ts";
import { edgeWeight, type FileGraph } from "./graph.ts";
import type { PrevModule } from "./identity.ts";
import type { Tuning } from "./tuning.ts";

export interface CarryInput {
  fg: FileGraph;
  /** Alive previous leaves. */
  prevLeaves: readonly PrevModule[];
  /** path → blob at the last clustering (`idx_meta structure.base`). */
  base: ReadonlyMap<RepoPath, string> | undefined;
  blobOf(path: RepoPath): string;
  force: boolean;
  tuning: Tuning;
  /**
   * Seed restore (fresh machine, `doc.index.json` only): the leaves are rebuilt from the seeds' representative paths
   * plus the neighbour vote, without the changed-files check (there is no base), so the committed chapters come back.
   */
  seeded?: boolean;
}

const commonPrefix = (a: string, b: string): number => {
  const x = a.split("/");
  const y = b.split("/");
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** Leaves as node-index lists (ordered by first node), or null when the clustering must run again. */
export function carryOver(c: CarryInput): number[][] | null {
  const { fg } = c;
  if (c.force || c.prevLeaves.length === 0) return null;
  if (!c.seeded) {
    if (!c.base) return null;
    let changed = 0;
    for (const p of fg.paths) if (c.base.get(p) !== c.blobOf(p)) changed++;
    for (const p of c.base.keys()) if (!fg.index.has(p)) changed++;
    if (changed / Math.max(1, fg.paths.length) > STRUCTURE_PARAMS.reclusterChangedRatio) return null;
  }

  const leaves = [...c.prevLeaves].sort((a, b) => (a.id < b.id ? -1 : 1));
  const leafOf = new Int32Array(fg.paths.length).fill(-1);
  leaves.forEach((m, li) => {
    for (const p of c.seeded ? m.reps : m.members) {
      const i = fg.index.get(p);
      if (i !== undefined) leafOf[i] = li;
    }
  });
  assignNewcomers(fg, leafOf);
  const groups = new Map<number, number[]>();
  for (let v = 0; v < fg.paths.length; v++) {
    const l = leafOf[v] as number;
    if (l < 0) return null;
    const g = groups.get(l);
    if (g) g.push(v);
    else groups.set(l, [v]);
  }
  // a leaf that left its size range forces a re-clustering
  const t = c.tuning;
  for (const [l, g] of groups) {
    const loc = g.reduce((s, v) => s + (fg.size[v] as number), 0);
    // seeds carry no sizes: a stale doc.index.json whose few surviving reps soak up the whole repo must cluster
    if (c.seeded) {
      if (g.length > 1 && loc > t.leafLocHard) return null;
      continue;
    }
    const before = leaves[l]?.loc ?? loc;
    if (g.length > 1 && loc > t.leafLocHard && before <= t.leafLocHard) return null;
    if (loc < t.leafLocMin && before >= t.leafLocMin) return null;
  }
  return [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number));
}

/**
 * Files without a leaf (`leafOf[v] = -1`) join the leaf of their strongest resolved neighbours, else a leaf of the
 * same directory, else the leaf with the longest common directory prefix (spec §6.8). Left at -1 only when no file has
 * a leaf at all.
 */
export function assignNewcomers(fg: FileGraph, leafOf: Int32Array): void {
  // undirected dependency weights for the newcomers' vote
  const nbrs = new Map<number, Map<number, number>>();
  const add = (a: number, b: number, w: number) => {
    let m = nbrs.get(a);
    if (!m) {
      m = new Map();
      nbrs.set(a, m);
    }
    m.set(b, (m.get(b) ?? 0) + w);
  };
  fg.out.forEach((m, i) => {
    for (const [j, e] of m) {
      if (leafOf[i] === -1 || leafOf[j] === -1) {
        add(i, j, edgeWeight(e));
        add(j, i, edgeWeight(e));
      }
    }
  });
  for (let v = 0; v < fg.paths.length; v++) {
    if (leafOf[v] !== -1) continue;
    const votes = new Map<number, number>();
    for (const [u, w] of nbrs.get(v) ?? []) {
      const l = leafOf[u] as number;
      if (l >= 0) votes.set(l, (votes.get(l) ?? 0) + w);
    }
    let pick = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    if (pick === undefined) {
      const dir = dirOf(fg.paths[v] as string);
      let best = -1;
      let bestLen = -1;
      for (let u = 0; u < fg.paths.length; u++) {
        const l = leafOf[u] as number;
        if (l < 0) continue;
        const len = dirOf(fg.paths[u] as string) === dir ? Number.MAX_SAFE_INTEGER : commonPrefix(dirOf(fg.paths[u] as string), dir);
        if (len > bestLen || (len === bestLen && l < best)) {
          best = l;
          bestLen = len;
        }
      }
      pick = best >= 0 ? best : undefined;
    }
    if (pick !== undefined) leafOf[v] = pick;
  }
}
