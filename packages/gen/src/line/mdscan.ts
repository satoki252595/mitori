/**
 * Markdown scanning shared by the line validator (V11–V14, W07), the Verifier (L1 identifiers) and the
 * apply path (claim quotes): code-span / fence masking, `[[n]]` markers and the marker → claim span
 * derivation of gen spec §6.6.
 * CR-PENDING(WP-06): `@mitori/doc` owns `deriveClaimSpans` (codec); gen needs the same algorithm inside the
 * validator before the doc store is involved, so it lives here too. Both implement §6.6; switch to the doc
 * export once it is implemented and proven identical by a shared golden.
 */
import type { ClaimSpan } from "@mitori/doc";

/** Half-open [start, end) ranges of code (fenced code lines and inline code spans incl. their backticks). */
export type Ranges = readonly (readonly [number, number])[];

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Per line of `md.split("\n")`: true when the line belongs to a fenced code block (fence lines included). */
export function fencedLines(md: string): boolean[] {
  const out: boolean[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (const line of md.split("\n")) {
    const m = FENCE_OPEN_RE.exec(line);
    if (fence) {
      out.push(true);
      if (m?.[1] && m[1][0] === fence.ch && m[1].length >= fence.len && line.slice(m[0].length).trim() === "") fence = null;
      continue;
    }
    if (m?.[1]) fence = { ch: m[1][0] as string, len: m[1].length };
    out.push(fence !== null);
  }
  return out;
}

/** Ranges of fenced code lines (fence lines included). */
export function fenceRanges(md: string): Ranges {
  const out: [number, number][] = [];
  const flags = fencedLines(md);
  let pos = 0;
  md.split("\n").forEach((line, k) => {
    if (flags[k]) out.push([pos, pos + line.length + 1]);
    pos += line.length + 1;
  });
  return out;
}

/** Ranges of inline code spans (backticks included) outside `fenced`. */
export function inlineCodeRanges(md: string, fenced: Ranges = fenceRanges(md)): Ranges {
  const out: [number, number][] = [];
  let i = 0;
  while (i < md.length) {
    if (md[i] !== "`" || inRanges(fenced, i)) {
      i++;
      continue;
    }
    let k = i;
    while (md[k] === "`") k++;
    const run = k - i;
    let j = k;
    let close = -1;
    while (j < md.length) {
      if (md[j] === "`" && !inRanges(fenced, j)) {
        let q = j;
        while (md[q] === "`") q++;
        if (q - j === run) {
          close = j;
          break;
        }
        j = q;
      } else j++;
    }
    if (close < 0) {
      i = k;
      continue;
    }
    out.push([i, close + run]);
    i = close + run;
  }
  return out;
}

/** Code ranges of a Markdown string (CommonMark-lite: fences by line, inline spans by equal backtick runs). */
export function codeRanges(md: string): Ranges {
  const fenced = fenceRanges(md);
  return [...fenced, ...inlineCodeRanges(md, fenced)].sort((a, b) => a[0] - b[0]);
}

/** True when `i` lies inside one of `ranges`. */
export function inRanges(ranges: Ranges, i: number): boolean {
  for (const [s, e] of ranges) {
    if (i < s) return false;
    if (i < e) return true;
  }
  return false;
}

/** A `[[n]]` marker outside code. */
export interface Marker {
  /** Marker number. */
  n: number;
  /** Offset of `[[`. */
  start: number;
  /** Offset after `]]`. */
  end: number;
}

const MARKER_RE = /\[\[([1-9][0-9]?)\]\]/g;

/** Markers outside code spans and fences, in order. */
export function scanMarkers(md: string, ranges: Ranges = codeRanges(md)): Marker[] {
  const out: Marker[] = [];
  for (const m of md.matchAll(MARKER_RE)) {
    const at = m.index ?? 0;
    if (!inRanges(ranges, at)) out.push({ n: Number(m[1]), start: at, end: at + m[0].length });
  }
  return out;
}

/** Marker numbers that occur only inside code (V14 "inside a code span only"). */
export function markersInCode(md: string, ranges: Ranges = codeRanges(md)): Set<number> {
  const out = new Set<number>();
  for (const m of md.matchAll(MARKER_RE)) if (inRanges(ranges, m.index ?? 0)) out.add(Number(m[1]));
  return out;
}

const TERMINATORS = "。．！？!?.";
const CLOSERS = "」』）)\"'";

/**
 * W07: a marker run placed after sentence punctuation (`返す。[[1]]`, `works.[[1]]`, `だ。」[[1]]`) moves in
 * front of the punctuation (`返す[[1]]。`). Returns the normalized md and whether anything moved.
 */
export function normalizeMarkers(md: string): { md: string; moved: boolean } {
  const ranges = codeRanges(md);
  const markers = scanMarkers(md, ranges);
  if (markers.length === 0) return { md, moved: false };
  const runs: { start: number; end: number }[] = [];
  for (const m of markers) {
    const last = runs.at(-1);
    if (last && last.end === m.start) last.end = m.end;
    else runs.push({ start: m.start, end: m.end });
  }
  let out = md;
  let moved = false;
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r] as { start: number; end: number };
    let k = run.start;
    while (k > 0 && CLOSERS.includes(out[k - 1] as string) && !inRanges(ranges, k - 1)) k--;
    let t = k;
    while (t > 0 && TERMINATORS.includes(out[t - 1] as string) && !inRanges(ranges, t - 1)) t--;
    if (t === k) continue;
    const text = out.slice(run.start, run.end);
    out = out.slice(0, t) + text + out.slice(t, run.start) + out.slice(run.end);
    moved = true;
  }
  return { md: out, moved };
}

