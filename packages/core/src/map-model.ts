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
import type { MapView } from "./api.ts";
import type { BlockId, ModuleId, SectionId } from "./domain.ts";

const fmtLocShort = (n: number) =>
  n >= 1000
    ? `${(n / 1000)
        .toFixed(1)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "")}k`
    : String(n);

export interface RoomChip {
  /**
   * File name as shown: the basename, or the shortest parent prefix that tells same-named files apart inside
   * this room (`a/index.ts`; WP31, computed in `buildPlanModel`).
   */
  name: string;
  /** Size text (`3.5k`). */
  size: string;
  /** Full repo-relative path (hover `<title>` and the screen-reader label; never shown in full). */
  path: string;
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
  doors?: MapView["layout"]["doors"];
  building?: { w: number; h: number };
}

/** JSON-safe presentation. Runtime lookups are reconstructed without traversing the module tree. */
export type PlanData = Omit<PlanModel, "byId" | "links">;
export function planData({ byId: _byId, links: _links, ...data }: PlanModel): PlanData {
  return data;
}
export function hydratePlan(data: PlanData): PlanModel {
  const links = new Map<string, Set<string>>();
  for (const e of data.edges)
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      const set = links.get(a!) ?? new Set<string>();
      set.add(b!);
      links.set(a!, set);
    }
  return { ...data, byId: new Map(data.rooms.map((r) => [r.id, r])), links };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

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
