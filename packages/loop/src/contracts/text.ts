import type { LineNo } from "@mitori/core";

// Local mirrors of the one-line helpers of `@mitori/anchor` (`splitLines`, `normLine`, `snippetText`). The anchor
// package owns them (WP-07) and its M0 stubs still throw; their semantics are fixed by the stub doc comments, so
// the loop keeps byte-equal copies instead of waiting. Swap for the anchor imports once WP-07 has landed (the
// edit-application tests pin the behaviour either way).

/** One physical line: its text and the terminator it had in the source ("" for an unterminated last line). */
export interface Segment {
  text: string;
  eol: string;
}

/** Split into lines the way the anchor engine counts them: CRLF and lone CR are separators, a final LF adds no empty line. */
export function segments(source: string): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  const n = source.length;
  for (let i = 0; i < n; i++) {
    const c = source.charCodeAt(i);
    if (c === 10) {
      out.push({ text: source.slice(start, i), eol: "\n" });
      start = i + 1;
    } else if (c === 13) {
      if (source.charCodeAt(i + 1) === 10) {
        out.push({ text: source.slice(start, i), eol: "\r\n" });
        i++;
      } else {
        out.push({ text: source.slice(start, i), eol: "\r" });
      }
      start = i + 1;
    }
  }
  if (start < n) out.push({ text: source.slice(start), eol: "" });
  return out;
}

/** `line.replace(/\s+/gu, " ").trim()`. */
export function normLine(line: string): string {
  return line.replace(/\s+/gu, " ").trim();
}

/** `lines[start-1..end-1].map(normLine).join("\n")`; empty when out of range (1-based inclusive). */
export function snippetText(lines: readonly string[], start: LineNo, end: LineNo): string {
  if (start < 1 || end < start || end > lines.length) return "";
  const out: string[] = [];
  for (let l = start; l <= end; l++) out.push(normLine(lines[l - 1] as string));
  return out.join("\n");
}

/** Lines of a new_text block: split on any newline, a final newline adds no empty line, "" is no lines. */
export function newTextLines(newText: string): string[] {
  if (newText === "") return [];
  const lines = newText.split(/\r\n|\r|\n/u);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
