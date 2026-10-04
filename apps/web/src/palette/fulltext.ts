/**
 * Full-text search over what the blocks SAY (NC-09; ⌘K 「本文」 group in the app and in the export viewer). Pure.
 *
 * The palette index covers sections, terms, rooms and symbols; this covers the prose. Entries are built from the
 * blocks' server HTML (tags and cite chips dropped), matched with the palette's normalization plus katakana folding
 * (NFKC, lower case, no spaces / `-` / `_`, カタカナ → ひらがな), so width, case, spacing and kana differences never
 * hide a hit. Two tiers:
 *  1. exact — the whole query is a substring (any number of words when they all occur: `npm dev`);
 *  2. near — a natural-language question (「起動方法は？」, 「どこで読まれる」): the query's content units (kanji /
 *     katakana bigrams, Latin words ≥ 2 letters, digits; particles and punctuation dropped) are looked up in the
 *     block, each weighted by its rarity in the document (idf: a word every block says tells nothing). A block
 *     holding ≥ 50 % of the query's weight is a hit, ranked by that share. A bigram that occurs nowhere but whose
 *     neighbours both do (起動|動方|方法) is a word-boundary artifact of a compound and is not counted.
 * Ranking ties go to reading order (the earlier chapters are the newcomer's), so §0–§5 come before module pages.
 * The near tier is passed in ({@link nearTier}): the app's palette uses it; the export viewer's search stays exact
 * (its script has a 60 KB gz budget, and the tier's tables and scoring are ≈ 1.3 KB of it — tree-shaken there).
 */
import type { BlockId, SectionId, SectionView } from "@mitori/core";
import { mapRawRange, rawForm, toHiragana } from "./normalize.ts";

