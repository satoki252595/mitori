/**
 * Full-text search over the exported document (⌘K, 「本文」 group). The palette index covers sections, terms, rooms,
 * cited files and symbols; this covers what the blocks SAY. Built lazily on the first query (a doc of 1,500 blocks
 * ≈ 3 ms), matched with the palette's own normalization (NFKC, lower case, no spaces / `-` / `_`), so full-width,
 * katakana-width and spacing differences never hide a hit. Pure.
 */
import type { BlockId, SectionId, SectionView } from "@mitori/core";
import { mapRawRange, rawForm } from "../palette/normalize.ts";

export interface TextEntry {
  section: SectionId;
  block: BlockId;
  text: string;
  raw: string;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Visible text of a block's HTML: tags and cite chips dropped, entities decoded, whitespace collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<a [^>]*class="(?:mcite|fcite)"[^>]*>[\s\S]*?<\/a>/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<\/(?:p|li|tr|h[1-6]|div|figcaption|pre)>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

export function buildTextIndex(sections: readonly SectionView[]): TextEntry[] {
  const out: TextEntry[] = [];
  for (const s of sections)
    for (const b of s.blocks) {
      if (b.kind === "heading" || b.status === "placeholder") continue;
      const text = htmlText(b.html);
      if (text !== "") out.push({ section: s.section.id, block: b.id, text, raw: rawForm(text) });
    }
  return out;
}

export interface TextHit {
  entry: TextEntry;
  /** Snippet around the first match, with the match ranges for `<mark>`. */
  label: string;
  marks: [number, number][];
}

/** Snippet window: a little before the match, more after. */
const BEFORE = 24;
const AFTER = 72;

export function searchText(ix: readonly TextEntry[], query: string, max: number): { hits: TextHit[]; total: number } {
  const q = rawForm(query);
  if (q.length < 2 && !/\P{ASCII}/u.test(q)) return { hits: [], total: 0 };
  if (q === "") return { hits: [], total: 0 };
  const hits: TextHit[] = [];
  let total = 0;
  for (const e of ix) {
    const at = e.raw.indexOf(q);
    if (at < 0) continue;
    total++;
    if (hits.length >= max) continue;
    const r = mapRawRange(e.text, at, at + q.length);
    if (!r) continue;
    const w0 = Math.max(0, r[0] - BEFORE);
    const w1 = Math.min(e.text.length, r[1] + AFTER);
    const lead = w0 > 0 ? "…" : "";
    const label = `${lead}${e.text.slice(w0, w1)}${w1 < e.text.length ? "…" : ""}`;
    hits.push({ entry: e, label, marks: [[r[0] - w0 + lead.length, r[1] - w0 + lead.length]] });
  }
  return { hits, total };
}
