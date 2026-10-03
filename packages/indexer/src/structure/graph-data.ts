/**
 * `Indexer.graph(level, focus?)` (spec §8): module level = leaves (parents when > 40 leaves) with the effective
 * dependencies (weight desc, ≤ 3 per node); file level = a module's members (or one file) + 1 hop, ≤ 300 nodes.
 * Directory-prior edges are never exported.
 */
import type { GraphEdgeKind, ModuleId, RepoPath } from "@mitori/core";
import { type GraphData, type ModuleDetail, SEARCH_LIMITS } from "../contract.ts";
import { baseOf } from "../resolve/files.ts";
import type { StructureResult } from "./stage.ts";

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function graphData(st: StructureResult, level: "module" | "file", focus?: string): GraphData {
  return level === "module" ? moduleGraph(st) : fileGraph(st, focus);
}

function moduleGraph(st: StructureResult): GraphData {
  const leaves = st.modules.filter((m) => m.paths.length > 0);
  const byId = new Map(st.modules.map((m) => [m.id, m]));
  const useParents = leaves.length > SEARCH_LIMITS.graphModuleLeavesBeforeParents && st.modules.some((m) => m.paths.length === 0);
  const top = (id: ModuleId): ModuleId => {
    if (!useParents) return id;
    let m = byId.get(id);
    for (let hops = 0; m?.parent !== undefined && hops < 4; hops++) m = byId.get(m.parent);
    return m?.id ?? id;
  };
  const shown: ModuleDetail[] = useParents ? st.modules.filter((m) => m.parent === undefined || !byId.has(m.parent)) : leaves;
  const nodes = shown.sort((a, b) => a.topoOrder - b.topoOrder).map((m) => ({ id: m.id, label: m.name, module: m.id, rank: m.rank, loc: m.loc }));
  const w = new Map<string, number>();
  for (const e of st.leafEdges) {
    const a = top(e.from);
    const b = top(e.to);
    if (a !== b) w.set(`${a}\u0000${b}`, (w.get(`${a}\u0000${b}`) ?? 0) + e.weight);
  }
  const edges = [...w]
    .map(([k, weight]) => {
      const [from, to] = k.split("\u0000") as [string, string];
      return { from, to, kind: "import" as GraphEdgeKind, weight: Math.round(weight * 100) / 100 };
    })
    .sort((a, b) => b.weight - a.weight || byStr(a.from, b.from) || byStr(a.to, b.to))
    .slice(0, nodes.length * SEARCH_LIMITS.graphEdgesPerNode);
  return { level: "module", nodes, edges };
}

function fileGraph(st: StructureResult, focus?: string): GraphData {
  const g = st.graph;
  const maxRank = Math.max(0, ...st.fileRank.values());
  const core = new Set<number>();
  if (focus === undefined) {
    const ranked = g.paths.map((p, i) => [i, st.fileRank.get(p) ?? 0] as const).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [i] of ranked.slice(0, SEARCH_LIMITS.graphFileNodes)) core.add(i);
  } else {
    const m = st.modules.find((x) => x.id === focus);
    for (const p of m ? m.paths : [focus]) {
      const i = g.index.get(p);
      if (i !== undefined) core.add(i);
    }
  }
  const picked = new Set(core);
  if (focus !== undefined) {
    const hop: number[] = [];
    g.out.forEach((m, i) => {
      for (const j of m.keys()) {
        if (core.has(i) && !picked.has(j)) hop.push(j);
        if (core.has(j) && !picked.has(i)) hop.push(i);
      }
    });
    for (const j of [...new Set(hop)].sort((a, b) => (st.fileRank.get(g.paths[b] as string) ?? 0) - (st.fileRank.get(g.paths[a] as string) ?? 0) || a - b)) {
      if (picked.size >= SEARCH_LIMITS.graphFileNodes) break;
      picked.add(j);
    }
  }
  const order = [...picked].sort((a, b) => a - b);
  const nodes = order.map((i) => {
    const path = g.paths[i] as RepoPath;
    const module = st.moduleOf.get(path);
    return {
      id: path,
      label: baseOf(path),
      ...(module !== undefined ? { module } : {}),
      path,
      rank: maxRank > 0 ? Math.round(((st.fileRank.get(path) ?? 0) / maxRank) * 100) / 100 : 0,
      loc: g.size[i] as number,
    };
  });
  const edges: GraphData["edges"] = [];
  for (const i of order)
    for (const [j, e] of g.out[i] ?? new Map()) {
      if (!picked.has(j)) continue;
      edges.push({
        from: g.paths[i] as string,
        to: g.paths[j] as string,
        kind: g.calls.has(i * g.paths.length + j) ? "call" : e.import > 0 ? "import" : "ref",
        weight: Math.round((e.import + e.ref) * 100) / 100,
      });
    }
  return { level: "file", nodes, edges };
}
