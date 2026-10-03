/**
 * @mitori/anchor — `normalize/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * Shared with gen's Verifier: any change here invalidates stored snippet hashes (`SNIPPET_NORMALIZATION`).
 */
import type { Hasher, LineNo, Xxh3 } from "@mitori/core";

const LINE_BREAK_RE = /\r\n?/g;
const WS_RUN_RE = /\s+/gu;

/** Split text into lines: CRLF and lone CR become LF; a trailing empty element after a final LF is dropped. No NFC. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = (text.includes("\r") ? text.replace(LINE_BREAK_RE, "\n") : text).split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `line.replace(/\s+/gu, " ").trim()` — line identity for Myers, snippet hashes and `first_line` checks. */
export function normLine(line: string): string {
  return line.replace(WS_RUN_RE, " ").trim();
}

/** `lines[start-1..end-1].map(normLine).join("\n")`; empty string when out of range. 1-based inclusive. */
export function snippetText(lines: readonly string[], start: LineNo, end: LineNo): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) return "";
  let out = normLine(lines[start - 1] as string);
  for (let i = start; i < end; i++) out += `\n${normLine(lines[i] as string)}`;
  return out;
}

/** `hasher.xxh3(snippetText(lines, start, end))` — the value stored in `Cite.snippet` / `CodeAnchor.snippet`. */
export function snippetHash(hasher: Hasher, lines: readonly string[], start: LineNo, end: LineNo): Xxh3 {
  return hasher.xxh3(snippetText(lines, start, end));
}
