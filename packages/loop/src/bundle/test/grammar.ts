import { BUNDLE_ORDER, BUNDLE_TAG_LINE_RE } from "../../contract.ts";

/** A bundle cut at its fence: lines before, inside and after the DATA block. */
export interface Parsed {
  top: string[];
  data: string[];
  tail: string[];
  nonce: string;
}

const DATA_LINE = /^(?:\d*\||>)/u;

export function parse(text: string): Parsed {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const open = lines.findIndex((l) => l.startsWith("<<<DATA "));
  const nonce = (/^<<<DATA (\w{8})>>>$/.exec(lines[open] ?? "") ?? [])[1] as string;
  const close = lines.indexOf(`<<<END ${nonce}>>>`);
  return { top: lines.slice(0, open), data: lines.slice(open + 1, close), tail: lines.slice(close + 1), nonce };
}

/**
 * Structural checks of MBF/1 (spec §4.1): header first, fence once, every data line is a data line or a mitori tag
 * line, no data line can read as a tag, the tail ends with `END`, tags appear in `BUNDLE_ORDER` (per thread block).
 */
export function checkGrammar(text: string): Parsed {
  const p = parse(text);
  const all = text.split("\n");
  if (!/^(?:You are helping[^\n]*\n)?MBF\/1 mode=\w+ out=\S+ lang=(?:ja|en)\n/u.test(text)) throw new Error(`bad header: ${all[0]}`);
  if (all.filter((l) => l.startsWith("<<<")).length !== 2) throw new Error("fence lines must be exactly two");
  if (p.tail[p.tail.length - 1] !== "END") throw new Error("must end with END");
  for (const l of p.data) {
    if (DATA_LINE.test(l)) {
      if (BUNDLE_TAG_LINE_RE.test(l)) throw new Error(`data line reads as a tag: ${l}`);
      continue;
    }
    if (!BUNDLE_TAG_LINE_RE.test(l)) throw new Error(`neither data nor tag line inside the fence: ${JSON.stringify(l)}`);
  }
  for (const l of p.tail) {
    if (l.startsWith("> ") || l === ">" || l.startsWith("- ")) continue;
    if (!BUNDLE_TAG_LINE_RE.test(l)) throw new Error(`bad line after the fence: ${JSON.stringify(l)}`);
  }
  // single-thread order of tags
  const tags = [...p.top, ...p.data, ...p.tail].map((l) => /^(MBF\/1|[A-Z]{2,8})(?: |$)/u.exec(l)?.[1]).filter((t): t is string => t !== undefined);
  const rank = tags.map((t) => (BUNDLE_ORDER as readonly string[]).indexOf(t));
  if (rank.includes(-1)) throw new Error(`unknown tag in ${tags.join(" ")}`);
  const threads = tags.filter((t) => t === "TASK").length;
  if (threads <= 1) {
    for (let i = 1; i < rank.length; i++) if ((rank[i] as number) < (rank[i - 1] as number)) throw new Error(`tag order violated: ${tags.join(" ")}`);
  }
  return p;
}

/** Tag lines of a bundle in order of appearance (first word). */
export function tagsOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => /^(MBF\/1|[A-Z]{2,8})(?: |$)/u.exec(l)?.[1])
    .filter((t): t is string => t !== undefined);
}
