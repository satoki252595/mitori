/** WP-18: source LOC rooms, fixed zone order, import adjacency and shared-wall doors. */
import type { DiagramIR, DiagramLayout, DiagramNode, FloorZone } from "@mitori/core";
import { uniqueIR } from "./elk.ts";

export const FLOORPLAN_ENGINE = "mitori-floorplan@1";
const W = 1600;
const H = 1000;
const ZONES: readonly FloorZone[] = ["entry", "core", "resident", "infra", "ui"];
type Box = { x: number; y: number; w: number; h: number };
type Tile = { id: string; area: number };
const half = (v: number) => Math.round(v * 2) / 2;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Squarified treemap, preserving the supplied order (never sort by directory or importance). */
function treemap(items: readonly Tile[], box: Box, aspect = 1): Map<string, Box> {
  const out = new Map<string, Box>();
  const sum = items.reduce((a, n) => a + n.area, 0);
  if (!sum) return out;
  const todo = items.map((n) => ({ ...n, area: (n.area / sum) * box.w * box.h }));
  let { x, y, w, h } = box;
  const worst = (row: readonly Tile[], side: number, vertical: boolean) => {
    const s = row.reduce((a, n) => a + n.area, 0);
    const lo = Math.min(...row.map((n) => n.area));
    const hi = Math.max(...row.map((n) => n.area));
    return vertical
      ? Math.max((side * side * hi * aspect) / (s * s), (s * s) / (side * side * lo * aspect))
      : Math.max((side * side * hi) / (s * s * aspect), (s * s * aspect) / (side * side * lo));
  };
  let at = 0;
  while (at < todo.length) {
    const row = [todo[at++] as Tile];
    const vertical = w / h >= aspect;
    const side = vertical ? h : w;
    while (at < todo.length && worst([...row, todo[at] as Tile], side, vertical) <= worst(row, side, vertical)) row.push(todo[at++] as Tile);
    const area = row.reduce((a, n) => a + n.area, 0);
    const strip = area / (vertical ? h : w);
    let p = vertical ? y : x;
    for (const [i, n] of row.entries()) {
      // Last tile meets the strip edge exactly, avoiding floating-point cracks in shared walls.
      const span = i === row.length - 1 ? (vertical ? y + h : x + w) - p : n.area / strip;
      out.set(n.id, vertical ? { x, y: p, w: strip, h: span } : { x: p, y, w: span, h: strip });
      p += span;
    }
    if (vertical) {
      x += strip;
      w -= strip;
    } else {
      y += strip;
      h -= strip;
    }
  }
  return out;
}