const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const FULL_WIDTH_PUNCT = "。、）」』！？：；";

/**
 * W10: place the markers `ns` (in this order) one per unit of a block that has claims but no marker at all — one
 * per list item for a list, one per sentence for prose — before the unit's final punctuation. Only when the units
 * and the claims are equally many (otherwise which sentence a claim proves is a guess, and the line is retried).
 * Tables and fenced code are never touched. Returns null when no placement is safe.
 */
export function placeMarkers(md: string, ns: readonly number[]): string | null {
  if (ns.length === 0 || md.includes("|") || fencedLines(md).some(Boolean)) return null;
  const ranges = codeRanges(md);
  if (scanMarkers(md, ranges).length > 0) return null;
  const lines = md.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const ends: number[] = [];
  if (nonEmpty.length > 0 && nonEmpty.every((l) => LIST_ITEM_RE.test(l))) {
    let pos = 0;
    for (const l of lines) {
      if (l.trim() !== "") ends.push(pos + l.trimEnd().length);
      pos += l.length + 1;
    }
  } else {
    if (nonEmpty.some((l) => LIST_ITEM_RE.test(l))) return null;
    let last = 0;
    for (let i = 0; i < md.length; i++) {
      if (inRanges(ranges, i)) continue;
      const ch = md[i] as string;
      const full = "。．！？".includes(ch);
      const half = "!?.".includes(ch) && /\s|$/.test(md[i + 1] ?? "") && i > 0 && /[A-Za-z)\]`'"]/.test(md[i - 1] ?? "");
      if (!full && !half) continue;
      let k = i + 1;
      while (k < md.length && CLOSERS.includes(md[k] as string)) k++;
      if (md.slice(last, i).trim() !== "") ends.push(k);
      last = k;
    }
    if (md.slice(last).trim() !== "") ends.push(md.trimEnd().length);
  }
  if (ends.length !== ns.length) return null;
  let out = md;
  for (let u = ends.length - 1; u >= 0; u--) {
    let at = ends[u] as number;
    // before the closers and the terminator of the unit (`返す。」` → `返す[[1]]。」`)
    while (at > 0 && CLOSERS.includes(out[at - 1] as string) && !inRanges(ranges, at - 1)) at--;
    while (at > 0 && TERMINATORS.includes(out[at - 1] as string) && !inRanges(ranges, at - 1)) at--;
    out = `${out.slice(0, at)}[[${ns[u]}]]${out.slice(at)}`;
  }
  return out;
}

/** `md` without its `[[n]]` markers (outside code). */
export function stripMarkers(md: string): string {
  const markers = scanMarkers(md);
  let out = md;
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i] as Marker;
    out = out.slice(0, m.start) + out.slice(m.end);
  }
  return out;
}

/**
 * W12 (Japanese): drop the spaces models put after full-width punctuation (`返す。 次に`, `（推測）。 AI`). The style
 * rule asks for one ASCII space only between Japanese and Latin text; after 。、）」 it shows as a gap. Code is kept.
 */
export function tightenFullWidth(md: string): { md: string; changed: boolean } {
  const ranges = codeRanges(md);
  let out = "";
  let changed = false;
  for (let i = 0; i < md.length; i++) {
    const ch = md[i] as string;
    out += ch;
    if (!FULL_WIDTH_PUNCT.includes(ch) || inRanges(ranges, i)) continue;
    let k = i + 1;
    while (md[k] === " " || md[k] === "\t") k++;
    if (k > i + 1 && k < md.length && md[k] !== "\n" && md[k] !== "|") {
      changed = true;
      i = k - 1;
    }
  }
  return { md: out, changed };
}

/** Contents of the inline code spans of `md` (CommonMark: one surrounding space is stripped when both sides have one). */
export function codeSpans(md: string): string[] {
  const out: string[] = [];
  for (const [s, e] of inlineCodeRanges(md)) {
    let k = s;
    while (md[k] === "`") k++;
    const run = k - s;
    let body = md.slice(k, e - run).replace(/\n/g, " ");
    if (body.length >= 2 && body.startsWith(" ") && body.endsWith(" ") && body.trim() !== "") body = body.slice(1, -1);
    if (body.trim() !== "") out.push(body);
  }
  return out;
}

