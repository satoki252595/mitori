// Diagram IR ⇄ ELK JSON (the work done inside the dedicated ELK Worker), the deterministic sequence layout, and
// label-size estimation. Pure: the ELK call itself is injected (`elk.layout(graph)`).
import type { DiagramIR, DiagramLayout } from "@mitori/core";

/** ELK version + algorithm recorded in `DiagramLayout.engine` (cache key component). */
export const ELK_ENGINE = "elk@0.12.0/layered";
export const SEQUENCE_ENGINE = "mitori-seq@1";

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const FONT = { narrow: 7.2, wide: 13, line: 18 } as const;
const NODE = { padX: 24, padY: 14, minW: 72, maxW: 240 } as const;

/** Estimated text width in px at the UI font size (13 px): CJK = 1 em, everything else ≈ 0.55 em. */
export function textWidth(s: string): number {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? FONT.wide : FONT.narrow;
  return w;
}

/** Node box size from label + sublabel (wraps at `maxW`). */
export function nodeSize(label: string, sublabel?: string): { w: number; h: number } {
  const inner = NODE.maxW - NODE.padX;
  const tw = Math.max(textWidth(label), sublabel ? textWidth(sublabel) : 0);
  const lines = Math.max(1, Math.ceil(textWidth(label) / inner)) + (sublabel ? 1 : 0);
  return { w: Math.round(Math.min(NODE.maxW, Math.max(NODE.minW, tw + NODE.padX))), h: NODE.padY * 2 + lines * FONT.line };
}

/** Minimal ELK JSON shapes (elkjs `ElkNode`/`ElkExtendedEdge`). */
export interface ElkGraphNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  labels?: { text: string; width: number; height: number; x?: number; y?: number }[];
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
}
export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  labels?: { text: string; width: number; height: number; x?: number; y?: number }[];
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[];
}

const GROUP_PREFIX = "g:";
const NODE_PREFIX = "n:";
const AGG_PREFIX = "agg:";

/**
 * Layout options tuned for the budget (300 nodes ≤ 100 ms, 1000 ≤ 400 ms) and determinism. Groups are laid out
 * bottom-up (`SEPARATE_CHILDREN`; `INCLUDE_CHILDREN` costs ≈ 10× at 1,000 nodes), so an edge between different
 * groups is laid out as an aggregated edge between the groups and drawn as a straight connector.
 */
const OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.randomSeed": "1",
  "elk.spacing.nodeNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "48",
  "elk.spacing.edgeLabel": "4",
  "elk.edgeRouting": "POLYLINE",
  "elk.layered.thoroughness": "1",
  "elk.layered.layering.strategy": "LONGEST_PATH",
  "elk.layered.nodePlacement.strategy": "SIMPLE",
  "elk.layered.crossingMinimization.greedySwitch.type": "OFF",
};

const edgeLabels = (label: string | undefined) => (label ? { labels: [{ text: label, width: textWidth(label), height: FONT.line }] } : {});

