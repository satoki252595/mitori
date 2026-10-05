/** Static SVG serializer shared by daemon and on-demand legacy browser fallback. User labels and links are escaped. */

import type { MapView } from "./api.ts";
import { HREFS, type UiLang, type WorkspaceKey } from "./domain.ts";
import { LABEL_FONT, type PlanModel, type PlanText, pathLine, ROOM_TEXT, type RoomModel, textPx } from "./map-model.ts";
import { buildPlanModel } from "./map-plan.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
const fmtLocShort = (n: number) =>
  n >= 1000
    ? `${(n / 1000)
        .toFixed(1)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "")}k`
    : String(n);
const chipText = (c: { name: string; size: string }) => `${c.name} ${c.size}`;
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
    `<svg class="plan${m.doors ? " floor" : ""}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${esc(text.title)}" aria-describedby="${esc(descId)}" width="100%" height="100%">`,
    '<defs><pattern id="pl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern>',
    '<marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="fl-head" d="M0 1L10 5L0 9z"/></marker></defs>',
    '<g class="cam">',
    `<rect class="bldg" x="0" y="0" width="${n2(m.building?.w ?? m.width)}" height="${n2(m.building?.h ?? m.height)}" rx="2"/>`,
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
      `<title>${esc(r.label)}</title>`,
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
  out.push("</g>", '<g class="doors" aria-hidden="true">');
  for (const d of m.doors ?? []) {
    const h = d.len / 2;
    const gap = d.orient === "v" ? `M${n2(d.x)} ${n2(d.y - h)}v${n2(d.len)}` : `M${n2(d.x - h)} ${n2(d.y)}h${n2(d.len)}`;
    const leaf =
      d.orient === "v"
        ? `M${n2(d.x)} ${n2(d.y - h)}h${n2(d.len)}a${n2(d.len)} ${n2(d.len)} 0 0 1 -${n2(d.len)} ${n2(d.len)}`
        : `M${n2(d.x - h)} ${n2(d.y)}v${n2(d.len)}a${n2(d.len)} ${n2(d.len)} 0 0 0 ${n2(d.len)} -${n2(d.len)}`;
    out.push(`<path class="door-gap" d="${gap}"/><path class="door" d="${leaf}"/>`);
  }
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

/** Only these three fixed, localized SVG captions are needed server-side; catalog parity is tested. */
export const MAP_SVG_LABELS = {
  ja: { title: "間取り図（モジュールの配置）", room: "{zone} {room} · {files}ファイル · スレッド{n}", files: "{n}ファイル" },
  en: { title: "Floor plan (module layout)", room: "{zone} {room} · {files} files · {n} threads", files: "{n} files" },
} as const;
export function mapSvgPresentation(view: MapView, ws: WorkspaceKey, lang: UiLang, model: PlanModel = buildPlanModel(view)): string {
  const words = MAP_SVG_LABELS[lang];
  const format = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
  return renderPlanSvg(
    model,
    {
      title: words.title,
      roomLabel: (r) => format(words.room, { zone: r.zoneLabel, room: r.label, files: r.files, n: r.threads }),
      roomHref: (r) => (r.external && r.path ? HREFS.code(ws, r.path) : HREFS.map(ws, r.id as `md_${string}`)),
      files: (n) => format(words.files, { n }),
    },
    "plan-desc",
  );
}
