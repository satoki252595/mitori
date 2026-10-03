// Container-map layout (S1 in the MVP, ux.md R1 §2.2): the building is the repository, every top-level group is a
// zone drawn as a full-width band, and the rooms (diagram nodes) are tiles packed in justified rows inside their
// zone. Rooms are sized for their labels at scale 1 (name + size on the first line, path on the second, one row of
// file chips), and the building width is chosen so the whole plan is close to 16:10 — at the fit zoom of a normal
// stage every label is readable instead of clipped. Edges are straight connectors between the room walls (drawn on
// selection / 「すべての結び付き」). Pure and deterministic: same IR ⇒ byte-identical layout.
import type { DiagramIR, DiagramLayout } from "@mitori/core";
import { uniqueIR } from "./elk.ts";

/** Engine id recorded in `DiagramLayout.engine` (cache key component). */
export const ROOMS_ENGINE = "mitori-rooms@1";

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

/**
 * Label metrics at scale 1 (px), mirrored by the web map renderer (`apps/web/src/map/render.ts`): room name 13 px
 * semibold, path / size / chips 11 px mono.
 */
export const ROOM_TEXT = { name: { narrow: 7.6, wide: 13 }, mono: { narrow: 6.7, wide: 11 } } as const;

/** Room box: padding, width clamp, fixed height (3 text rows), room reserved for the size label. */
export const ROOM_BOX = { padX: 12, minW: 136, maxW: 340, h: 76, sizeW: 40, gap: 8 } as const;

const ZONE = { head: 30, pad: 10, gap: 14 } as const;
const BLDG_PAD = 18;
/** Target aspect ratio of the building: between a laptop stage (≈ 1.9) and 16:10 (JUDGEMENT §6.3.4). */
const ASPECT = 1.75;

export function labelWidth(s: string, font: { narrow: number; wide: number }): number {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? font.wide : font.narrow;
  return w;
}

/** Room width at scale 1: the name plus the size label on one line, the path on the next. */
export function roomWidth(label: string, sublabel?: string): number {
  const first = labelWidth(label, ROOM_TEXT.name) + ROOM_BOX.sizeW + 10;
  const second = sublabel ? labelWidth(sublabel, ROOM_TEXT.mono) : 0;
  return Math.min(ROOM_BOX.maxW, Math.max(ROOM_BOX.minW, Math.ceil(Math.max(first, second) + ROOM_BOX.padX * 2)));
}

const half = (v: number): number => Math.round(v * 2) / 2;

interface Band {
  /** Group id, or null for rooms without a zone. */
  id: string | null;
  rooms: { id: string; w: number }[];
}

/**
 * Split `ws` (in order) into `k` contiguous runs minimising the widest run (gaps included): linear partition DP,
 * O(k·n²) for n ≤ 40 rooms. Returns the run lengths.
 */
function balance(ws: readonly number[], k: number): number[] {
  const n = ws.length;
  const pre = [0];
  for (const w of ws) pre.push((pre[pre.length - 1] as number) + w);
  const span = (i: number, j: number) => (pre[j] as number) - (pre[i] as number) + ROOM_BOX.gap * (j - i - 1);
  // best[p][j] = smallest widest run when the first j rooms form p runs; cut[p][j] = where the last run starts
  const best: number[][] = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(Number.POSITIVE_INFINITY));
  const cut: number[][] = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(0));
  (best[0] as number[])[0] = 0;
  for (let p = 1; p <= k; p++)
    for (let j = p; j <= n; j++)
      for (let i = p - 1; i < j; i++) {
        const v = Math.max((best[p - 1] as number[])[i] as number, span(i, j));
        if (v < ((best[p] as number[])[j] as number) - 1e-9) {
          (best[p] as number[])[j] = v;
          (cut[p] as number[])[j] = i;
        }
      }
  const out: number[] = [];
  for (let p = k, j = n; p > 0; p--) {
    const i = (cut[p] as number[])[j] as number;
    out.unshift(j - i);
    j = i;
  }
  return out;
}

/**
 * Rows of one band at inner width `inner`: the fewest rows that fit (greedy count), the rooms spread evenly over
 * them (no lone room left on the last row), then every row justified to the full width.
 */
function rowsOf(rooms: readonly { id: string; w: number }[], inner: number): { id: string; w: number }[][] {
  const fitted = rooms.map((r) => ({ id: r.id, w: Math.min(r.w, inner) }));
  let k = 0;
  let used = Number.POSITIVE_INFINITY;
  for (const r of fitted) {
    if (used + ROOM_BOX.gap + r.w > inner) {
      k++;
      used = r.w;
    } else used += ROOM_BOX.gap + r.w;
  }
  const rows: { id: string; w: number }[][] = [];
  let at = 0;
  for (const len of k > 1
    ? balance(
        fitted.map((r) => r.w),
        k,
      )
    : [fitted.length]) {
    rows.push(fitted.slice(at, at + len));
    at += len;
  }
  return rows.map((rw) => {
    const sum = rw.reduce((a, r) => a + r.w, 0);
    const free = inner - sum - ROOM_BOX.gap * (rw.length - 1);
    return rw.map((r) => ({ id: r.id, w: r.w + (free * r.w) / sum }));
  });
}

function bandHeight(band: Band, inner: number, grouped: boolean): number {
  const n = rowsOf(band.rooms, inner).length;
  const head = band.id !== null ? ZONE.head : grouped ? ZONE.pad : 0;
  const pad = band.id !== null || grouped ? ZONE.pad : 0;
  return head + n * ROOM_BOX.h + Math.max(0, n - 1) * ROOM_BOX.gap + pad;
}