/** Diagram IR → ELK graph: groups are compound nodes; each edge lives in the container of both endpoints. */
export function irToElk(ir: DiagramIR): ElkGraphNode {
  const dir = ir.direction === "DOWN" ? "DOWN" : "RIGHT";
  const root: ElkGraphNode = {
    id: "root",
    layoutOptions: { ...OPTIONS, "elk.direction": dir, "elk.padding": "[top=16,left=16,bottom=16,right=16]" },
    children: [],
    edges: [],
  };
  const containers = new Map<string, ElkGraphNode>([["root", root]]);
  const parent = new Map<string, string>();
  const groupIds = new Set(ir.groups.map((g) => g.id));
  for (const g of ir.groups) {
    const node: ElkGraphNode = {
      id: GROUP_PREFIX + g.id,
      labels: [{ text: g.label, width: textWidth(g.label), height: FONT.line }],
      layoutOptions: {
        ...OPTIONS,
        "elk.direction": dir,
        "elk.padding": "[top=36,left=12,bottom=12,right=12]",
        "elk.nodeLabels.placement": "[H_LEFT, V_TOP, INSIDE]",
      },
      children: [],
      edges: [],
    };
    containers.set(node.id, node);
  }
  // nesting; a group on a parent cycle is placed at the root
  const irParent = new Map(ir.groups.map((g) => [g.id, g.parent && groupIds.has(g.parent) ? g.parent : undefined]));
  const onCycle = (gid: string): boolean => {
    let at = irParent.get(gid);
    for (let i = 0; at !== undefined && i <= ir.groups.length; i++) {
      if (at === gid) return true;
      at = irParent.get(at);
    }
    return at !== undefined;
  };
  for (const g of ir.groups) {
    const p = irParent.get(g.id);
    parent.set(GROUP_PREFIX + g.id, p === undefined || onCycle(g.id) ? "root" : GROUP_PREFIX + p);
  }
  for (const g of ir.groups) containers.get(parent.get(GROUP_PREFIX + g.id) ?? "root")?.children?.push(containers.get(GROUP_PREFIX + g.id) as ElkGraphNode);
  for (const n of ir.nodes) {
    const { w, h } = nodeSize(n.label, n.sublabel);
    const p = n.group && groupIds.has(n.group) ? GROUP_PREFIX + n.group : "root";
    parent.set(NODE_PREFIX + n.id, p);
    containers.get(p)?.children?.push({ id: NODE_PREFIX + n.id, width: w, height: h });
  }
  const chain = (id: string): string[] => {
    const out = [id];
    for (let at = parent.get(id); at !== undefined; at = parent.get(at)) out.push(at);
    if (out[out.length - 1] !== "root") out.push("root");
    return out;
  };
  const agg = new Set<string>();
  for (const e of ir.edges) {
    const a = NODE_PREFIX + e.from;
    const b = NODE_PREFIX + e.to;
    if (!parent.has(a) || !parent.has(b)) continue;
    const ca = chain(a);
    const cb = chain(b);
    if (parent.get(a) === parent.get(b)) {
      containers.get(parent.get(a) as string)?.edges?.push({ id: e.id, sources: [a], targets: [b], ...edgeLabels(e.label) });
      continue;
    }
    const lca = ca.find((x) => cb.includes(x) && x !== a && x !== b) ?? "root";
    const sa = ca[ca.indexOf(lca) - 1] as string;
    const sb = cb[cb.indexOf(lca) - 1] as string;
    const key = `${sa}>${sb}`;
    if (sa === sb || agg.has(key)) continue;
    agg.add(key);
    containers.get(lca)?.edges?.push({ id: `${AGG_PREFIX}${agg.size}`, sources: [sa], targets: [sb] });
  }
  return root;
}

const half = (v: number): number => Math.round(v * 2) / 2;

/** Point where the segment from the centre of `box` towards `p` leaves the box. */
function exitPoint(box: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): [number, number] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const t = Math.min(dx === 0 ? Number.POSITIVE_INFINITY : box.w / 2 / Math.abs(dx), dy === 0 ? Number.POSITIVE_INFINITY : box.h / 2 / Math.abs(dy));
  return [cx + dx * t, cy + dy * t];
}

