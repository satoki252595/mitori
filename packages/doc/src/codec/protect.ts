// Character ranges of Markdown where markers and cite links are NOT recognized: fenced/indented code blocks and
// inline code spans (§6.6 "inline code と fence の外だけを走査する").
import { codeLines } from "./blocks.ts";

/** Sorted, non-overlapping `[start, end)` UTF-16 ranges. */
export type Ranges = [number, number][];

/** Code regions of `md` (block code + code spans). */
export function codeRanges(md: string): Ranges {
  const out: Ranges = [];
  if (md.includes("```") || md.includes("~~~") || /(^|\n)( {4}|\t)/.test(md)) {
    const lines = md.split("\n");
    const code = codeLines(md, lines.length);
    let at = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = (lines[i] as string).length + 1;
      if (code[i]) {
        const last = out[out.length - 1];
        if (last && last[1] === at) last[1] = at + len;
        else out.push([at, at + len]);
      }
      at += len;
    }
  }
  if (md.includes("`")) spanRanges(md, out);
  return out.sort((a, b) => a[0] - b[0]);
}

function inRanges(r: Ranges, i: number): boolean {
  for (const [s, e] of r) {
    if (i < s) return false;
    if (i < e) return true;
  }
  return false;
}

/** Inline code spans (CommonMark backtick-run matching, bounded by the paragraph). */
function spanRanges(md: string, out: Ranges): void {
  const blocks = out.slice();
  const re = /`+/g;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const start = m.index;
    if (inRanges(blocks, start)) continue;
    let bs = 0;
    for (let j = start - 1; j >= 0 && md[j] === "\\"; j--) bs++;
    if (bs % 2 === 1) continue;
    const run = m[0].length;
    const para = md.slice(start + run).search(/\n[ \t]*\n/);
    const limit = para < 0 ? md.length : start + run + para;
    const close = new RegExp(`(?<!\`)\`{${run}}(?!\`)`, "g");
    close.lastIndex = start + run;
    const c = close.exec(md);
    if (!c || c.index >= limit) continue;
    out.push([start, c.index + run]);
    re.lastIndex = c.index + run;
  }
}

/** True when `[s, e)` overlaps any range. */
export function overlaps(r: Ranges, s: number, e: number): boolean {
  for (const [a, b] of r) if (a < e && s < b) return true;
  return false;
}
