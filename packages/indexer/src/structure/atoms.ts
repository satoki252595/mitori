/**
 * Clustering atoms (spec §6.1 directory prior, made structural): groups of graph files the leaf clustering moves as
 * one unit, so that leaves follow the directory tree wherever the tree is a real unit of the code.
 *
 * - The direct files of one directory form a group per language unit (a Go package = directory + `package` clause;
 *   otherwise one group per language family). A group stays whole when the free partition (Louvain on the files at
 *   γ = 1 without directory constraint) keeps most of its LOC in one community: ≥ 50 % for groups the language makes
 *   a unit (Go package, Rust module directory, Python package with `__init__.py`, JS/TS directory with an `index.*` /
 *   `mod.ts` entry), ≥ 75 % for any other directory. A group the graph does not agree with (a layer such as
 *   `components/` next to `lib/`) is dissolved into its pieces per free community: files of one directory that the
 *   graph also puts together still move together.
 * - Files without a parser (`generic`: CSS, HTML, shell, data) ride along with the largest group of their directory,
 *   else form a group of their own (placed by the directory prior).
 * - A collection — a directory of sibling sub-directories such as `src/middleware/<name>/` whose subtree fits one leaf —
 *   is one atom (see {@link collections}).
 * - A group too large for one leaf (LOC above the soft maximum, or a sig skeleton above ¾ of the leaf cap) is cut along
 *   its free-partition pieces, re-joined while they fit, so a big Go package becomes a few leaves of that package
 *   instead of fragments spread over unrelated leaves.
 */
import type { RepoPath } from "@mitori/core";
import { baseOf, dirOf, type StageFile } from "../resolve/files.ts";
import type { FileGraph } from "./graph.ts";
import { buildUGraph, louvain, splitDisconnected, type UGraph } from "./louvain.ts";
import type { Tuning } from "./tuning.ts";

export interface AtomInput {
  fg: FileGraph;
  files: ReadonlyMap<RepoPath, StageFile>;
  /** Clustering graph (dependency + directory prior). */
  ug: UGraph;
  /** Visit rank per node. */
  order: Int32Array;
  /** Estimated sig-skeleton tokens per node. */
  sig: Float64Array;
  tuning: Tuning;
}

export interface Atoms {
  /** Atom index per graph node. */
  of: Int32Array;
  /** Members per atom (ascending node indices); atoms are numbered by their first member in visit order. */
  members: number[][];
}

/** Share of a directory group's LOC that one community of the free partition must hold to keep the group whole. */
const AGREEMENT = 0.75;
/** Files that make a JS/TS directory a unit (its entry / barrel). */
const ENTRY_RE = /^(index\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)|mod\.ts)$/;