/** ELK result → DiagramLayout (absolute coordinates rounded to 0.5 px; `irHash` filled by the caller). */
export function elkToLayout(ir: DiagramIR, res: ElkGraphNode, irHash: string): DiagramLayout {
  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  const nodes: DiagramLayout["nodes"] = [];
  const groups: DiagramLayout["groups"] = [];
  const routed = new Map<string, DiagramLayout["edges"][number]>();
  const walk = (n: ElkGraphNode, ox: number, oy: number) => {
    for (const e of n.edges ?? []) {
      if (e.id.startsWith(AGG_PREFIX)) continue;
      const s = e.sections?.[0];
      if (!s) continue;
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => [half(p.x + ox), half(p.y + oy)] as [number, number]);
      const l = e.labels?.[0];
      routed.set(e.id, {
        id: e.id,
        points: pts,
        ...(l && l.x !== undefined && l.y !== undefined ? { label: [half(l.x + ox + l.width / 2), half(l.y + oy + l.height / 2)] } : {}),
      });
    }
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      const b = { x: half(x), y: half(y), w: half(c.width ?? 0), h: half(c.height ?? 0) };
      box.set(c.id, b);
      if (c.id.startsWith(NODE_PREFIX)) nodes.push({ id: c.id.slice(NODE_PREFIX.length), ...b });
      else groups.push({ id: c.id.slice(GROUP_PREFIX.length), ...b });
      walk(c, x, y);
    }
  };
  walk(res, 0, 0);
  const order = new Map(ir.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const gorder = new Map(ir.groups.map((g, i) => [g.id, i]));
  groups.sort((a, b) => (gorder.get(a.id) ?? 0) - (gorder.get(b.id) ?? 0));
  const edges: DiagramLayout["edges"] = [];
  for (const e of ir.edges) {
    const r = routed.get(e.id);
    if (r) {
      edges.push(r);
      continue;
    }
    const a = box.get(NODE_PREFIX + e.from);
    const b = box.get(NODE_PREFIX + e.to);
    if (!a || !b) continue;
    const p = exitPoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const q = exitPoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    const points: [number, number][] = [
      [half(p[0]), half(p[1])],
      [half(q[0]), half(q[1])],
    ];
    edges.push({ id: e.id, points, ...(e.label ? { label: [half((p[0] + q[0]) / 2), half((p[1] + q[1]) / 2)] as [number, number] } : {}) });
  }
  return { diagram: ir.id, irHash, engine: ELK_ENGINE, width: half(res.width ?? 0), height: half(res.height ?? 0), nodes, edges, groups };
}

/** Worker side of the ELK pool: IR → ELK → DiagramLayout (`irHash` is stamped by the layouter). */
export async function elkLayout(elk: { layout(g: ElkGraphNode): Promise<ElkGraphNode> }, req: { ir: DiagramIR }): Promise<DiagramLayout> {
  return elkToLayout(req.ir, await elk.layout(irToElk(req.ir)), "");
}

/** Deterministic sequence-diagram layout (participants in IR order, one row per message in `seq` order). */
export function sequenceLayout(ir: DiagramIR, irHash: string): DiagramLayout {
  const PAD = 16;
  const GAP = 48;
  const ROW = 40;
  const HEAD = 16;
  const sizes = ir.nodes.map((n) => nodeSize(n.label, n.sublabel));
  const boxH = Math.max(36, ...sizes.map((s) => s.h));
  const nodes: DiagramLayout["nodes"] = [];
  const centre = new Map<string, number>();
  let x = PAD;
  ir.nodes.forEach((n, i) => {
    const s = sizes[i] as { w: number; h: number };
    nodes.push({ id: n.id, x: half(x), y: PAD, w: s.w, h: boxH });
    centre.set(n.id, x + s.w / 2);
    x += s.w + GAP;
  });
  const msgs = ir.edges.map((e, i) => ({ e, i })).sort((a, b) => (a.e.seq ?? Number.MAX_SAFE_INTEGER) - (b.e.seq ?? Number.MAX_SAFE_INTEGER) || a.i - b.i);
  const edges: DiagramLayout["edges"] = [];
  let y = PAD + boxH + HEAD + ROW / 2;
  for (const { e } of msgs) {
    const a = centre.get(e.from);
    const b = centre.get(e.to);
    if (a === undefined || b === undefined) continue;
    const points: [number, number][] =
      a === b
        ? [
            [a, y],
            [a + 32, y],
            [a + 32, y + ROW / 2],
            [a, y + ROW / 2],
          ]
        : [
            [a, y],
            [b, y],
          ];
    edges.push({
      id: e.id,
      points: points.map(([px, py]) => [half(px), half(py)] as [number, number]),
      label: [half((a + b) / 2 + (a === b ? 40 : 0)), half(y - 8)],
    });
    y += a === b ? ROW * 1.5 : ROW;
  }
  const width = Math.max(x - GAP + PAD, PAD * 2);
  return { diagram: ir.id, irHash, engine: SEQUENCE_ENGINE, width: half(width), height: half(y + PAD - ROW / 2), nodes, edges, groups: [] };
}
