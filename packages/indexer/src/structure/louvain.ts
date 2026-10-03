/**
 * Deterministic Louvain (spec §6.2 改訂 R1 SC-15): fast local moving in a fixed visit order with a size cap and a
 * warm-start hysteresis, aggregation, then a BFS split of disconnected communities. No randomness; ties within
 * {@link TIE} go to the community whose representative comes first in the order.
 */
import { TIE } from "./quantize.ts";

/** Undirected weighted graph in CSR form (both directions stored). */
export interface UGraph {
  n: number;
  start: Int32Array;
  nbr: Int32Array;
  w: Float64Array;
  /** Self-loop weight per node (counted once in `m`, twice in `deg`). */
  self: Float64Array;
  /** k_i = Σ_j≠i w_ij + 2·self_i. */
  deg: Float64Array;
  /** Node size (LOC) for the size cap. */
  size: Float64Array;
  /** Σ undirected edge weights + Σ self loops. */
  m: number;
}

/** Build a CSR graph from undirected edges (duplicates are summed; i ≠ j). */
export function buildUGraph(n: number, edges: Iterable<readonly [number, number, number]>, size: Float64Array, self?: Float64Array): UGraph {
  const maps: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [a, b, w] of edges) {
    if (a === b || w <= 0) continue;
    maps[a]?.set(b, (maps[a]?.get(b) ?? 0) + w);
    maps[b]?.set(a, (maps[b]?.get(a) ?? 0) + w);
  }
  const start = new Int32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) total += (maps[i] as Map<number, number>).size;
  const nbr = new Int32Array(total);
  const w = new Float64Array(total);
  const deg = new Float64Array(n);
  const loops = self ?? new Float64Array(n);
  let at = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    start[i] = at;
    const keys = [...(maps[i] as Map<number, number>).keys()].sort((x, y) => x - y);
    for (const j of keys) {
      const x = (maps[i] as Map<number, number>).get(j) as number;
      nbr[at] = j;
      w[at] = x;
      deg[i] = (deg[i] as number) + x;
      if (j > i) m += x;
      at++;
    }
    deg[i] = (deg[i] as number) + 2 * (loops[i] as number);
    m += loops[i] as number;
  }
  start[n] = at;
  return { n, start, nbr, w, self: loops, deg, size, m };
}

export interface LouvainOptions {
  /** Resolution γ. */
  gamma: number;
  /** Community size cap (LOC); moves that would exceed it are skipped. */
  maxSize: number;
  /** Visit rank of each node (lower first). */
  order: Int32Array;
  /** Warm-start labels (any ints; same label = same community); null = singletons. */
  init?: Int32Array | null;
  /** Gain a node must beat to leave its warm-start community. */
  hysteresis?: number;
  /** Max aggregation levels. */
  maxLevels?: number;
}

/** One pass of fast local moving. `comm[v]` is a representative node id; K/S are indexed by it. */
function localMove(
  g: UGraph,
  comm: Int32Array,
  K: Float64Array,
  S: Float64Array,
  gamma: number,
  maxSize: number,
  order: Int32Array,
  home: Int32Array | null,
  eps: number,
): boolean {
  const n = g.n;
  const m = g.m;
  if (m === 0 || n < 2) return false;
  const visit = Array.from({ length: n }, (_, i) => i).sort((a, b) => (order[a] as number) - (order[b] as number));
  const queue = new Int32Array(n);
  const inQ = new Uint8Array(n);
  let head = 0;
  let count = n;
  for (let i = 0; i < n; i++) {
    queue[i] = visit[i] as number;
    inQ[visit[i] as number] = 1;
  }
  const wTo = new Float64Array(n);
  const touched: number[] = [];
  let moved = false;
  const twoM2 = 2 * m * m;
  while (count > 0) {
    const v = queue[head] as number;
    head = (head + 1) % n;
    count--;
    inQ[v] = 0;
    const A = comm[v] as number;
    const kv = g.deg[v] as number;
    const sv = g.size[v] as number;
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const c = comm[g.nbr[e] as number] as number;
      if (wTo[c] === 0) touched.push(c);
      wTo[c] = (wTo[c] as number) + (g.w[e] as number);
    }
    const kvA = wTo[A] as number;
    const KA = (K[A] as number) - kv;
    let best = A;
    let bestGain = 0;
    for (const c of touched) {
      if (c === A || (S[c] as number) + sv > maxSize) continue;
      const gain = ((wTo[c] as number) - kvA) / m - (gamma * kv * ((K[c] as number) - KA)) / twoM2;
      if (gain > bestGain + TIE || (best !== A && Math.abs(gain - bestGain) <= TIE && (order[c] as number) < (order[best] as number))) {
        best = c;
        bestGain = gain;
      }
    }
    for (const c of touched) wTo[c] = 0;
    touched.length = 0;
    const threshold = home !== null && home[v] === A ? eps : 0;
    if (best === A || bestGain <= threshold) continue;
    comm[v] = best;
    K[A] = KA;
    K[best] = (K[best] as number) + kv;
    S[A] = (S[A] as number) - sv;
    S[best] = (S[best] as number) + sv;
    moved = true;
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const u = g.nbr[e] as number;
      if (comm[u] !== best && inQ[u] === 0) {
        queue[(head + count) % n] = u;
        count++;
        inQ[u] = 1;
      }
    }
  }
  return moved;
}

