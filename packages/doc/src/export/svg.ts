// Pre-laid-out diagrams for the export (gen spec §10.10): `DiagramIR` + the server layout → ONE inline SVG string, so
// the viewer ships no diagram code and no layout engine (the HTML export is read-only; the layout is the daemon's).
// Colours and fonts come from CSS classes (`.dg-*`, defined by the viewer stylesheet) over the design tokens, so dark
// mode and the reader's theme apply without re-rendering. Pure and deterministic (same IR + layout ⇒ same bytes).
import type { DiagramEdge, DiagramIR, DiagramLayout, DiagramNode } from "@mitori/core";
import { escapeHtml } from "../render/mdit.ts";

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
/** Same estimate the layout engines size boxes with (13 px UI font). */
const em = (s: string, narrow: number, wide: number): number => {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? wide : narrow;
  return w;
};
const LABEL = { narrow: 7.2, wide: 13 } as const;
/** More edges than this and the stylesheet draws them as a light texture. */
const DENSE_EDGES = 24;
const SUB = { narrow: 6.4, wide: 11 } as const;

const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/** Cut `s` to `max` px with a trailing 「…」. */
function fit(s: string, max: number, font: { narrow: number; wide: number }): string {
  if (em(s, font.narrow, font.wide) <= max) return s;
  let out = "";
  for (const c of s) {
    if (em(`${out}${c}…`, font.narrow, font.wide) > max) break;
    out += c;
  }
  return `${out}…`;
}

/** Greedy wrap at `max` px into at most `lines` lines (last line gets the 「…」). */
function wrap(s: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of s) {
    if (em(cur + c, LABEL.narrow, LABEL.wide) > max && cur !== "") {
      out.push(cur);
      cur = "";
    }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  if (out.length <= lines) return out;
  const head = out.slice(0, lines - 1);
  return [...head, fit(out.slice(lines - 1).join(""), max, LABEL)];
}

function nodeSvg(n: DiagramNode, b: DiagramLayout["nodes"][number]): string {
  const inner = Math.max(24, b.w - 20);
  const sub = n.sublabel ? fit(n.sublabel, inner, SUB) : "";
  const room = sub ? Math.max(1, Math.floor((b.h - 14) / 18) - 1) : Math.max(1, Math.floor((b.h - 8) / 18));
  const lines = wrap(n.label, inner, Math.min(3, room));
  const textH = lines.length * 17 + (sub ? 15 : 0);
  let y = b.y + (b.h - textH) / 2 + 13;
  const cx = b.x + b.w / 2;
  const shape = n.shape ?? "box";
  const rx = shape === "actor" ? Math.min(b.h / 2, 18) : shape === "queue" ? 4 : 8;
  let out = `<g class="dg-node" data-shape="${shape}" data-node="${escapeHtml(n.id)}"><rect x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}" rx="${n2(rx)}"/>`;
  if (shape === "store") out += `<path class="dg-store" d="M${n2(b.x)} ${n2(b.y + 9)}q${n2(b.w / 2)} 8 ${n2(b.w)} 0"/>`;
  if (shape === "note") out += `<path class="dg-fold" d="M${n2(b.x + b.w - 12)} ${n2(b.y)}v12h12"/>`;
  for (const line of lines) {
    out += `<text class="dg-nl" x="${n2(cx)}" y="${n2(y)}" text-anchor="middle">${escapeHtml(line)}</text>`;
    y += 17;
  }
  if (sub) out += `<text class="dg-ns" x="${n2(cx)}" y="${n2(y - 1)}" text-anchor="middle">${escapeHtml(sub)}</text>`;
  return `${out}</g>`;
}

function edgeSvg(e: DiagramEdge, l: DiagramLayout["edges"][number], marker: string): string {
  if (l.points.length < 2) return "";
  const d = l.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n2(x)} ${n2(y)}`).join("");
  let out = `<g class="dg-edge" data-kind="${e.kind}"><path d="${d}" marker-end="url(#${marker})"/>`;
  if (e.label && l.label) {
    const text = fit(e.label, 220, SUB);
    out += `<text class="dg-el" x="${n2(l.label[0])}" y="${n2(l.label[1])}" text-anchor="middle">${escapeHtml(text)}</text>`;
  }
  return `${out}</g>`;
}

/** A DOM-safe id fragment of a diagram id (`dg_ab12cd34` is already safe; anything else is cleaned). */
const idPart = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * The diagram as `<div class="dg-box"><svg class="dg">…</svg></div>`. `title` becomes the accessible name; the
 * node + edge text alternative stays in the block's `ul.mdiagram-text` (the viewer hides that list visually only).
 */
export function diagramSvg(ir: DiagramIR, layout: DiagramLayout, label: string): string {
  const marker = `dga-${idPart(ir.id)}`;
  const nodes = new Map(ir.nodes.map((n) => [n.id, n]));
  const edges = new Map(ir.edges.map((e) => [e.id, e]));
  const groups = new Map(ir.groups.map((g) => [g.id, g]));
  const w = Math.max(1, Math.ceil(layout.width));
  const h = Math.max(1, Math.ceil(layout.height));
  let body = "";
  // outer groups first (parents are drawn under their children)
  const depth = (id: string): number => {
    let d = 0;
    for (let g = groups.get(id)?.parent; g !== undefined && d < 16; g = groups.get(g)?.parent) d++;
    return d;
  };
  for (const g of [...layout.groups].sort((a, b) => depth(a.id) - depth(b.id))) {
    const gl = groups.get(g.id);
    if (!gl) continue;
    body += `<g class="dg-grp"><rect x="${n2(g.x)}" y="${n2(g.y)}" width="${n2(g.w)}" height="${n2(g.h)}" rx="10"/><text class="dg-gl" x="${n2(g.x + 12)}" y="${n2(g.y + 18)}">${escapeHtml(fit(gl.label, Math.max(40, g.w - 24), SUB))}</text></g>`;
  }
  if (ir.kind === "sequence") {
    for (const b of layout.nodes) {
      const cx = b.x + b.w / 2;
      body += `<path class="dg-life" d="M${n2(cx)} ${n2(b.y + b.h)}V${n2(h - 8)}"/>`;
    }
  }
  for (const l of layout.edges) {
    const e = edges.get(l.id);
    if (e) body += edgeSvg(e, l, marker);
  }
  for (const b of layout.nodes) {
    const n = nodes.get(b.id);
    if (n) body += nodeSvg(n, b);
  }
  const defs = `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="dg-arrow"/></marker></defs>`;
  // many edges (a module map) read as a texture, not as lines: the stylesheet lightens them
  const dense = ir.edges.length > DENSE_EDGES ? ' data-dense=""' : "";
  return `<div class="dg-box"><svg class="dg"${dense} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="--w:${w}" role="img" aria-label="${escapeHtml(label)}" focusable="false">${defs}${body}</svg></div>`;
}
