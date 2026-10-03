// Text helpers shared by the extractor, the generic extractor and the skeleton renderer.

const decoder = new TextDecoder("utf-8", { fatal: false });

/** UTF-8 decode (lossy); a leading BOM is dropped so offsets and line 1 match what editors show. */
export function decodeUtf8(bytes: Uint8Array): string {
  const s = decoder.decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const encoder = new TextEncoder();

/** UTF-8 encode. */
export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Physical lines without terminators (a trailing newline does not open a new line; `\r` is stripped). */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.endsWith("\r")) lines[i] = l.slice(0, -1);
  }
  return lines;
}

/** Sorted start offsets of every line (offset → line lookups by binary search). */
export function lineStarts(text: string): number[] {
  const out = [0];
  let i = text.indexOf("\n");
  while (i >= 0) {
    out.push(i + 1);
    i = text.indexOf("\n", i + 1);
  }
  return out;
}

/** 1-based line of a UTF-16 offset. */
export function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Collapse whitespace runs (newlines included) to one space and trim. */
export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Truncate to `max` UTF-16 units with an ellipsis. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** LOC (non-blank lines that are not entirely covered by comments). `commentLines` holds 1-based line numbers. */
export function countLoc(lines: readonly string[], commentLines: ReadonlySet<number>): number {
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (commentLines.has(i + 1)) continue;
    if (/\S/.test(lines[i] as string)) n++;
  }
  return n;
}

/** Strip comment markers from doc lines (`//`, `///`, `//!`, `/**`, `*`, `*\/`, `#`) and trim (spec §3.6). */
export function stripCommentMarkers(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    let l = line.trim();
    l = l.replace(/^\/\*+!?/, "").replace(/\*+\/$/, "");
    l = l.replace(/^\/\/[/!]?/, "");
    l = l.replace(/^\*(?!\/)/, "");
    l = l.replace(/^#+/, "");
    out.push(l.replace(/^ /, "").trimEnd());
  }
  return out.join("\n").trim();
}

/** Text of a Python docstring literal without quotes / prefixes, dedented and trimmed. */
export function stripDocstring(raw: string): string {
  const m = /^[rRuUbBfF]{0,2}("""|'''|"|')([\s\S]*?)\1$/.exec(raw.trim());
  const body = m ? (m[2] ?? "") : raw;
  const lines = body.split("\n").map((l) => l.trimEnd());
  const indents = lines
    .slice(1)
    .filter((l) => l.trim() !== "")
    .map((l) => (/^\s*/.exec(l) as RegExpExecArray)[0].length);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((l, i) => (i === 0 ? l.trim() : l.slice(cut)))
    .join("\n")
    .trim();
}

/** License header detection (spec §3.6): a comment block starting at line 1 mentioning copyright / license / SPDX. */
export function isLicenseHeader(startLine: number, text: string): boolean {
  return startLine === 1 && /copyright|licen[cs]e|spdx/i.test(text);
}

/** The first paragraph of a doc text, ≤ `max` chars (core SymbolEntry.doc). */
export function firstParagraph(doc: string, max = 200): string {
  const p = doc.split(/\n\s*\n/)[0] ?? doc;
  return clip(squash(p), max);
}
