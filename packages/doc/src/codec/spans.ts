// Claim spans from marker form (§6.6-3..5): the sentence before each `[[n]]`.
import type { ClaimSpan } from "../contract.ts";
import { plainText } from "../render/text.ts";
import { markerPositions } from "./cite.ts";

const QUOTE_MAX = 300;
const HARD_TERMINATORS = "。．！？";

/** Offset right after the line's leading container syntax (spaces, `>`, list marker, table pipe). */
function contentStart(md: string, lineStart: number): number {
  const m = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:\|[ \t]*)?/.exec(md.slice(lineStart, lineStart + 64));
  return lineStart + (m ? m[0].length : 0);
}

/** Latest sentence boundary in `md[from, p)` (offset after it), or -1. */
function lastBoundary(md: string, from: number, p: number): number {
  for (let i = p - 1; i >= from; i--) {
    const c = md[i] as string;
    if (HARD_TERMINATORS.includes(c)) return i + 1;
    if ((c === "." || c === "!" || c === "?") && i + 1 < p && /\s/.test(md[i + 1] as string)) return i + 1;
    if (c === "|" && md[i - 1] !== "\\") return i + 1;
  }
  return -1;
}

const IDENT_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/** Backticked identifiers of a Markdown source fragment (L1 input). */
export function identifiersOf(src: string): string[] {
  const out: string[] = [];
  IDENT_RE.lastIndex = 0;
  for (let m = IDENT_RE.exec(src); m; m = IDENT_RE.exec(src)) {
    const v = (m[2] as string).trim();
    if (v !== "") out.push(v);
  }
  return out;
}

/** Derive claim spans (offsets into `markerMd`, quote ≤ 300 chars, identifiers from the span's source). */
export function claimSpans(markerMd: string): ClaimSpan[] {
  const out: ClaimSpan[] = [];
  let prevEnd = 0;
  let prev: ClaimSpan | null = null;
  for (const mk of markerPositions(markerMd)) {
    const lineStart = markerMd.lastIndexOf("\n", mk.start - 1) + 1;
    const floor = Math.max(prevEnd, contentStart(markerMd, lineStart), lineStart);
    const b = lastBoundary(markerMd, floor, mk.start);
    let s = Math.max(floor, b);
    while (s < mk.start && /[ \t]/.test(markerMd[s] as string)) s++;
    let span: ClaimSpan;
    if (s >= mk.start && prev) span = { ...prev, n: mk.n, identifiers: [...prev.identifiers] };
    else {
      const src = markerMd.slice(s, mk.start);
      span = {
        n: mk.n,
        start: s,
        end: mk.start,
        quote: plainText(src.replace(/\[\[[1-9][0-9]?\]\]/g, "")).slice(0, QUOTE_MAX),
        identifiers: identifiersOf(src),
      };
    }
    out.push(span);
    prev = span;
    prevEnd = mk.end;
  }
  return out;
}