/** Fiedler order via shifted Laplacian power iteration, with the constant eigenvector removed. */
function orderRooms(nodes: readonly DiagramNode[], ir: DiagramIR, prev: DiagramLayout | null): DiagramNode[] {
  const ns = [...nodes].sort((a, b) => compare(a.id, b.id));
  if (ns.length < 3) return ns;
  const old = new Map(prev?.nodes.map((n, i) => [n.id, { n, i }]) ?? []);
  if (
    prev?.engine === FLOORPLAN_ENGINE &&
    ns.every((n) => {
      const o = old.get(n.id)?.n;
      return o?.loc !== undefined && Math.abs((n.loc ?? 0) - o.loc) / Math.max(1, o.loc) < 0.2;
    })
  )
    return ns.sort((a, b) => (old.get(a.id)?.i ?? 0) - (old.get(b.id)?.i ?? 0));
  const ix = new Map(ns.map((n, i) => [n.id, i]));
  const adj = ns.map(() => ns.map(() => 0));
  for (const e of ir.edges) {
    const a = ix.get(e.from),
      b = ix.get(e.to);
    if (e.kind !== "imports" || a === undefined || b === undefined || a === b) continue;
    const weight = Math.max(0, e.weight ?? 1);
    (adj[a] as number[])[b] = ((adj[a] as number[])[b] ?? 0) + weight;
    (adj[b] as number[])[a] = ((adj[b] as number[])[a] ?? 0) + weight;
  }
  const seen = new Set<number>();
  const components: DiagramNode[][] = [];
  const visit = (i: number, component: DiagramNode[]) => {
    if (seen.has(i)) return;
    seen.add(i);
    component.push(ns[i] as DiagramNode);
    adj[i]?.forEach((v, j) => {
      if (v > 0) visit(j, component);
    });
  };
  for (let i = 0; i < ns.length; i++)
    if (!seen.has(i)) {
      const component: DiagramNode[] = [];
      visit(i, component);
      components.push(component);
    }
  // Disconnected eigenvectors are tied. Keep components contiguous, order ties by id, then solve each connected part.
  if (components.length > 1) return components.flatMap((component) => orderRooms(component, ir, null));
  const degree = adj.map((row) => row.reduce((a, v) => a + v, 0));
  const scale = 2 * Math.max(...degree);
  let v = ns.map((_, i) => Math.cos(((i + 0.5) * Math.PI) / ns.length));
  let converged = false;
  for (let iteration = 0; iteration < 200; iteration++) {
    const next = v.map((vi, i) => vi - ((degree[i] as number) * vi - (adj[i] as number[]).reduce((a, weight, j) => a + weight * (v[j] as number), 0)) / scale);
    const mean = next.reduce((a, n) => a + n, 0) / next.length;
    const norm = Math.hypot(...next.map((n) => n - mean));
    if (norm < 1e-12) break;
    const normalized = next.map((n) => (n - mean) / norm);
    const delta = Math.hypot(...normalized.map((n, i) => n - (v[i] as number)));
    v = normalized;
    if (delta < 1e-6) {
      converged = true;
      break;
    }
  }
  if (!converged) return ns;
  // Eigenvectors have two equivalent signs. Orient the first nonzero component positively for determinism.
  if ((v.find((n) => Math.abs(n) > 1e-9) ?? 1) < 0) v = v.map((n) => -n);
  return ns.sort((a, b) => {
    const d = (v[ix.get(a.id) as number] as number) - (v[ix.get(b.id) as number] as number);
    return Math.abs(d) > 1e-9 ? d : compare(a.id, b.id);
  });
}

function sharedWall(a: Box, b: Box): { orient: "v" | "h"; x: number; y: number; len: number } | null {
  const loY = Math.max(a.y, b.y),
    hiY = Math.min(a.y + a.h, b.y + b.h);
  const loX = Math.max(a.x, b.x),
    hiX = Math.min(a.x + a.w, b.x + b.w);
  if (hiY - loY >= 34 && (Math.abs(a.x + a.w - b.x) < 0.51 || Math.abs(b.x + b.w - a.x) < 0.51))
    return { orient: "v", x: half(Math.abs(a.x + a.w - b.x) < 0.51 ? b.x : a.x), y: half((loY + hiY) / 2), len: 34 };
  if (hiX - loX >= 34 && (Math.abs(a.y + a.h - b.y) < 0.51 || Math.abs(b.y + b.h - a.y) < 0.51))
    return { orient: "h", x: half((loX + hiX) / 2), y: half(Math.abs(a.y + a.h - b.y) < 0.51 ? b.y : a.y), len: 34 };
  return null;
}

