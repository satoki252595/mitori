/** Server/legacy-only derivation of the map presentation from indexed modules and layout. */
import type { MapView } from "./api.ts";
import type { BlockId, DiagramNode, ModuleInfo } from "./domain.ts";
import type { EdgeModel, PlanModel, RoomModel, ZoneModel } from "./map-model.ts";

const fmtLocShort = (n: number) =>
  n >= 1000
    ? `${(n / 1000)
        .toFixed(1)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "")}k`
    : String(n);
function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/").slice(0, -1));
  const first = split[0] as string[];
  let i = 0;
  while (i < first.length && split.every((s) => s[i] === first[i])) i++;
  return first.slice(0, i).join("/");
}

type Mod = ModuleInfo & { topFiles?: { path: string; loc: number; symbols: string[] }[] };

/** Leaf modules under (and including) a module. */
function leaves(mod: Mod, byId: Map<string, Mod>): Mod[] {
  if (mod.children.length === 0) return [mod];
  return mod.children.flatMap((c) => {
    const m = byId.get(c);
    return m ? leaves(m, byId) : [];
  });
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function buildPlanModel(view: MapView): PlanModel {
  const nodes = new Map<string, DiagramNode>(view.diagram.nodes.map((n) => [n.id, n]));
  const groups = new Map(view.diagram.groups.map((g) => [g.id, g]));
  const mods = new Map<string, Mod>(view.modules.map((m) => [m.id, m]));
  const zoneIdx = new Map<string, number>();
  const zones: ZoneModel[] = view.layout.groups.map((g, i) => {
    zoneIdx.set(g.id, i);
    return { id: g.id, label: groups.get(g.id)?.label ?? g.id, x: g.x, y: g.y, w: g.w, h: g.h, tone: (i % 5) + 1, loc: 0 };
  });
  const rooms: RoomModel[] = [];
  for (const box of view.layout.nodes) {
    const n = nodes.get(box.id);
    if (!n) continue;
    const mod = n.ref?.module ? mods.get(n.ref.module) : undefined;
    const ls = mod ? leaves(mod, mods) : [];
    const paths = ls.flatMap((m) => m.paths);
    const top = ls.flatMap((m) => m.topFiles ?? []).sort((a, b) => b.loc - a.loc || (a.path < b.path ? -1 : 1));
    const zone = n.group ?? null;
    rooms.push({
      id: n.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      label: n.label,
      path: n.sublabel ?? (n.ref?.path || commonDir(paths)),
      loc: mod?.loc ?? 0,
      files: paths.length,
      zone,
      zoneLabel: zone ? (groups.get(zone)?.label ?? zone) : "",
      section: n.ref?.section ?? null,
      module: n.ref?.module ?? null,
      external: n.shape === "external" || n.shape === "actor",
      threads: view.overlays.comments[n.id] ?? 0,
      working: view.overlays.working[n.id] ?? 0,
      fresh: view.overlays.freshness[n.id] ?? "unknown",
      topSymbols: top.flatMap((f) => f.symbols).slice(0, 3),
      summary: (mod as { summary?: string } | undefined)?.summary ?? null,
      change: (mod as { change?: BlockId } | undefined)?.change ?? null,
      chips: top.slice(0, 3).map((f) => ({ name: baseName(f.path), size: fmtLocShort(f.loc) })),
    });
  }
  for (const z of zones) z.loc = rooms.reduce((a, r) => a + (r.zone === z.id ? r.loc : 0), 0);
  // roving order: zone order, then reading order inside the zone (rows of ~ equal y)
  rooms.sort((a, b) => {
    const za = a.zone === null ? 1e9 : (zoneIdx.get(a.zone) ?? 1e9);
    const zb = b.zone === null ? 1e9 : (zoneIdx.get(b.zone) ?? 1e9);
    return za - zb || Math.round(a.y / 24) - Math.round(b.y / 24) || a.x - b.x || (a.id < b.id ? -1 : 1);
  });
  const edges: EdgeModel[] = [];
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let s = links.get(a);
    if (!s) {
      s = new Set();
      links.set(a, s);
    }
    s.add(b);
  };
  const ir = new Map(view.diagram.edges.map((e) => [e.id, e]));
  for (const le of view.layout.edges) {
    const e = ir.get(le.id);
    if (!e || le.points.length < 2) continue;
    edges.push({ id: e.id, from: e.from, to: e.to, points: le.points });
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const floor = view.diagram.kind === "floorplan" && !view.fallback;
  return {
    width: view.layout.width,
    height: view.layout.height,
    rooms,
    zones,
    edges,
    byId: new Map(rooms.map((r) => [r.id, r])),
    links,
    ...(floor
      ? { doors: view.layout.doors ?? [], building: { w: Math.max(...zones.map((z) => z.x + z.w)), h: Math.max(...zones.map((z) => z.y + z.h)) } }
      : {}),
  };
}
