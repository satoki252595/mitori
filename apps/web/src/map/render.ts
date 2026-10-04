/**
 * S1 map renderer (ux.md §4.2.3 performance rules): `MapView` → ONE SVG string, inserted once with innerHTML.
 * The camera then only rewrites the root `<g class="cam">` transform and `--inv-s`; LOD, selection, overlays and
 * generation rings are class / attribute flips on existing nodes. Labels live in `.lbl` groups scaled by
 * `--inv-s` so they keep a constant on-screen size (13 / 11 px); every room is a nested `<svg>` (its viewport is
 * the room). Labels never clip: when the camera settles the controller fits each label to the room's on-screen
 * size ({@link roomLabels}: whole, shortened with 「…」, or hidden), and right-aligned parts (size, zone LOC) sit in
 * a zero-size corner `<svg>` at the right wall. The MVP draws the container map (doc layout `mitori-rooms@1`:
 * zones as bands, rooms sized for their labels); the floor plan (WP-18) reuses the same model.
 */
import type { BlockId, DiagramNode, MapView, ModuleId, ModuleInfo, SectionId } from "@mitori/core";
import { fmtLocShort } from "../shell/fmt.ts";

export interface RoomChip {
  /** File name (basename). */
  name: string;
  /** Size text (`3.5k`). */
  size: string;
}

export interface RoomModel {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  path: string;
  loc: number;
  files: number;
  zone: string | null;
  zoneLabel: string;
  section: SectionId | null;
  module: ModuleId | null;
  external: boolean;
  threads: number;
  working: number;
  fresh: "fresh" | "stale" | "unknown";
  topSymbols: string[];
  /** The module's one-line role from the generated doc (NC-04), null before generation. */
  summary: string | null;
  /** The block of its page's 「変更の手引き」 (the room card links to it), null when the page has none. */
  change?: BlockId | null;
  /** Largest files of the room (furniture), largest first, ≤ 3. */
  chips: RoomChip[];
}

export interface ZoneModel {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: number;
  /** LOC of the zone's rooms. */
  loc: number;
}

export interface EdgeModel {
  id: string;
  from: string;
  to: string;
  points: [number, number][];
}

export interface PlanModel {
  width: number;
  height: number;
  rooms: RoomModel[];
  zones: ZoneModel[];
  edges: EdgeModel[];
  byId: Map<string, RoomModel>;
  /** room id → ids of rooms it connects to (either direction). */
  links: Map<string, Set<string>>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

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
  return { width: view.layout.width, height: view.layout.height, rooms, zones, edges, byId: new Map(rooms.map((r) => [r.id, r])), links };
}

// ---------------------------------------------------------------- label fitting (pure; metrics mirror doc layout/rooms.ts)

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** On-screen px per character: room names 13 px semibold, zone names 11 px semibold + tracking, the rest mono 11 px. */
export const LABEL_FONT = {
  name: { narrow: 7.6, wide: 13 },
  mono: { narrow: 6.7, wide: 11 },
  zone: { narrow: 7.6, wide: 12 },
} as const;
type Font = { readonly narrow: number; readonly wide: number };

export function textPx(s: string, font: Font): number {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? font.wide : font.narrow;
  return w;
}

/** `s` when it fits in `max` px, else its longest prefix + 「…」 that does (≥ 2 characters), else null. */
export function fitText(s: string, max: number, font: Font): string | null {
  if (textPx(s, font) <= max) return s;
  const chars = [...s];
  let w = textPx("…", font);
  let n = 0;
  for (const c of chars) {
    const cw = WIDE.test(c) ? font.wide : font.narrow;
    if (w + cw > max) break;
    w += cw;
    n++;
  }
  return n >= 2 ? `${chars.slice(0, n).join("").trimEnd()}…` : null;
}

/** Room text geometry in on-screen px (`.lbl` coordinates). */
export const ROOM_TEXT = { padX: 12, nameY: 21, pathY: 39, chipY: 48, chipH: 17, chipGap: 6, chipPad: 6 } as const;

export interface RoomLabels {
  /** Name as shown (fitted); null = hidden. */
  name: string | null;
  /** Size label at the right wall. */
  size: boolean;
  /** Path line as shown (fitted); null = hidden. */
  path: string | null;
  /** File chips that fit. */
  chips: number;
}

/** Second line of a room: `{path} · {n} files` (no path at the repository root). */
export function pathLine(r: Pick<RoomModel, "path" | "files">, filesWord: (n: number) => string): string {
  return [r.path, r.files > 0 ? filesWord(r.files) : ""].filter(Boolean).join(" · ");
}

const chipText = (c: RoomChip) => `${c.name} ${c.size}`;

