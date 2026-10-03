// Deterministic synthetic diagrams for layout tests and benches. Module-graph-like: contiguous groups of 12
// (directories), 1.5 edges per node, 70 % of them inside the group (locality), labels mixing ja/en.
import type { DiagramId, DiagramIR } from "@mitori/core";
import { seededRandom } from "./helpers.ts";

export function syntheticGraph(n: number, opts: { groups?: boolean; seed?: number; edgesPerNode?: number; locality?: number } = {}): DiagramIR {
  const r = seededRandom(opts.seed ?? 3);
  const rnd = () => (r.bytes(2)[0] as number) / 256;
  const size = 12;
  const grouped = opts.groups !== false;
  const groupCount = grouped ? Math.ceil(n / size) : 0;
  const groups = Array.from({ length: groupCount }, (_, i) => ({ id: `g${i}`, label: `パッケージ ${i}` }));
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: i % 3 === 0 ? `モジュール${i}` : `module_${i}`,
    sublabel: `src/pkg${Math.floor(i / size)}/file${i}.ts`,
    ...(grouped ? { group: `g${Math.floor(i / size)}` } : {}),
  }));
  const edges: DiagramIR["edges"] = [];
  const per = opts.edgesPerNode ?? 1.5;
  const local = opts.locality ?? 0.7;
  for (let i = 1; i < n; i++) {
    const k = Math.floor(per) + (rnd() < per - Math.floor(per) ? 1 : 0);
    for (let j = 0; j < k; j++) {
      const base = Math.floor(i / size) * size;
      const to = rnd() < local && i > base ? base + Math.floor(rnd() * (i - base)) : Math.floor(rnd() * i);
      edges.push({ id: `e${edges.length}`, from: `n${i}`, to: `n${to}`, kind: "imports", ...(j === 0 && i % 5 === 0 ? { label: "uses" } : {}) });
    }
  }
  return { id: `dg_${String(n).padStart(8, "0")}` as DiagramId, kind: "container", nodes, edges, groups, direction: "RIGHT", origin: "static" };
}