const family = (lang: string): string => (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx" ? "js" : lang);

/** Group key of a file within its directory (`null` = no parser: rides along, see the module comment). */
function unitOf(f: StageFile): string | null {
  if (f.lang === "generic") return null;
  if (f.lang === "go") return `go:${f.headings?.[0]?.text ?? ""}`;
  return family(f.lang);
}

/** True when the language makes a directory's files one unit. */
function languageUnit(unit: string, members: readonly StageFile[]): boolean {
  if (unit.startsWith("go:") || unit === "rust") return true;
  if (unit === "python") return members.some((f) => baseOf(f.path) === "__init__.py");
  if (unit === "js") return members.some((f) => ENTRY_RE.test(baseOf(f.path)));
  return false;
}

const sum = (xs: readonly number[], arr: Float64Array) => xs.reduce((a, i) => a + (arr[i] as number), 0);

/** Induced subgraph on `nodes` (local ids in the given order). */
export function induced(g: UGraph, nodes: readonly number[]): UGraph {
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

/** Dense groups of `labels`, each ascending, ordered by their first member in visit order. */
export function groupsOf(labels: Int32Array, order: Int32Array): number[][] {
  const by = new Map<number, number[]>();
  for (let v = 0; v < labels.length; v++) {
    const l = labels[v] as number;
    const g = by.get(l);
    if (g) g.push(v);
    else by.set(l, [v]);
  }
  const first = (g: number[]) => Math.min(...g.map((v) => order[v] as number));
  return [...by.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => first(a) - first(b));
}

/** Pieces of `group` by `labels` (ascending members, in order of first member). */
function piecesBy(group: readonly number[], labels: Int32Array): number[][] {
  const by = new Map<number, number[]>();
  for (const v of group) {
    const l = labels[v] as number;
    const g = by.get(l);
    if (g) g.push(v);
    else by.set(l, [v]);
  }
  return [...by.values()];
}

/**
 * Cut a group that is too large for one leaf into as few parts as fit the soft bounds: start from its pieces in the
 * free partition (a piece above the bounds is split by Louvain on its own induced subgraph, γ doubled ≤ 6 times),
 * then re-join the parts, smallest first with its best-connected partner, while the union still fits — a 9k-LOC
 * package becomes two halves along the lines the whole graph draws, not five fragments.
 */
function cut(x: AtomInput, group: readonly number[], free: Int32Array): number[][] {
  const P = x.tuning;
  const loc = (xs: readonly number[]) => sum(xs, x.ug.size);
  const tok = (xs: readonly number[]) => sum(xs, x.sig);
  const fits = (l: number, t: number, files: number) => files === 1 || (l <= P.leafLocMax && t <= 0.75 * P.leafSkeletonTokensMax);
  const fitsSet = (xs: readonly number[]) => fits(loc(xs), tok(xs), xs.length);
  if (fitsSet(group)) return [[...group]];
  const parts: number[][] = [];
  for (const piece of piecesBy(group, free)) {
    if (fitsSet(piece)) {
      parts.push(piece);
      continue;
    }
    const sub = induced(x.ug, piece);
    const subOrder = Int32Array.from(piece, (v) => x.order[v] as number);
    let split: number[][] = [piece];
    for (let k = 0, gamma = 1; k < 6; k++, gamma *= 2) {
      const labels = splitDisconnected(sub, louvain(sub, { gamma, maxSize: P.leafLocMax, order: subOrder }), subOrder);
      split = groupsOf(labels, subOrder).map((p) => p.map((i) => piece[i] as number));
      if (split.every(fitsSet)) break;
    }
    parts.push(...split);
  }
  // re-join: connection weights between the parts (within the group)
  const partOf = new Map<number, number>();
  parts.forEach((p, i) => {
    for (const v of p) partOf.set(v, i);
  });
  const conn = parts.map(() => new Map<number, number>());
  for (const v of group)
    for (let e = x.ug.start[v] as number; e < (x.ug.start[v + 1] as number); e++) {
      const a = partOf.get(v) as number;
      const b = partOf.get(x.ug.nbr[e] as number);
      if (b !== undefined && a !== b) conn[a]?.set(b, (conn[a]?.get(b) ?? 0) + (x.ug.w[e] as number));
    }
  const members = parts.map((p) => [...p]);
  const L = parts.map(loc);
  const T = parts.map(tok);
  const key = parts.map((p) => Math.min(...p.map((v) => x.order[v] as number)));
  const alive = new Set(parts.map((_, i) => i));
  for (let merged = true; merged; ) {
    merged = false;
    const bySize = [...alive].sort((a, b) => (L[a] as number) - (L[b] as number) || (key[a] as number) - (key[b] as number));
    for (const a of bySize) {
      let best = -1;
      let bestW = -1;
      for (const b of alive) {
        if (b === a || !fits((L[a] as number) + (L[b] as number), (T[a] as number) + (T[b] as number), 2)) continue;
        const w = conn[a]?.get(b) ?? 0;
        if (
          best < 0 ||
          w > bestW + 1e-12 ||
          (Math.abs(w - bestW) <= 1e-12 && ((L[b] as number) < (L[best] as number) || (L[b] === L[best] && (key[b] as number) < (key[best] as number))))
        ) {
          best = b;
          bestW = w;
        }
      }
      if (best < 0) continue;
      members[best] = [...(members[best] as number[]), ...(members[a] as number[])];
      L[best] = (L[best] as number) + (L[a] as number);
      T[best] = (T[best] as number) + (T[a] as number);
      key[best] = Math.min(key[best] as number, key[a] as number);
      for (const [c, w] of conn[a] ?? []) {
        if (c === best) continue;
        conn[best]?.set(c, (conn[best]?.get(c) ?? 0) + w);
        conn[c]?.set(best, (conn[c]?.get(best) ?? 0) + w);
        conn[c]?.delete(a);
      }
      conn[best]?.delete(a);
      alive.delete(a);
      merged = true;
      break;
    }
  }
  return [...alive].map((i) => (members[i] as number[]).sort((a, b) => a - b));
}

/**
 * Collections: a directory (not the root) whose files live mostly in ≥ 2 sub-directories — `src/middleware/<name>/`,
 * `src/adapter/<runtime>/`, `examples/<app>/` — and whose whole subtree fits one leaf, in one scope. Its members are
 * siblings of one kind that rarely depend on each other, so no graph keeps them together, yet the directory is the
 * chapter a reader looks for. Returns the outermost collections (subtree node lists by directory).
 */
function collections(x: AtomInput): Map<string, number[]> {
  const { fg } = x;
  const subtree = new Map<string, number[]>();
  const kids = new Map<string, Set<string>>();
  fg.paths.forEach((p, i) => {
    for (let d = dirOf(p), child = ""; ; child = d, d = dirOf(d)) {
      const l = subtree.get(d);
      if (l) l.push(i);
      else subtree.set(d, [i]);
      if (child !== "") {
        const k = kids.get(d) ?? new Set<string>();
        k.add(child);
        kids.set(d, k);
      }
      if (d === "") break;
    }
  });
  const P = x.tuning;
  const out = new Map<string, number[]>();
  const visit = (d: string) => {
    const all = subtree.get(d) ?? [];
    const children = [...(kids.get(d) ?? [])].sort();
    const direct = all.filter((v) => dirOf(fg.paths[v] as string) === d);
    const scopes = new Set(all.map((v) => x.files.get(fg.paths[v] as string)?.scope ?? "main"));
    if (
      d !== "" &&
      children.length >= 2 &&
      sum(direct, x.ug.size) <= 0.5 * sum(all, x.ug.size) &&
      sum(all, x.ug.size) <= P.leafLocMax &&
      sum(all, x.sig) <= 0.75 * P.leafSkeletonTokensMax &&
      scopes.size === 1 &&
      siblingsApart(x, d, all)
    ) {
      out.set(
        d,
        [...all].sort((a, b) => a - b),
      );
      return;
    }
    for (const c of children) visit(c);
  };
  visit("");
  return out;
}

/**
 * True when the sub-directories of `d` rarely depend on each other: the dependency weight between different children
 * is ≤ 25 % of the subtree's dependency weight (internal + outgoing). Siblings of one kind (middlewares, adapters)
 * pass; the layers of an app (`src/{db,http,ui}`, which import each other) do not.
 */
function siblingsApart(x: AtomInput, d: string, all: readonly number[]): boolean {
  const { fg } = x;
  const childKey = new Map<number, string>();
  for (const v of all) {
    const rest = (fg.paths[v] as string).slice(d.length + 1);
    const i = rest.indexOf("/");
    childKey.set(v, i < 0 ? "" : rest.slice(0, i));
  }
  let between = 0;
  let total = 0;
  for (const v of all)
    for (const [j, e] of fg.out[v] ?? []) {
      const w = e.import + e.ref;
      total += w;
      const kj = childKey.get(j);
      if (kj !== undefined && kj !== childKey.get(v)) between += w;
    }
  return between <= 0.25 * total;
}

export function buildAtoms(x: AtomInput): Atoms {
  const { fg } = x;
  const n = fg.paths.length;
  const atoms: number[][] = [];
  const inCollection = new Uint8Array(n);
  for (const g of collections(x).values()) {
    atoms.push(g);
    for (const v of g) inCollection[v] = 1;
  }
  // directory groups: dir → unit → nodes (paths are sorted, so members are ascending)
  const groups = new Map<string, number[]>();
  const riders = new Map<string, number[]>();
  fg.paths.forEach((p, i) => {
    if (inCollection[i] === 1) return;
    const f = x.files.get(p) as StageFile;
    const u = unitOf(f);
    const key = `${dirOf(p)}\u0000${u ?? ""}`;
    const into = u === null ? riders : groups;
    const g = into.get(key);
    if (g) g.push(i);
    else into.set(key, [i]);
  });
  // the free partition (files, no directory constraint) the groups are checked against
  const free = splitDisconnected(x.ug, louvain(x.ug, { gamma: 1, maxSize: x.tuning.leafLocMax, order: x.order }), x.order);
  const agreement = (g: readonly number[]): number => {
    const by = new Map<number, number>();
    let total = 0;
    for (const v of g) {
      const s = x.ug.size[v] as number;
      total += s;
      by.set(free[v] as number, (by.get(free[v] as number) ?? 0) + s);
    }
    return total === 0 ? 1 : Math.max(...by.values()) / total;
  };
  const hasIn = new Uint8Array(n);
  for (const m of fg.out) for (const j of m.keys()) hasIn[j] = 1;
  const isolated = (g: readonly number[]) => g.every((v) => (fg.out[v]?.size ?? 0) === 0 && hasIn[v] === 0);
  const hostOfDir = new Map<string, number[]>();
  const host = (dir: string, g: number[]) => {
    const cur = hostOfDir.get(dir);
    if (!cur || sum(g, x.ug.size) > sum(cur, x.ug.size)) hostOfDir.set(dir, g);
  };
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key) as number[];
    const dir = key.slice(0, key.indexOf("\u0000"));
    const unit = key.slice(key.indexOf("\u0000") + 1);
    const unitByLanguage = languageUnit(
      unit,
      g.map((v) => x.files.get(fg.paths[v] as string) as StageFile),
    );
    if (g.length === 1 || unitByLanguage || isolated(g) || agreement(g) >= AGREEMENT) {
      atoms.push(g);
      host(dir, g);
    } else for (const v of g) atoms.push([v]);
  }
  // files without a parser ride along with the largest group of their directory
  for (const key of [...riders.keys()].sort()) {
    const rs = riders.get(key) as number[];
    const h = hostOfDir.get(key.slice(0, key.indexOf("\u0000")));
    if (h) h.push(...rs);
    else atoms.push(rs);
  }
  const lists: number[][] = [];
  for (const g of atoms)
    lists.push(
      ...cut(
        x,
        g.sort((a, b) => a - b),
        free,
      ),
    );
  const of = new Int32Array(n).fill(-1);
  const first = (g: readonly number[]) => Math.min(...g.map((v) => x.order[v] as number));
  lists.sort((a, b) => first(a) - first(b));
  lists.forEach((g, a) => {
    for (const v of g) of[v] = a;
  });
  return { of, members: lists };
}