/** What a room shows at an on-screen size `sw × sh` px: every part fits whole, is shortened, or is hidden. */
export function roomLabels(
  r: Pick<RoomModel, "label" | "path" | "loc" | "files" | "chips">,
  sw: number,
  sh: number,
  filesWord: (n: number) => string,
): RoomLabels {
  const inner = sw - ROOM_TEXT.padX * 2;
  if (inner < 18 || sh < 26) return { name: null, size: false, path: null, chips: 0 };
  const sizeW = r.loc > 0 ? textPx(fmtLocShort(r.loc), LABEL_FONT.mono) + 10 : 0;
  const size = sizeW > 0 && textPx(r.label, LABEL_FONT.name) + sizeW <= inner;
  const name = fitText(r.label, size ? inner - sizeW : inner, LABEL_FONT.name);
  const line = pathLine(r, filesWord);
  const path = sh >= 46 && line ? fitText(line, inner, LABEL_FONT.mono) : null;
  let chips = 0;
  if (sh >= ROOM_TEXT.chipY + ROOM_TEXT.chipH + 6) {
    let x = 0;
    for (const c of r.chips) {
      const w = textPx(chipText(c), LABEL_FONT.mono) + ROOM_TEXT.chipPad * 2;
      if (x + w > inner) break;
      x += w + ROOM_TEXT.chipGap;
      chips++;
    }
  }
  return { name, size, path, chips };
}

export interface PlanText {
  /** Accessible name of a room (`{区画} {部屋} · {files} files · スレッド {n}`). */
  roomLabel: (r: RoomModel) => string;
  /** Short accessible summary of the whole plan. */
  title: string;
  /** Link of a room (`/w/<ws>?room=<id>`). */
  roomHref: (r: RoomModel) => string;
  /** `{n} files` of a room's path line. */
  files: (n: number) => string;
}

function chipsSvg(r: RoomModel): string {
  let x: number = ROOM_TEXT.padX;
  return r.chips
    .map((c, i) => {
      const w = textPx(chipText(c), LABEL_FONT.mono) + ROOM_TEXT.chipPad * 2;
      const out = `<g class="chip" data-i="${i}"><rect x="${n2(x)}" y="${ROOM_TEXT.chipY}" width="${n2(w)}" height="${ROOM_TEXT.chipH}" rx="3"/><text x="${n2(x + ROOM_TEXT.chipPad)}" y="${ROOM_TEXT.chipY + 12.5}">${esc(c.name)} <tspan class="cs">${esc(c.size)}</tspan></text></g>`;
      x += w + ROOM_TEXT.chipGap;
      return out;
    })
    .join("");
}

/** One SVG string for the whole map. `descId` = id of the summary paragraph (`aria-describedby`). */
export function renderPlanSvg(m: PlanModel, text: PlanText, descId: string): string {
  const out: string[] = [];
  out.push(
    `<svg class="plan" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(text.title)}" aria-describedby="${esc(descId)}" width="100%" height="100%">`,
    '<defs><pattern id="pl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern>',
    '<marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="fl-head" d="M0 1L10 5L0 9z"/></marker></defs>',
    '<g class="cam">',
    `<rect class="bldg" x="0" y="0" width="${n2(m.width)}" height="${n2(m.height)}" rx="2"/>`,
  );
  out.push('<g class="zones">');
  for (const z of m.zones) {
    out.push(
      `<svg class="zone t${z.tone}" data-zone="${esc(z.id)}" x="${n2(z.x)}" y="${n2(z.y)}" width="${n2(z.w)}" height="${n2(z.h)}"><rect class="zf" width="100%" height="100%"/></svg>`,
    );
  }
  out.push("</g>", '<g class="edges">');
  for (const e of m.edges) {
    out.push(`<polyline class="edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" points="${e.points.map(([x, y]) => `${n2(x)},${n2(y)}`).join(" ")}"/>`);
  }
  out.push("</g>", '<g class="rooms">');
  m.rooms.forEach((r, i) => {
    const cls = `room${r.external ? " ext" : ""}${r.working > 0 ? " ai" : ""}`;
    const line = pathLine(r, text.files);
    // an SVG <a>: focusable, and Enter on it arrives as a click (no keydown listener needed, AC-U75)
    out.push(
      `<a class="${cls}" href="${esc(text.roomHref(r))}" data-node="${esc(r.id)}" data-fresh="${r.fresh}" tabindex="${i === 0 ? 0 : -1}" aria-label="${esc(text.roomLabel(r))}">`,
      `<svg x="${n2(r.x)}" y="${n2(r.y)}" width="${n2(r.w)}" height="${n2(r.h)}">`,
      '<rect class="fl" width="100%" height="100%"/><rect class="ring" width="100%" height="100%"/>',
      `<g class="lbl"><text class="rn" x="${ROOM_TEXT.padX}" y="${ROOM_TEXT.nameY}">${esc(r.label)}</text>`,
      line ? `<text class="rp" x="${ROOM_TEXT.padX}" y="${ROOM_TEXT.pathY}">${esc(line)}</text>` : "",
      r.chips.length ? `<g class="chips">${chipsSvg(r)}</g>` : "",
      "</g>",
      // right wall: the size label at the top, the generation ✓ at the bottom
      r.loc > 0
        ? `<svg class="corner" x="100%" y="0" width="1" height="1" overflow="visible"><g class="lbl"><text class="rs" x="-${ROOM_TEXT.padX}" y="${ROOM_TEXT.nameY}">${fmtLocShort(r.loc)}</text></g></svg>`
        : "",
      '<svg class="corner" x="100%" y="100%" width="1" height="1" overflow="visible"><g class="lbl"><path class="chk" d="M-24 -13l4 4 8-9"/></g></svg>',
      "</svg></a>",
    );
  });
  // zone names above the rooms: a room's wall never hides them at a small zoom; clipped by the zone's viewport
  out.push("</g>", '<g class="zlabels" aria-hidden="true">');
  for (const z of m.zones) {
    out.push(
      `<svg class="zl" data-zone="${esc(z.id)}" x="${n2(z.x)}" y="${n2(z.y)}" width="${n2(z.w)}" height="${n2(z.h)}"><g class="lbl"><text class="zn" x="10" y="19">${esc(z.label)}</text></g>`,
      z.loc > 0
        ? `<svg class="corner" x="100%" y="0" width="1" height="1" overflow="visible"><g class="lbl"><text class="zs" x="-10" y="19">${fmtLocShort(z.loc)}</text></g></svg>`
        : "",
      "</svg>",
    );
  }
  out.push("</g>", '<g class="flows" aria-hidden="true"></g>', '<g class="pins"></g>', "</g></svg>");
  return out.join("");
}