/** Zones (top-level groups) in weight order, each with its rooms in weight order; ungrouped rooms last. */
function bandsOf(ir: DiagramIR): Band[] {
  const groupIds = new Set(ir.groups.map((g) => g.id));
  const parent = new Map(ir.groups.map((g) => [g.id, g.parent && groupIds.has(g.parent) ? g.parent : undefined]));
  const zoneOf = (gid: string | undefined): string | null => {
    let at = gid && groupIds.has(gid) ? gid : undefined;
    for (let i = 0; at !== undefined && i <= ir.groups.length; i++) {
      const p = parent.get(at);
      if (p === undefined) return at;
      at = p;
    }
    return null;
  };
  const order = new Map(ir.nodes.map((n, i) => [n.id, i]));
  const byWeight = (a: { id: string; weight?: number }, b: { id: string; weight?: number }) =>
    (b.weight ?? 0) - (a.weight ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const bands = new Map<string | null, { id: string; weight?: number; label: string; sublabel?: string }[]>();
  for (const n of ir.nodes) {
    const z = zoneOf(n.group);
    const list = bands.get(z) ?? [];
    list.push(n);
    bands.set(z, list);
  }
  const zoneOrder = new Map(ir.groups.map((g, i) => [g.id, i]));
  const weightOf = (ns: { weight?: number }[]) => ns.reduce((a, n) => a + (n.weight ?? 0), 0);
  return [...bands.entries()]
    .sort(([a, na], [b, nb]) => {
      if (a === null || b === null) return a === null ? 1 : -1;
      return nb.length - na.length || weightOf(nb) - weightOf(na) || (zoneOrder.get(a) ?? 0) - (zoneOrder.get(b) ?? 0);
    })
    .map(([id, ns]) => ({ id, rooms: [...ns].sort(byWeight).map((n) => ({ id: n.id, w: roomWidth(n.label, n.sublabel) })) }));
}

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

/** Inner building width whose plan is closest to {@link ASPECT} (ties: the narrower one). */
function chooseWidth(bands: readonly Band[], grouped: boolean): number {
  const pad = grouped ? ZONE.pad * 2 : 0;
  const widest = Math.max(...bands.flatMap((b) => b.rooms.map((r) => r.w))) + pad;
  const area = bands.reduce((a, b) => a + b.rooms.reduce((s, r) => s + (r.w + ROOM_BOX.gap) * (ROOM_BOX.h + ROOM_BOX.gap), 0), 0);
  const w0 = Math.max(widest, Math.sqrt(area * ASPECT));
  let best = widest;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let f = 0.55; f <= 2.501; f += 0.05) {
    const w = Math.max(widest, Math.round(w0 * f));
    const h = bands.reduce((a, b) => a + bandHeight(b, w - pad, grouped), 0) + ZONE.gap * Math.max(0, bands.length - 1);
    const err = Math.abs(Math.log((w + BLDG_PAD * 2) / (h + BLDG_PAD * 2) / ASPECT));
    if (err < bestErr - 1e-9) {
      bestErr = err;
      best = w;
    }
  }
  return best;
}

/** IR (`kind: "container"`) → layout of the building, its zones and rooms (coordinates rounded to 0.5 px). */
export function roomsLayout(raw: DiagramIR, irHash: string): DiagramLayout {
  const ir = uniqueIR(raw);
  const bands = bandsOf(ir).filter((b) => b.rooms.length > 0);
  if (bands.length === 0) return { diagram: ir.id, irHash, engine: ROOMS_ENGINE, width: BLDG_PAD * 2, height: BLDG_PAD * 2, nodes: [], edges: [], groups: [] };
  const grouped = bands.some((b) => b.id !== null);
  const W = chooseWidth(bands, grouped);
  const nodes: DiagramLayout["nodes"] = [];
  const groups: DiagramLayout["groups"] = [];
  let y = BLDG_PAD;
  for (const band of bands) {
    const boxed = band.id !== null || grouped;
    const inner = boxed ? W - ZONE.pad * 2 : W;
    const h = bandHeight(band, inner, grouped);
    if (band.id !== null) groups.push({ id: band.id, x: BLDG_PAD, y: half(y), w: W, h: half(h) });
    let ry = y + (band.id !== null ? ZONE.head : grouped ? ZONE.pad : 0);
    for (const row of rowsOf(band.rooms, inner)) {
      let rx = BLDG_PAD + (boxed ? ZONE.pad : 0);
      for (const r of row) {
        nodes.push({ id: r.id, x: half(rx), y: half(ry), w: half(r.w), h: ROOM_BOX.h });
        rx += r.w + ROOM_BOX.gap;
      }
      ry += ROOM_BOX.h + ROOM_BOX.gap;
    }
    y += h + ZONE.gap;
  }
  const order = new Map(ir.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const gorder = new Map(ir.groups.map((g, i) => [g.id, i]));
  groups.sort((a, b) => (gorder.get(a.id) ?? 0) - (gorder.get(b.id) ?? 0));
  const box = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramLayout["edges"] = [];
  for (const e of ir.edges) {
    const a = box.get(e.from);
    const b = box.get(e.to);
    if (!a || !b || a === b) continue;
    const p = exitPoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const q = exitPoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    const points: [number, number][] = [
      [half(p[0]), half(p[1])],
      [half(q[0]), half(q[1])],
    ];
    edges.push({ id: e.id, points, ...(e.label ? { label: [half((p[0] + q[0]) / 2), half((p[1] + q[1]) / 2)] as [number, number] } : {}) });
  }
  return { diagram: ir.id, irHash, engine: ROOMS_ENGINE, width: half(W + BLDG_PAD * 2), height: half(y - ZONE.gap + BLDG_PAD), nodes, edges, groups };
}
