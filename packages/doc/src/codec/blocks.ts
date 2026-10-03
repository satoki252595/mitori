// Block-level structure of Markdown via markdown-it (block rules only — no inline pass, so it is cheap).
// Used by the parser to find code regions (ID comments inside them are text) and top-level block boundaries.
import markdownit from "markdown-it";

const blockOnly = markdownit({ html: false });
blockOnly.core.ruler.enableOnly(["normalize", "block"]);

/** A top-level block (markdown-it `token.map`, 0-based line range `[start, end)`). */
export interface TopBlock {
  /** Opening token type (`paragraph_open`, `heading_open`, `fence`, `table_open`, …). */
  type: string;
  /** First line. */
  start: number;
  /** Line after the last line. */
  end: number;
  /** Fence info string (fences only). */
  info: string;
}

/** Top-level blocks of `src` in order. */
export function topBlocks(src: string): TopBlock[] {
  const out: TopBlock[] = [];
  for (const t of blockOnly.parse(src, {})) {
    if (t.level !== 0 || !t.map || t.nesting === -1) continue;
    out.push({ type: t.type, start: t.map[0], end: t.map[1], info: t.info.trim() });
  }
  return out;
}

/** Per line: true when the line belongs to a fenced or indented code block at any nesting depth. */
export function codeLines(src: string, lineCount: number): boolean[] {
  const code = new Array<boolean>(lineCount).fill(false);
  for (const t of blockOnly.parse(src, {})) {
    if ((t.type !== "fence" && t.type !== "code_block") || !t.map) continue;
    for (let i = t.map[0]; i < t.map[1] && i < lineCount; i++) code[i] = true;
  }
  return code;
}

/** First word of a fence info string (`ts title=x` → `ts`). */
export function fenceLang(info: string): string {
  return info.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}