/** One step of a §3 flow over the map (`SectionView.mapFlow`, map node ids). */
export interface FlowStep {
  from: string;
  to: string;
  step: number;
}

/** Bulge of a there-and-back pair (control-point offset): the two curves' midpoints end up 70 units apart. */
export const FLOW_BULGE = 70;

/** Where a ray from the room's centre along (ux, uy) leaves the room, plus a small gap. */
function exitPoint(r: RoomModel, ux: number, uy: number, gap = 4): { x: number; y: number } {
  const hw = r.w / 2;
  const hh = r.h / 2;
  const t = Math.min(ux === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(ux), uy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(uy));
  return { x: r.x + hw + ux * (t + gap), y: r.y + hh + uy * (t + gap) };
}

/** Geometry of the flow arrows (pure; unit-tested): path + the tag position of each step. */
export function flowGeometry(m: PlanModel, steps: readonly FlowStep[]): { step: number; d: string; tag: { x: number; y: number } }[] {
  const pairs = new Set(steps.map((s) => `${s.from}\u0000${s.to}`));
  const out: { step: number; d: string; tag: { x: number; y: number } }[] = [];
  for (const st of steps) {
    const a = m.byId.get(st.from);
    const b = m.byId.get(st.to);
    if (!a || !b || a === b) continue;
    const dx = b.x + b.w / 2 - (a.x + a.w / 2);
    const dy = b.y + b.h / 2 - (a.y + a.h / 2);
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const p0 = exitPoint(a, ux, uy);
    const p2 = exitPoint(b, -ux, -uy);
    if (pairs.has(`${st.to}\u0000${st.from}`)) {
      // the perpendicular flips with the direction, so the way back bulges to the other side
      const cx = (p0.x + p2.x) / 2 - uy * FLOW_BULGE;
      const cy = (p0.y + p2.y) / 2 + ux * FLOW_BULGE;
      out.push({
        step: st.step,
        d: `M${n2(p0.x)} ${n2(p0.y)}Q${n2(cx)} ${n2(cy)} ${n2(p2.x)} ${n2(p2.y)}`,
        tag: { x: (p0.x + 2 * cx + p2.x) / 4, y: (p0.y + 2 * cy + p2.y) / 4 },
      });
    } else out.push({ step: st.step, d: `M${n2(p0.x)} ${n2(p0.y)}L${n2(p2.x)} ${n2(p2.y)}`, tag: { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 } });
  }
  return out;
}

/** Flow layer (ux.md §4.2.3 流れ): arrows + numbered rounded-rect tags (pins are droplets, so the two never mix). */
export function renderFlow(m: PlanModel, steps: readonly FlowStep[]): string {
  const g = flowGeometry(m, steps);
  return [
    ...g.map((x) => `<path class="fl-arrow" d="${x.d}" marker-end="url(#pl-arrow)"/>`),
    ...g.map(
      (x) =>
        `<svg class="fl-tag" x="${n2(x.tag.x)}" y="${n2(x.tag.y)}" width="1" height="1" overflow="visible"><g class="lbl"><rect x="-10" y="-10" width="20" height="20" rx="5"/><text x="0" y="4">${x.step}</text></g></svg>`,
    ),
  ].join("");
}

/**
 * Pin layer (re-rendered only when thread counts change, ≤ 100 pins): a droplet + count standing on the room's
 * top wall near the right corner (above the size label, never over the name).
 */
export function renderPins(m: PlanModel, counts: Readonly<Record<string, number>>): string {
  const out: string[] = [];
  for (const r of m.rooms) {
    const n = counts[r.id] ?? 0;
    if (n <= 0) continue;
    out.push(
      `<svg class="pin" data-node="${esc(r.id)}" x="${n2(r.x + r.w)}" y="${n2(r.y)}" width="1" height="1" overflow="visible"><g class="lbl"><path d="M-62 -9a9 9 0 1 1 18 0c0 6-9 13-9 13s-9-7-9-13z"/><text x="-53" y="-5">${n}</text></g></svg>`,
    );
  }
  return out.join("");
}
