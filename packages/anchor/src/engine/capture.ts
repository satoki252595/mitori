/** Anchor capture (loop spec §1.2): code (snippet hash + TextQuote) and doc (TextQuote + claim binding). */
import {
  type BlockId,
  type ClaimId,
  type CodeAnchor,
  type DocAnchor,
  type GitOid,
  type Hasher,
  type LineNo,
  MitoriError,
  type RepoPath,
  type SymbolKey,
  type TextQuote,
  type Xxh3,
} from "@mitori/core";
import { ANCHOR_LIMITS } from "../contract.ts";
import { snippetHash, splitLines } from "../normalize/index.ts";
import { findQuote } from "./quote.ts";

const CTX = ANCHOR_LIMITS.quoteContextChars;

/** Line-start offsets of `lines` joined by "\n" (the LF-normalized text every code quote refers to). */
export function lineOffsets(lines: readonly string[]): Int32Array {
  const out = new Int32Array(lines.length + 1);
  for (let i = 0; i < lines.length; i++) out[i + 1] = (out[i] as number) + (lines[i] as string).length + 1;
  return out;
}

/** 1-based line containing char offset `off` (binary search over {@link lineOffsets}). */
export function lineAt(offsets: Int32Array, off: number): LineNo {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] as number) <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Cut a code quote at the last LF within the limit (or hard at the limit when there is none). */
export function capCodeExact(exact: string): string {
  const max = ANCHOR_LIMITS.codeQuoteMaxChars;
  if (exact.length <= max) return exact;
  const lf = exact.lastIndexOf("\n", max - 1);
  return lf > 0 ? exact.slice(0, lf) : exact.slice(0, max);
}

/** TextQuote of [from, to) in `text` (exact capped like a code quote; context taken around the capped exact). */
export function codeQuoteAt(text: string, from: number, to: number): TextQuote {
  const exact = capCodeExact(text.slice(from, to));
  return { prefix: text.slice(Math.max(0, from - CTX), from), exact, suffix: text.slice(from + exact.length, from + exact.length + CTX) };
}

/** §1.2.2. `text` is the whole file; `charRange` offsets refer to its LF-normalized form. */
export function captureCode(
  hasher: Hasher,
  path: RepoPath,
  start: LineNo,
  end: LineNo,
  text: string,
  blob: GitOid,
  symbol?: SymbolKey,
  charRange?: { from: number; to: number },
): CodeAnchor {
  const lines = splitLines(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new MitoriError("E_INVALID_INPUT", `code anchor range ${start}-${end} outside 1-${lines.length}`, {
      params: { path, start, end, lines: lines.length },
    });
  }
  const norm = lines.join("\n");
  const offs = lineOffsets(lines);
  let from = offs[start - 1] as number;
  let to = (offs[end] as number) - 1;
  if (charRange && charRange.from >= 0 && charRange.to > charRange.from && charRange.to <= norm.length) {
    from = charRange.from;
    to = charRange.to;
  }
  const anchor: CodeAnchor = { path, start, end, blob, snippet: snippetHash(hasher, lines, start, end), quote: codeQuoteAt(norm, from, to) };
  if (symbol !== undefined) anchor.symbol = symbol;
  return anchor;
}

/** Selection/claim binding (§1.2.1-4): overlap ≥ 50 % of the selection and ≥ 30 % of the claim; max overlap, first on ties. */
export function bindClaim(selStart: number, selEnd: number, claims: readonly { id: ClaimId; start: number; end: number }[] | undefined): ClaimId | undefined {
  if (!claims || selEnd <= selStart) return undefined;
  const sel = selEnd - selStart;
  let best: { id: ClaimId; ov: number } | undefined;
  for (const c of claims) {
    const len = c.end - c.start;
    if (len <= 0) continue;
    const ov = Math.min(selEnd, c.end) - Math.max(selStart, c.start);
    if (ov <= 0 || ov < ANCHOR_LIMITS.claimBindOverlap.ofSelection * sel || ov < ANCHOR_LIMITS.claimBindOverlap.ofClaim * len) continue;
    if (!best || ov > best.ov) best = { id: c.id, ov };
  }
  return best?.id;
}

/** §1.2.1 steps 1–4. A zero-length selection anchors the whole block (no quote, no offset). */
export function captureDoc(
  block: BlockId,
  blockText: string,
  blockHash: Xxh3,
  selStart: number,
  selEnd: number,
  claims?: readonly { id: ClaimId; start: number; end: number }[],
): DocAnchor {
  const anchor: DocAnchor = { block, blockHash };
  if (!Number.isInteger(selStart) || !Number.isInteger(selEnd)) return anchor;
  const s = Math.max(0, Math.min(selStart, blockText.length));
  const e = Math.max(s, Math.min(selEnd, blockText.length));
  if (e === s) return anchor;
  const max = ANCHOR_LIMITS.docQuoteMaxChars;
  const truncated = e - s > max;
  const exact = blockText.slice(s, truncated ? s + max : e);
  // A truncated selection keeps no suffix: it is re-anchored like a whole-block anchor (§1.2.1-1).
  anchor.quote = { prefix: blockText.slice(Math.max(0, s - CTX), s), exact, suffix: truncated ? "" : blockText.slice(e, e + CTX) };
  anchor.offset = s;
  const claim = bindClaim(s, e, claims);
  if (claim !== undefined) anchor.claim = claim;
  return anchor;
}

/** True when the doc quote was truncated at capture (treated as a whole-block anchor). */
export function isWholeBlock(anchor: DocAnchor): boolean {
  return !anchor.quote || anchor.quote.exact.length === 0 || anchor.quote.exact.length >= ANCHOR_LIMITS.docQuoteMaxChars;
}

/** §1.2.1-6: the client quote must be found exactly in context, or fuzzily with score ≥ 0.9. */
export function verifyQuote(blockText: string, quote: TextQuote): boolean {
  if (quote.exact.length === 0) return true;
  if (blockText.includes(quote.prefix + quote.exact + quote.suffix)) return true;
  const m = findQuote(blockText, quote);
  return m !== null && m.score >= 0.9;
}
