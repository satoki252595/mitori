// Block body HTML with claim placeholders (PT-07): the cacheable part of a block's rendering. Placeholders are
// private-use runs — `<k>` opens claim k's span, `<k>` marks its cite chip — and `splice`
// replaces them with the CURRENT claim's span/chips at serve time.
import { type Block, type DocLang, HTML_CONTRACT } from "@mitori/core";
import { markerize, markerPositions } from "../codec/cite.ts";
import { codeRanges, overlaps } from "../codec/protect.ts";
import { claimSpans } from "../codec/spans.ts";
import { BLOCK_ID_COMMENT_RE, CALLOUT_FORMAT } from "../contract.ts";
import { docMarkdown, escapeHtml, fencesOf, type RenderEnv } from "./mdit.ts";

const ID_COMMENT_G = new RegExp(`[ \\t]*${BLOCK_ID_COMMENT_RE}`, "g");

/** Remove block-ID comments outside code before markdown-it (DOC-U-003); code keeps ID-like text. */
export function stripIdComments(md: string): string {
  if (!md.includes("<!-- b_")) return md;
  const code = codeRanges(md);
  return md.replace(ID_COMMENT_G, (all, _id: string, off: number) => (overlaps(code, off, off + all.length) ? all : ""));
}

/** Marker form with claim placeholders inserted (k = marker occurrence, 1-based). */
export function withPlaceholders(markerMd: string): string {
  const clean = markerMd.replace(/[-]/g, "");
  const marks = markerPositions(clean);
  if (marks.length === 0) return clean;
  const spans = claimSpans(clean);
  const inserts: { at: number; text: string; drop?: number }[] = [];
  let prevStart = -1;
  marks.forEach((m, i) => {
    const k = i + 1;
    const s = spans[i];
    const shared = !s || s.start === prevStart;
    if (s && !shared) inserts.push({ at: s.start, text: `${k}` });
    inserts.push({ at: m.start, text: `${shared ? `${k}` : ""}${k}`, drop: m.end - m.start });
    prevStart = s?.start ?? prevStart;
  });
  inserts.sort((a, b) => a.at - b.at || (a.drop === undefined ? -1 : 1));
  let out = "";
  let at = 0;
  for (const ins of inserts) {
    out += clean.slice(at, ins.at) + ins.text;
    at = ins.at + (ins.drop ?? 0);
  }
  return out + clean.slice(at);
}

/** Close spans that would straddle tags: move an unbalanced span start right before its marker. */
export function balancePlaceholders(html: string): string {
  let out = html;
  for (const m of html.matchAll(/(\d+)/g)) {
    const k = m[1] as string;
    const open = out.indexOf(`${k}`);
    const end = out.indexOf(`${k}`, open);
    if (open < 0 || end < 0) continue;
    const between = out.slice(open, end);
    let depth = 0;
    let ok = true;
    for (const t of between.matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>/gi)) {
      if (t[3] === "/") continue;
      depth += t[1] === "/" ? -1 : 1;
      if (depth < 0) ok = false;
    }
    if (ok && depth === 0) continue;
    const tag = `${k}`;
    out = out.slice(0, open) + out.slice(open + tag.length, end) + tag + out.slice(end);
  }
  return out;
}

/** A fence that needs highlighting before the final render. */
export interface FenceJob {
  idx: number;
  lang: string;
  content: string;
}

/** Body pieces of one block: markdown-it tokens + env, plus the kind wrapper. */
export interface BodyPlan {
  tokens: ReturnType<typeof docMarkdown.parse>;
  env: RenderEnv;
  fences: FenceJob[];
  wrap: (inner: string) => string;
}

function calloutWrap(kind: Block["kind"], lang: DocLang): ((inner: string) => string) | null {
  if (!(kind in CALLOUT_FORMAT)) return null;
  const f = CALLOUT_FORMAT[kind as keyof typeof CALLOUT_FORMAT];
  const label = f.label ? f.label[lang] : null;
  if (kind === "deepdive")
    return (inner) => `<details class="${HTML_CONTRACT.deepdive.cls}"><summary>${escapeHtml(label ?? "")}</summary>\n${inner}</details>\n`;
  return (inner) => `<aside class="malert" data-alert="${kind}">${label ? `<p class="malert-label">${escapeHtml(label)}</p>\n` : ""}${inner}</aside>\n`;
}

/** Text fallback of a Mermaid flowchart/sequence for the diagram figure (node labels as a list). */
function mermaidFallback(src: string): string {
  const labels: string[] = [];
  for (const m of src.matchAll(/^\s*[a-z0-9_-]+\["([^"]*)"\]\s*$/gim)) labels.push(m[1] as string);
  for (const m of src.matchAll(/^\s*participant\s+\S+\s+as\s+(.+)$/gim)) labels.push(m[1] as string);
  const dec = (s: string) =>
    s
      .replace(/<br\/>/g, " ")
      .replace(/#quot;/g, '"')
      .replace(/#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
  return labels.length === 0 ? "" : `<ul class="mdiagram-text">${labels.map((l) => `<li>${escapeHtml(dec(l))}</li>`).join("")}</ul>`;
}

/** Plan the body render of a block (sync part). `block.md` is FILE form; `lang` selects wrapper labels. */
export function planBody(block: Pick<Block, "kind" | "md" | "diagram" | "lang">, lang: DocLang, terms: Map<string, string>): BodyPlan {
  const env: RenderEnv = { terms, usedTerms: new Set() };
  let md = stripIdComments(block.md);
  let wrap = (inner: string) => inner;
  if (block.kind === "diagram") {
    const fence = /```mermaid\n([\s\S]*?)```\s*$/.exec(md);
    const caption = fence ? md.slice(0, fence.index).trim() : md;
    const fallback = fence ? mermaidFallback(fence[1] as string) : "";
    md = caption;
    wrap = (inner) =>
      `<figure class="${HTML_CONTRACT.diagram.cls}" data-diagram="${escapeHtml(block.diagram ?? "")}">${fallback}${inner ? `<figcaption>${inner}</figcaption>` : ""}</figure>\n`;
  } else if (block.kind === "question") md = `- ${md.replace(/\n/g, "\n  ")}`;
  else wrap = calloutWrap(block.kind, lang) ?? wrap;
  const src = withPlaceholders(block.kind === "code" ? md : markerize(md, block.lang).md);
  const tokens = docMarkdown.parse(src, env);
  return { tokens, env, fences: fencesOf(tokens), wrap };
}

/** Final render once highlighted fences are in `plan.env.code`. */
export function finishBody(plan: BodyPlan): string {
  return balancePlaceholders(plan.wrap(docMarkdown.renderer.render(plan.tokens, docMarkdown.options, plan.env)));
}