/** Plain text of a Markdown fragment (ANCHOR_TEXT_RULES-like: no markup, collapsed whitespace, NFC). */
export function plainText(md: string): string {
  const fenced = fenceRanges(md);
  const inline = new Set(inlineCodeRanges(md, fenced).map(([s]) => s));
  let out = "";
  let i = 0;
  for (const [s, e] of codeRanges(md)) {
    out += stripInline(md.slice(i, s));
    if (inline.has(s)) {
      let k = s;
      while (md[k] === "`") k++;
      out += md.slice(k, e - (k - s));
    } else if (!FENCE_OPEN_RE.test(md.slice(s, e))) out += md.slice(s, e);
    i = e;
  }
  out += stripInline(md.slice(i));
  return out.replace(/\s+/g, " ").trim().normalize("NFC");
}

function stripInline(text: string): string {
  return text
    .replace(MARKER_RE, "")
    .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\*\*|__|\*|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])|~~/g, "");
}

/** Sentence-start offsets outside code: 0, after `\n`, after `。．！？`, after `.!?` + whitespace, after a table `|`. */
function boundaries(md: string, ranges: Ranges): number[] {
  const out = [0];
  for (let i = 0; i < md.length; i++) {
    const c = md[i] as string;
    if (inRanges(ranges, i)) continue;
    if (c === "\n" || c === "|" || "。．！？".includes(c)) out.push(i + 1);
    else if ("!?.".includes(c) && /\s/.test(md[i + 1] ?? "")) out.push(i + 1);
  }
  return out;
}

