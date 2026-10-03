import { BUNDLE_LIMITS, VISIBLE_ESCAPE_RANGES } from "../contract.ts";

// Data-line construction (spec §4.1). Every line that carries repository, document or conversation text starts with
// `N|`, `|`, `> ` or `>`, so it can never match the tag-line pattern; the characters below are made visible so a
// line cannot hide its content (Trojan Source) or break the line structure.

// Built from the contract's ranges (not written as literal escapes: formatters rewrite those into raw bidi characters).
const hex = (n: number): string => `\\u{${n.toString(16)}}`;
const SUSPECT_CLASS = `[\\u{0}-\\u{8}\\u{b}-\\u{1f}\\u{7f}${VISIBLE_ESCAPE_RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("")}]`;
const SUSPECT = new RegExp(SUSPECT_CLASS, "u");
const SUSPECT_G = new RegExp(SUSPECT_CLASS, "gu");

const RANGES = VISIBLE_ESCAPE_RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("");
// Fields of tag lines (paths, symbol names, globs, ids) may not contain any line break or control character at all.
const FIELD_G = new RegExp(`[\\u{0}-\\u{1f}\\u{7f}\\u{2028}\\u{2029}${RANGES}]`, "gu");

/** Escape one character: bidi / zero-width ⇒ `\u{XXXX}`, other C0 controls (and DEL) ⇒ `\x{XX}`. */
function escapeChar(ch: string): string {
  const code = ch.codePointAt(0) as number;
  return code <= 0x7f ? `\\x{${code.toString(16).toUpperCase().padStart(2, "0")}}` : `\\u{${code.toString(16).toUpperCase()}}`;
}

/**
 * One text line, safe to put after a prefix: no CR, capped at `max` characters (default `LINE_MAX`; the rest becomes
 * `…[+N]`), suspicious characters visible. The human's ASK is passed uncapped: it is forwarded verbatim.
 */
export function safeLine(line: string, max: number = BUNDLE_LIMITS.lineMaxChars): string {
  let s = line.includes("\r") ? line.replaceAll("\r", "") : line;
  if (s.length > max) {
    let cut = max;
    const c = s.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut--; // do not split a surrogate pair
    s = `${s.slice(0, cut)}…[+${s.length - cut}]`;
  }
  return SUSPECT.test(s) ? s.replace(SUSPECT_G, escapeChar) : s;
}

/**
 * A value that goes into a tag line (a path, symbol name, glob, author label): every control character, line break
 * and bidi / zero-width character is made visible, so no value can start a line of its own (a file named
 * `a\nWRITE x` stays one token).
 */
export function field(value: string): string {
  return value.replace(FIELD_G, escapeChar);
}

/** Split text into lines (CRLF, LF and lone CR); a final newline adds no empty line. */
export function splitText(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/u);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `> text` / `>` quote lines of a (possibly multi-line) text. */
export function quote(text: string, max?: number): string[] {
  return splitText(text).map((l) => (l === "" ? ">" : `> ${safeLine(l, max)}`));
}

/** Quote lines with a label in front of the first line (`> R1 human: …`, `> ~prev: …`); continuation lines keep the plain prefix. */
export function quoteLabelled(label: string, text: string): string[] {
  const lines = splitText(text);
  if (lines.length === 0) return [`> ${label}`];
  return lines.map((l, i) => (i === 0 ? `> ${label}${safeLine(l)}` : l === "" ? ">" : `> ${safeLine(l)}`));
}

/** Code lines: `N|text` (numbered) or `|text`. The first line number is `firstNo`. */
export function codeLines(lines: readonly string[], firstNo: number, numbered: boolean): string[] {
  return lines.map((l, i) => `${numbered ? firstNo + i : ""}|${safeLine(l)}`);
}

/** Share of hiragana / katakana / kanji among the non-space characters. */
export function japaneseRatio(text: string): number {
  let ja = 0;
  let all = 0;
  for (const ch of text) {
    if (ch === " " || ch === "\n" || ch === "\t") continue;
    all++;
    const c = ch.codePointAt(0) as number;
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff)) ja++;
  }
  return all === 0 ? 0 : ja / all;
}

/** `usd=` value: at least two decimals, at most four, no trailing zeros beyond that. */
export function usdText(usd: number): string {
  const s = usd.toFixed(4).replace(/0+$/u, "");
  const [int, frac = ""] = s.split(".");
  return `${int}.${frac.padEnd(2, "0")}`;
}
