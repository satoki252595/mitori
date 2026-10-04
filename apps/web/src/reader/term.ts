/**
 * The term card's second line (NC-18 / ux.md §4.3.7): what helps a reader say and place the word — never the
 * search aids. The romaji is for ⌘K only (「puronputo」 says nothing); a reading is shown only for a term written in
 * kanji (「あいてむ」 for `Item` is noise); the English name only when it is not the term itself; an identifier
 * gets the place it is defined (`lib/tokens.ts`) instead of a reading. Pure.
 */
import type { GlossaryEntry } from "@mitori/core";

const HAN = /\p{Script=Han}/u;
const LATIN_ONLY = /^[\p{Script=Latin}\d\s_.:#$/-]+$/u;

export interface TermLine {
  yomi?: string;
  en?: string;
  /** Defining file of the related symbol (identifiers). */
  where?: string;
}

export function termLine(e: Pick<GlossaryEntry, "term" | "yomi" | "en" | "symbol">): TermLine {
  const out: TermLine = {};
  const term = e.term.trim();
  if (e.yomi && HAN.test(term) && e.yomi !== term) out.yomi = e.yomi;
  const latin = LATIN_ONLY.test(term);
  if (e.en && !latin && e.en.trim().toLowerCase() !== term.toLowerCase()) out.en = e.en;
  if (e.symbol && latin) {
    const path = e.symbol.split("#")[0];
    if (path) out.where = path;
  }
  return out;
}