/** Collapse communities into nodes; new ids follow the order of the communities' representatives. */
function aggregate(g: UGraph, comm: Int32Array, order: Int32Array): { g: UGraph; map: Int32Array; order: Int32Array } {
  const reps = [...new Set(comm)].sort((a, b) => (order[a] as number) - (order[b] as number));
  const map = new Int32Array(g.n).fill(-1);
  reps.forEach((r, i) => {
    map[r] = i;
  });
  const n2 = reps.length;
  const size = new Float64Array(n2);
  const self = new Float64Array(n2);
  const edges = new Map<number, number>();
  for (let v = 0; v < g.n; v++) {
    const cv = map[comm[v] as number] as number;
    size[cv] = (size[cv] as number) + (g.size[v] as number);
    self[cv] = (self[cv] as number) + (g.self[v] as number);
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const u = g.nbr[e] as number;
      if (u < v) continue;
      const cu = map[comm[u] as number] as number;
      const w = g.w[e] as number;
      if (cu === cv) self[cv] = (self[cv] as number) + w;
      else {
        const k = cv < cu ? cv * n2 + cu : cu * n2 + cv;
        edges.set(k, (edges.get(k) ?? 0) + w);
      }
    }
  }
  const list: [number, number, number][] = [...edges].sort((a, b) => a[0] - b[0]).map(([k, w]) => [Math.floor(k / n2), k % n2, w]);
  return { g: buildUGraph(n2, list, size, self), map, order: Int32Array.from({ length: n2 }, (_, i) => i) };
}

/** Louvain with warm start; returns a dense community index per node (numbered in order of first member). */
export function louvain(g0: UGraph, o: LouvainOptions): Int32Array {
  const n0 = g0.n;
  const top = Int32Array.from({ length: n0 }, (_, i) => i);
  let g = g0;
  let order = o.order;
  let comm = new Int32Array(n0);
  let home: Int32Array | null = null;
  if (o.init) {
    // representative of each warm-start label = its member that comes first in the order
    const rep = new Map<number, number>();
    for (let v = 0; v < n0; v++) {
      const l = o.init[v] as number;
      const r = rep.get(l);
      if (r === undefined || (order[v] as number) < (order[r] as number)) rep.set(l, v);
    }
    for (let v = 0; v < n0; v++) comm[v] = rep.get(o.init[v] as number) as number;
    home = Int32Array.from(comm);
  } else for (let v = 0; v < n0; v++) comm[v] = v;
  const maxLevels = o.maxLevels ?? 10;
  for (let level = 0; level < maxLevels; level++) {
    const K = new Float64Array(g.n);
    const S = new Float64Array(g.n);
    for (let v = 0; v < g.n; v++) {
      const c = comm[v] as number;
      K[c] = (K[c] as number) + (g.deg[v] as number);
      S[c] = (S[c] as number) + (g.size[v] as number);
    }
    const moved = localMove(g, comm, K, S, o.gamma, o.maxSize, order, level === 0 ? home : null, o.hysteresis ?? 0);
    const agg = aggregate(g, comm, order);
    for (let v = 0; v < n0; v++) top[v] = agg.map[comm[top[v] as number] as number] as number;
    // level 0 may start from a warm partition: aggregate it even without moves (unless it is all singletons)
    if (level > 0 ? !moved : !moved && agg.g.n === g.n) break;
    g = agg.g;
    order = agg.order;
    comm = Int32Array.from({ length: g.n }, (_, i) => i);
  }
  return top;
}

/** Split communities that are not connected in `g` (BFS in visit order, spec §6.2 R1). Dense labels. */
export function splitDisconnected(g: UGraph, labels: Int32Array, order: Int32Array): Int32Array {
  const n = g.n;
  const out = new Int32Array(n).fill(-1);
  const visit = Array.from({ length: n }, (_, i) => i).sort((a, b) => (order[a] as number) - (order[b] as number));
  let next = 0;
  const stack: number[] = [];
  for (const s of visit) {
    if (out[s] !== -1) continue;
    const l = labels[s];
    out[s] = next;
    stack.push(s);
    while (stack.length > 0) {
      const v = stack.pop() as number;
      for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
        const u = g.nbr[e] as number;
        if (out[u] === -1 && labels[u] === l) {
          out[u] = next;
          stack.push(u);
        }
      }
    }
    next++;
  }
  return out;
}

/** Modularity Σ_c [L_c/m − γ (K_c/2m)²] of a partition. */
export function modularity(g: UGraph, labels: Int32Array, gamma = 1): number {
  if (g.m === 0) return 0;
  const L = new Map<number, number>();
  const K = new Map<number, number>();
  for (let v = 0; v < g.n; v++) {
    const c = labels[v] as number;
    K.set(c, (K.get(c) ?? 0) + (g.deg[v] as number));
    L.set(c, (L.get(c) ?? 0) + (g.self[v] as number));
    for (let e = g.start[v] as number; e < (g.start[v + 1] as number); e++) {
      const u = g.nbr[e] as number;
      if (u > v && labels[u] === c) L.set(c, (L.get(c) ?? 0) + (g.w[e] as number));
    }
  }
  let q = 0;
  for (const [c, k] of K) q += (L.get(c) ?? 0) / g.m - gamma * (k / (2 * g.m)) ** 2;
  return q;
}
