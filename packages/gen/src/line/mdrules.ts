/** Markdown rules of a block line's `md` (gen spec §6.3 V11, V12, V13, V27). Pure; code spans/fences are exempt. */
import type { GenRuleId } from "../contract.ts";
import { codeRanges, fencedLines, inRanges, type Ranges } from "./mdscan.ts";

/** One rule violation found in md. */
export interface MdProblem {
  /** Rule. */
  rule: GenRuleId;
  /** What was found (short excerpt). */
  found: string;
}

const LINK_TOKENS = ["](", "!["];
const AUTOLINK_RE = /^<(?:https?:|mailto:|ftp:|www\.)/i;

/** V11 raw HTML, V13 links / images / autolinks / ID comments — first hit of each rule. */
export function inlineProblems(md: string, ranges: Ranges = codeRanges(md)): MdProblem[] {
  const out: MdProblem[] = [];
  let html = false;
  let link = false;
  for (let i = 0; i < md.length; i++) {
    if (inRanges(ranges, i)) continue;
    const c = md[i];
    if (!link) {
      const two = md.slice(i, i + 2);
      const rest = md.slice(i);
      if (LINK_TOKENS.includes(two) || rest.startsWith("<!--") || AUTOLINK_RE.test(rest)) {
        out.push({ rule: "V13", found: excerpt(md, i) });
        link = true;
        continue;
      }
    }
    if (!html && c === "<" && /[A-Za-z/!?]/.test(md[i + 1] ?? "") && !md.startsWith("<!--", i) && !AUTOLINK_RE.test(md.slice(i))) {
      out.push({ rule: "V11", found: excerpt(md, i) });
      html = true;
    }
  }
  return out;
}

const ATX_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_RE = /^ {0,3}(?:=+|-{2,})[ \t]*$/;
const LIST_OR_TABLE_RE = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t]|\|)/;

/** V12: ATX headings and setext underlines (outside fences). */
export function headingProblem(md: string): MdProblem | null {
  const fenced = fencedLines(md);
  let prev = "";
  for (const [k, line] of md.split("\n").entries()) {
    if (fenced[k]) {
      prev = "";
      continue;
    }
    if (ATX_RE.test(line)) return { rule: "V12", found: line.slice(0, 40) };
    if (SETEXT_RE.test(line) && prev.trim() !== "" && !LIST_OR_TABLE_RE.test(prev)) return { rule: "V12", found: `${prev.slice(0, 30)} / ${line.trim()}` };
    prev = line;
  }
  return null;
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** V27: kind `table` must start with a GFM header row + delimiter row. */
export function isGfmTable(md: string): boolean {
  const [head, sep] = md.split("\n");
  if (head === undefined || sep === undefined) return false;
  return head.includes("|") && TABLE_SEP_RE.test(sep) && (sep.includes("|") || head.trim().startsWith("|"));
}

/** Number of user-perceived characters (code points) of md without claim markers (V10 length). */
export function mdLength(md: string): number {
  let n = 0;
  for (const _ of md.replace(/\[\[[1-9][0-9]?\]\]/g, "")) n++;
  return n;
}

function excerpt(md: string, i: number): string {
  return md.slice(Math.max(0, i - 8), i + 24);
}
