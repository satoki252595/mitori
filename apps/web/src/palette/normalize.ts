/**
 * ⌘K query forms (contract `ROMAJI_RULES` R1 note, ux.md §4.10, UXP-12):
 *  - `qRaw`    NFKC → lower → no whitespace; matched against label / alias / sub / subsequence (+ marks)
 *  - `qKana`   qRaw with katakana folded to hiragana; matched against `y` (yomi)
 *  - `qRomaji` only when the raw query is `/^[a-z'-]+$/`: ROMAJI_RULES applied; matched against the equally
 *              normalized `r` with a tolerated incomplete tail (`mochikosh` ⇒ prefix `motikos`)
 * Labels are never romaji-normalized.
 */
import { ROMAJI_RULES } from "../contract.ts";

/** Whitespace, plus `-` / `_` so `carry-forward` meets `carryForwardComments` and `chunk_size` meets `chunkSize`. */
const WS = /[\s\-_]+/gu;
const KATA_START = 0x30a1;
const KATA_END = 0x30f6;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\u30fc]/u;

export function rawForm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(WS, "");
}

export function toHiragana(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c >= KATA_START && c <= KATA_END ? String.fromCodePoint(c - 0x60) : ch;
  }
  return out;
}

export function hasKana(s: string): boolean {
  return KANA_RE.test(s);
}

export function romajiNorm(s: string): string {
  let out = s;
  for (const [from, to] of ROMAJI_RULES) out = out.split(from).join(to);
  return out;
}

/** Incomplete trailing romaji (`sh`, `ch`, `ts`, `s`, `c`, `t`, `j`, `f`, `n`) → the letter its syllables normalize to. */
const TAILS: readonly [string, string][] = [
  ["sh", "s"],
  ["ch", "t"],
  ["ts", "t"],
  ["s", "s"],
  ["c", "t"],
  ["t", "t"],
  ["j", "z"],
  ["f", "h"],
  ["n", "n"],
];
const VOWEL_END = /[aiueo'-]$/;

export interface QueryForms {
  raw: string;
  kana: string | null;
  romaji: string | null;
}

export function queryForms(q: string): QueryForms {
  const raw = rawForm(q);
  const kana = hasKana(raw) ? toHiragana(raw) : null;
  let romaji: string | null = null;
  if (/^[a-z'-]+$/.test(raw)) {
    romaji = romajiNorm(raw);
    if (!VOWEL_END.test(raw)) {
      for (const [tail, letter] of TAILS) {
        if (raw.endsWith(tail)) {
          romaji = romajiNorm(raw.slice(0, -tail.length)) + letter;
          break;
        }
      }
    }
  }
  return { raw, kana, romaji };
}

/**
 * Original-string ranges `[start, end)` (UTF-16) of a match at `[from, to)` in `rawForm(label)`; null when the
 * label cannot be mapped (should not happen for NFKC of BMP text).
 */
export function mapRawRange(label: string, from: number, to: number): [number, number] | null {
  let rawAt = 0;
  let start = -1;
  let i = 0;
  for (const ch of label) {
    const norm = ch.normalize("NFKC").toLowerCase().replace(WS, "");
    const next = rawAt + norm.length;
    if (start < 0 && next > from) start = i;
    if (start >= 0 && next >= to) return [start, i + ch.length];
    rawAt = next;
    i += ch.length;
  }
  return start >= 0 ? [start, label.length] : null;
}