/** Unmarked code-naming sentences: insertion offsets for inferred claims, never borrowed proof from a neighbour. */
export function uncitedCodeEnds(md: string): number[] {
  if (md.includes("|") || fencedLines(md).some(Boolean)) return [];
  const ranges = codeRanges(md);
  const bounds = [...boundaries(md, ranges), md.length];
  const out: number[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const start = bounds[i - 1] as number;
    const end = bounds[i] as number;
    const text = md.slice(start, end);
    if (codeSpans(text).length === 0 || scanMarkers(text).length > 0) continue;
    let at = end;
    while (at > start && /\s/.test(md[at - 1] as string)) at--;
    while (at > start && CLOSERS.includes(md[at - 1] as string) && !inRanges(ranges, at - 1)) at--;
    while (at > start && TERMINATORS.includes(md[at - 1] as string) && !inRanges(ranges, at - 1)) at--;
    out.push(at);
  }
  return out;
}

/**
 * Claim spans of a marker-form md (§6.6 steps 3–5). The span of marker n is the text from the nearest
 * sentence / line / cell / previous-marker boundary to the marker; a marker directly following another
 * (`…[[1]][[2]]`) shares the previous span. Quotes are capped at 300 chars.
 */
export function deriveSpans(md: string, quoteChars = 300): ClaimSpan[] {
  const ranges = codeRanges(md);
  const bounds = boundaries(md, ranges);
  const out: ClaimSpan[] = [];
  let prevEnd = 0;
  let prev: ClaimSpan | null = null;
  for (const m of scanMarkers(md, ranges)) {
    let s = prevEnd;
    for (const b of bounds) if (b <= m.start && b > s) s = b;
    let span: ClaimSpan;
    if (prev && md.slice(s, m.start).trim() === "") span = { ...prev, n: m.n };
    else {
      const src = md.slice(s, m.start);
      span = { n: m.n, start: s, end: m.start, quote: plainText(src).slice(0, quoteChars), identifiers: codeSpans(src) };
    }
    out.push(span);
    prev = span;
    prevEnd = m.end;
  }
  return out;
}

/**
 * EX-04 (expert audit): factual sentences without a source. A cite marker after two sentences made only the last a
 * claim; the first got no claim, no L1, no 〜推測 mark — and looked like verified text. 17 % of crit's module-page
 * sentences had no cite (27 of them naming code), including the one wrong security statement. This counts them, for
 * the quality report and the spot-check sample: a sentence is cited when a marker (`[[n]]`, marker form) or a line
 * link (`](…#L12…)`, file form) sits inside it or right after it. Headings, callout labels, fences and table rows are
 * not prose.
 */
export function uncitedSentences(md: string): { sentences: number; uncited: string[]; uncitedWithCode: string[] } {
  const prose = md
    .split("\n")
    .filter((l) => !/^\s*(#{1,6}\s|\||<!--|> \[!|```|~~~)/.test(l) && !/^\s*>\s*\*\*/.test(l))
    .join("\n");
  const ranges = fenceRanges(prose);
  const text = prose
    .split("")
    .map((c, i) => (inRanges(ranges, i) ? " " : c))
    .join("");
  const cite = /\[\[\d+\]\]|\]\([^)\s]*#L\d+[^)]*\)/;
  // a sentence ends at 。！？ (or ". "), its cite may follow in a full-width paren group 「（[a](…#L1)）。」
  const parts = text.split(/(?<=[。！？])|(?<=[.!?])\s+|\n+/);
  let sentences = 0;
  const uncited: string[] = [];
  const withCode: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const raw = (parts[i] ?? "").trim();
    const plain = plainText(raw.replace(/^\s*(>|[-*+]|\d+\.)\s+/, "")).trim();
    if (plain.length < 8) continue;
    sentences++;
    const next = (parts[i + 1] ?? "").trim();
    if (cite.test(raw) || /^[（(]\s*\[/.test(next)) continue;
    uncited.push(plain);
    if (/`[^`\n]+`/.test(raw)) withCode.push(plain);
  }
  return { sentences, uncited, uncitedWithCode: withCode };
}
