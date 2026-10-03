/**
 * @mitori/anchor — `normalize/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Hasher, type LineNo, unsupported, type Xxh3 } from "@mitori/core";

/** Split text into lines: CRLF and lone CR become LF; a trailing empty element after a final LF is dropped. No NFC. */
export function splitLines(text: string): string[] {
  return unsupported("anchor.splitLines", text);
}

/** `line.replace(/\s+/gu, " ").trim()` — line identity for Myers, snippet hashes and `first_line` checks. */
export function normLine(line: string): string {
  return unsupported("anchor.normLine", line);
}

/** `lines[start-1..end-1].map(normLine).join("\n")`; empty string when out of range. 1-based inclusive. */
export function snippetText(lines: readonly string[], start: LineNo, end: LineNo): string {
  return unsupported("anchor.snippetText", lines, start, end);
}

/** `hasher.xxh3(snippetText(lines, start, end))` — the value stored in `Cite.snippet` / `CodeAnchor.snippet`. */
export function snippetHash(hasher: Hasher, lines: readonly string[], start: LineNo, end: LineNo): Xxh3 {
  return unsupported("anchor.snippetHash", hasher, lines, start, end);
}