export function floorplanLayout(raw: DiagramIR, irHash: string, prev: DiagramLayout | null): DiagramLayout {
  const ir = uniqueIR(raw);
  const rooms = ir.nodes.filter((n) => n.shape !== "external" && n.shape !== "actor");
  const actors = ir.nodes.filter((n) => n.shape === "external" || n.shape === "actor");
  const byGroup = new Map(ir.groups.map((g) => [g.id, g]));
  const area0 =
    (W * H * 0.85) /
    Math.max(
      1,
      rooms.reduce((a, n) => a + Math.sqrt(Math.max(1, n.loc ?? 1)), 0),
    );
  const area = (n: DiagramNode) => Math.min(W * H * 0.22, Math.max(W * H * 0.012, area0 * Math.sqrt(Math.max(1, n.loc ?? 1))));
  const oldRooms = new Map(prev?.nodes.map((n) => [n.id, n]) ?? []);
  const stable = rooms.every((n) => {
    const old = oldRooms.get(n.id);
    return old?.loc !== undefined && Math.abs((n.loc ?? 0) - old.loc) / Math.max(1, old.loc) < 0.2;
  });
  const zones = ZONES.map((zone) => ({ zone, ns: rooms.filter((n) => (byGroup.get(n.group ?? "")?.zone ?? "core") === zone) })).filter((z) => z.ns.length > 0);
  // Slightly taller zones keep more import neighbours across zone boundaries; room areas still follow sqrt(LOC).
  const zonesBox = treemap(
    zones.map((z) => ({ id: z.zone, area: z.ns.reduce((a, n) => a + area(n), 0) })),
    { x: 0, y: 0, w: W, h: H },
    0.7,
  );
  const nodes: DiagramLayout["nodes"] = [];
  const groups: DiagramLayout["groups"] = [];
  for (const z of zones) {
    const box = zonesBox.get(z.zone) as Box;
    const source = ir.groups.find((g) => g.zone === z.zone);
    groups.push({ id: source?.id ?? z.zone, ...(Object.fromEntries(Object.entries(box).map(([k, v]) => [k, half(v)])) as Box), kind: "zone", zone: z.zone });
    const ordered = orderRooms(z.ns, ir, stable ? prev : null);
    // Wide labels use the renderer's md LOD (>150×84px); 1.8 follows that aspect without changing LOC areas.
    const tiles = treemap(
      ordered.map((n) => ({ id: n.id, area: area(n) })),
      box,
      1.8,
    );
    for (const n of ordered) {
      const b = tiles.get(n.id) as Box;
      nodes.push({ id: n.id, x: half(b.x), y: half(b.y), w: half(b.x + b.w) - half(b.x), h: half(b.y + b.h) - half(b.y), loc: n.loc ?? 0 });
    }
  }
  actors
    .sort((a, b) => compare(a.id, b.id))
    .forEach((n, i) => {
      nodes.push({ id: n.id, x: W + 100 + Math.floor(i / 12) * 240, y: (i % 12) * 82, w: 220, h: 76 });
    });
  const box = new Map(nodes.map((n) => [n.id, n]));
  const doors: NonNullable<DiagramLayout["doors"]> = [];
  const edges: DiagramLayout["edges"] = [];
  const made = new Set<string>();
  for (const e of ir.edges) {
    const a = box.get(e.from),
      b = box.get(e.to);
    if (!a || !b || a === b) continue;
    edges.push({
      id: e.id,
      points: [
        [a.x + a.w / 2, a.y + a.h / 2],
        [b.x + b.w / 2, b.y + b.h / 2],
      ],
    });
    const key = [e.from, e.to].sort(compare).join("|");
    if (made.has(key)) continue;
    const wall = e.kind === "imports" ? sharedWall(a, b) : null;
    if (wall) {
      doors.push({ a: e.from, b: e.to, ...wall });
      made.add(key);
    } else if (b.x > W && a.x + a.w === W) {
      doors.push({ a: e.from, b: null, orient: "v", x: W, y: half(a.y + a.h / 2), len: 34 });
      made.add(key);
    }
  }
  return {
    diagram: ir.id,
    irHash,
    engine: FLOORPLAN_ENGINE,
    width: actors.length ? W + 100 + Math.ceil(actors.length / 12) * 240 : W,
    height: H,
    nodes,
    edges,
    groups,
    doors,
  };
}

/** Actual md-or-larger LOD at a 1000×625 stage, using the renderer's 24px camera padding and room thresholds. */
export function floorplanQuality(ir: DiagramIR, layout: DiagramLayout, layoutMs: number) {
  const nodes = ir.nodes.filter((n) => n.shape !== "external" && n.shape !== "actor");
  const boxes = new Map(layout.nodes.map((n) => [n.id, n]));
  // The camera fits the building; outside actors remain reachable by pan/zoom and the room links.
  const zoom = Math.min((1000 - 48) / W, (625 - 48) / H);
  const fits = nodes.filter((n) => {
    const b = boxes.get(n.id);
    return b && b.w * zoom > 150 && b.h * zoom > 84;
  }).length;
  const internal = new Set(nodes.map((n) => n.id));
  const imports = ir.edges.filter((e) => e.kind === "imports" && internal.has(e.from) && internal.has(e.to));
  const doorPairs = new Set(layout.doors?.filter((d) => d.b !== null).map((d) => [d.a, d.b as string].sort(compare).join("|")));
  const doorEdges = imports.filter((e) => doorPairs.has([e.from, e.to].sort(compare).join("|"))).length;
  return { labelFit: nodes.length ? fits / nodes.length : 1, doorRatio: imports.length ? doorEdges / imports.length : 1, rooms: nodes.length, layoutMs };
}
