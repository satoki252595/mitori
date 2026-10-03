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