export interface TextEntry {
  section: SectionId;
  block: BlockId;
  /** Visible text. */
  text: string;
  /** `rawForm` + kana folding of `text` (same length as `rawForm(text)`, BMP). */
  raw: string;
  /** Reading order of the block in the whole document (ties). */
  order: number;
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

export const foldForm = (s: string): string => toHiragana(rawForm(s));

/** Entries of one section's blocks (headings and placeholders carry nothing to find). `order0` = the first block's order. */
export function entriesOf(view: Pick<SectionView, "blocks">, order0 = 0): TextEntry[] {
  const out: TextEntry[] = [];
  let i = order0;
  for (const b of view.blocks) {
    i++;
    if (b.kind === "heading" || b.status === "placeholder") continue;
    const text = htmlText(b.html);
    if (text !== "") out.push({ section: b.section, block: b.id, text, raw: foldForm(text), order: i });
  }
  return out;
}

/** Index of several sections in the given (reading) order. */
export function buildTextIndex(sections: readonly SectionView[]): TextEntry[] {
  const out: TextEntry[] = [];
  let order = 0;
  for (const s of sections) {
    const e = entriesOf(s, order);
    out.push(...e);
    order += s.blocks.length;
  }
  return out;
}

export interface TextHit {
  entry: TextEntry;
  /** Snippet around the first match, with the match ranges for `<mark>`. */
  label: string;
  marks: [number, number][];
  /** `exact` = the query (or each of its words) occurs; `near` = most of its content units do. */
  tier: "exact" | "near";
  /** Share of the query's units found (1 for exact). */
  coverage: number;
}

const BEFORE = 24;
const AFTER = 72;
// Han + 々 〆 ヶ (iteration / abbreviation marks)
const HAN = /[\p{Script=Han}\u3005\u3006\u30f6]/u;
const KATA = /[\p{Script=Katakana}ー]/u;
const HIRA = /\p{Script=Hiragana}/u;
const ALNUM = /[a-z0-9]/;

/**
 * Words a question is phrased with but a design document hardly says (「起動方法は？」 asks about 起動): stripped from
 * the ends of a kanji run, or dropped when they are the whole run. Longest first.
 */
// 仕組 方法 仕方 場所 箇所 意味 理由 目的 内容 部分 説明 何 (escaped: matcher data, not UI text — lint §9.5-2)
const QUESTION_WORDS =
  "\u4ed5\u7d44 \u65b9\u6cd5 \u4ed5\u65b9 \u5834\u6240 \u7b87\u6240 \u610f\u5473 \u7406\u7531 \u76ee\u7684 \u5185\u5bb9 \u90e8\u5206 \u8aac\u660e \u4f55".split(
    " ",
  );

/** A kanji run without the question words at its ends (null when nothing is left). */
function stripQuestion(run: string): string | null {
  let r = run;
  for (let changed = true; changed && r.length > 0; ) {
    changed = false;
    for (const w of QUESTION_WORDS) {
      if (r === w) return null;
      if (r.endsWith(w) && r.length - w.length >= 2) {
        r = r.slice(0, -w.length);
        changed = true;
      } else if (r.startsWith(w) && r.length - w.length >= 2) {
        r = r.slice(w.length);
        changed = true;
      }
    }
  }
  return r.length > 0 ? r : null;
}

/**
 * Content units of a query, per run: kanji runs and katakana runs (folded to hiragana) become bigrams (a
 * 1-character run stays one unit), Latin / digit runs ≥ 2 stay whole. Hiragana-only runs (particles,
 * okurigana), question words (方法・理由…) and punctuation are dropped — unless the query is nothing but hiragana,
 * then its bigrams are the units. A run is a word-ish piece: a long katakana word must not outweigh the kanji words
 * next to it.
 */
export function queryRuns(query: string): string[][] {
  const src = query.normalize("NFKC").toLowerCase();
  const runs: string[][] = [];
  let run = "";
  let kind: "han" | "kata" | "alnum" | null = null;
  const flush = () => {
    const units: string[] = [];
    const piece = kind === "han" ? stripQuestion(run) : run;
    if ((kind === "han" || kind === "kata") && piece) {
      const f = toHiragana(piece);
      if (f.length === 1) units.push(f);
      for (let i = 0; i + 2 <= f.length; i++) units.push(f.slice(i, i + 2));
    } else if (kind === "alnum" && run.length >= 2) units.push(run);
    if (units.length) runs.push([...new Set(units)]);
    run = "";
    kind = null;
  };
  for (const ch of src) {
    const k = HAN.test(ch) ? "han" : KATA.test(ch) ? "kata" : ALNUM.test(ch) ? "alnum" : null;
    if (k !== kind) flush();
    if (k) {
      kind = k;
      run += ch;
    }
  }
  flush();
  if (runs.length === 0) {
    const hira = [...src].filter((c) => HIRA.test(c)).join("");
    const units: string[] = [];
    for (let i = 0; i + 2 <= hira.length; i++) units.push(hira.slice(i, i + 2));
    if (units.length) runs.push([...new Set(units)]);
  }
  return runs;
}

/** Every content unit of a query (flattened {@link queryRuns}). */
export function queryUnits(query: string): string[] {
  return [...new Set(queryRuns(query).flat())];
}

/** Minimum share of the query's (idf-weighted) units a near hit must contain. */
export const NEAR_MIN_COVERAGE = 0.5;

/**
 * The weighted units of a query against an index, per run: idf `log(1 + N / (1 + df))` per unit; a bigram that
 * occurs in no block while its neighbours in the same run both do is dropped (the 動方 of 起動方法). Units nobody
 * has keep their weight: asking about something the document does not say is not a match for the rest of the
 * question. A run weighs its units' mean idf, so a long katakana word does not outweigh the words beside it.
 */
export function weighRuns(ix: readonly TextEntry[], runs: readonly (readonly string[])[]): { units: { unit: string; w: number }[]; w: number }[] {
  const df = new Map<string, number>();
  for (const r of runs)
    for (const u of r)
      if (!df.has(u))
        df.set(
          u,
          ix.reduce((n, e) => n + (e.raw.includes(u) ? 1 : 0), 0),
        );
  const out: { units: { unit: string; w: number }[]; w: number }[] = [];
  for (const r of runs) {
    const units: { unit: string; w: number }[] = [];
    r.forEach((u, i) => {
      const d = df.get(u) ?? 0;
      if (d === 0 && i > 0 && i < r.length - 1 && (df.get(r[i - 1] as string) ?? 0) > 0 && (df.get(r[i + 1] as string) ?? 0) > 0) return;
      units.push({ unit: u, w: Math.log(1 + ix.length / (1 + d)) });
    });
    if (units.length) out.push({ units, w: units.reduce((n, x) => n + x.w, 0) / units.length });
  }
  return out;
}

function snippet(e: TextEntry, ranges: [number, number][]): { label: string; marks: [number, number][] } {
  // ranges are in raw-form coordinates; map them to the original text
  const orig = ranges.map(([a, b]) => mapRawRange(e.text, a, b)).filter((r): r is [number, number] => r !== null);
  orig.sort((x, y) => x[0] - y[0]);
  const first = orig[0] ?? [0, 0];
  const w0 = Math.max(0, first[0] - BEFORE);
  const w1 = Math.min(e.text.length, first[1] + AFTER);
  const lead = w0 > 0 ? "…" : "";
  const label = `${lead}${e.text.slice(w0, w1)}${w1 < e.text.length ? "…" : ""}`;
  const marks: [number, number][] = [];
  for (const [a, b] of orig) {
    if (a < w0 || b > w1) continue;
    const m: [number, number] = [a - w0 + lead.length, b - w0 + lead.length];
    const last = marks[marks.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else marks.push(m);
  }
  return { label, marks };
}

/** All occurrences of `needle` in `hay` (non-overlapping), at most `cap`. */
function occurrences(hay: string, needle: string, cap = 6): [number, number][] {
  const out: [number, number][] = [];
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < cap) {
    out.push([at, at + needle.length]);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

/** What of a query one block holds (null: not a near hit). */
export type NearMatch = (e: TextEntry) => { found: string[]; coverage: number } | null;
/** A near tier: the matcher for one query over one index (null: the query has no near tier). */
export type NearTier = (ix: readonly TextEntry[], query: string, folded: string) => NearMatch | null;

/** The near tier of the app's ⌘K (NC-09): the weighted content units of a natural-language question. */
export const nearTier: NearTier = (ix, query, folded) => {
  const runs = queryRuns(query);
  const wr = runs.length > 0 ? weighRuns(ix, runs) : [];
  const total = wr.reduce((n, r) => n + r.w, 0);
  // a near match needs a question of ≥ 2 content units (one word is the exact tier's job)
  const nUnits = wr.reduce((n, r) => n + r.units.length, 0);
  if (nUnits >= 2 && total > 0)
    return (e) => {
      let got = 0;
      const found: string[] = [];
      for (const r of wr) {
        let rg = 0;
        let rt = 0;
        for (const u of r.units) {
          rt += u.w;
          if (e.raw.includes(u.unit)) {
            rg += u.w;
            found.push(u.unit);
          }
        }
        got += r.w * (rt > 0 ? rg / rt : 0);
      }
      const coverage = got / total;
      // a hit needs ≥ 2 characters of matched text (one kanji alone is everywhere)
      return coverage >= NEAR_MIN_COVERAGE && found.join("").length >= 2 ? { found, coverage } : null;
    };
  // a question with one content word left (「起動方法は？」 → 起動): the blocks that say it
  const single = nUnits === 1 && (wr[0]?.units[0]?.unit.length ?? 0) >= 2 ? (wr[0]?.units[0]?.unit as string) : null;
  return single && single !== folded ? (e) => (e.raw.includes(single) ? { found: [single], coverage: 1 } : null) : null;
};

/**
 * Search `ix` for `query`. Exact hits first (reading order), then — with a `near` tier — near hits (coverage, then
 * reading order); `max` rows at most, `total` counts every hit. A one-letter Latin query is too short (one CJK
 * character is not).
 */
export function searchText(ix: readonly TextEntry[], query: string, max: number, near: NearTier | null = null): { hits: TextHit[]; total: number } {
  const q = foldForm(query);
  if (q === "" || (q.length < 2 && !/\P{ASCII}/u.test(q))) return { hits: [], total: 0 };
  const words = query
    .split(/\s+/)
    .map(foldForm)
    .filter((w) => w.length > 0);
  const match = near?.(ix, query, q) ?? null;
  const exact: TextHit[] = [];
  const nears: { e: TextEntry; found: string[]; coverage: number }[] = [];
  let exactTotal = 0;
  for (const e of ix) {
    const at = e.raw.indexOf(q);
    if (at >= 0 || (words.length > 1 && words.every((w) => e.raw.includes(w)))) {
      exactTotal++;
      if (exact.length < max) {
        const ranges = at >= 0 ? occurrences(e.raw, q) : words.flatMap((w) => occurrences(e.raw, w, 2));
        exact.push({ entry: e, ...snippet(e, ranges), tier: "exact", coverage: 1 });
      }
      continue;
    }
    const m = match?.(e);
    if (m) nears.push({ e, ...m });
  }
  nears.sort((a, b) => b.coverage - a.coverage || a.e.order - b.e.order);
  const hits = exact.slice(0, max);
  for (const n of nears) {
    if (hits.length >= max) break;
    hits.push({
      entry: n.e,
      ...snippet(
        n.e,
        n.found.flatMap((u) => occurrences(n.e.raw, u, 2)),
      ),
      tier: "near",
      coverage: n.coverage,
    });
  }
  return { hits, total: exactTotal + nears.length };
}
