import { describe, expect, test } from "bun:test";
import type { BlockId, BlockView, SectionId, SectionView } from "@mitori/core";
import { buildTextIndex, entriesOf, nearTier, queryRuns, queryUnits, searchText, weighRuns } from "./fulltext.ts";

const block = (id: string, html: string, section = "s3", over: Partial<BlockView> = {}): BlockView =>
  ({ id: id as BlockId, section: section as SectionId, kind: "prose", status: "ready", html, ...over }) as BlockView;
const section = (id: string, blocks: BlockView[]): SectionView => ({ section: { id } as SectionView["section"], blocks, breadcrumbs: [] });

describe("NC-09 query units", () => {
  test("kanji / katakana runs become bigrams, particles and punctuation drop, Latin words stay whole", () => {
    // question words (方法・理由…) are how a question is phrased, not what it is about
    expect(queryUnits("起動方法は？")).toEqual(["起動"]);
    expect(queryUnits("起動順序")).toEqual(["起動", "動順", "順序"]);
    expect(queryUnits("npm を使う")).toEqual(["npm", "使"]);
    expect(queryUnits("セッションキー")).toEqual(["せっ", "っし", "しょ", "ょん", "んき", "きー"]);
    // nothing but hiragana: its bigrams are the units
    expect(queryUnits("どこから")).toEqual(["どこ", "こか", "から"]);
  });

  test("runs split at script changes: a long katakana word does not outweigh the kanji words beside it", () => {
    expect(queryRuns("認証トークンの失効")).toEqual([["認証"], ["とー", "ーく", "くん"], ["失効"]]);
  });
});

describe("NC-09 full-text search (app ⌘K and export)", () => {
  const ix = buildTextIndex([
    section("s0", [block("b_00000010", "<p>エディタ本体は <code>app/Editor.tsx</code> にある。</p>", "s0")]),
    section("s4", [
      block("b_00000041", "<p>まず <code>npm install</code> を実行し、<code>npm run dev</code> で起動する。</p>", "s4"),
      block("b_00000042", "<p>起動すると <code>http://localhost:3000</code> を開く。方法は README にもある。</p>", "s4"),
    ]),
    section("s6/lib", [block("b_00000061", "<p>トークンの方法と起動の順序を決める基盤層。</p>", "s6/lib")]),
  ]);

  test("a whole query that occurs is an exact hit, in reading order, with its marks", () => {
    const r = searchText(ix, "localhost", 5, nearTier);
    expect(r.total).toBe(1);
    const h = r.hits[0];
    expect(h?.tier).toBe("exact");
    expect(h?.entry.block).toBe("b_00000042");
    const [a, b] = h?.marks[0] ?? [0, 0];
    expect(h?.label.slice(a, b)).toBe("localhost");
  });

  test("several words: every word must occur (any order)", () => {
    const r = searchText(ix, "dev npm", 5, nearTier);
    expect(r.hits.map((x) => x.entry.block)).toEqual(["b_00000041"]);
    expect(r.hits[0]?.tier).toBe("exact");
    expect(r.hits[0]?.marks.length).toBeGreaterThanOrEqual(2);
  });

  test("a natural question finds the blocks carrying most of its weight (near tier), best share first", () => {
    const r = searchText(ix, "起動順序の基盤は？", 5, nearTier);
    // 起動 · 順序 · 基盤 all occur only in b_61; b_41 / b_42 say 起動 alone, the commonest word
    expect(r.hits.map((x) => x.entry.block)).toEqual(["b_00000061"]);
    expect(r.hits[0]?.tier).toBe("near");
    const h = r.hits[0];
    const marked = (h?.marks ?? []).map(([a, b]) => h?.label.slice(a, b));
    expect(marked).toContain("起動");
    expect(marked).toContain("基盤");
  });

  test("a question left with one content word finds the blocks that say it (「起動方法は？」 → 起動)", () => {
    const r = searchText(ix, "起動方法は？", 5, nearTier);
    expect(r.hits.map((x) => x.entry.block)).toEqual(["b_00000041", "b_00000042", "b_00000061"]);
    expect(r.hits.every((x) => x.tier === "near")).toBe(true);
  });

  test("idf: a compound's boundary bigram (動順) is dropped; a rarer word weighs more", () => {
    const w = weighRuns(ix, queryRuns("起動順序"));
    expect(w[0]?.units.map((u) => u.unit)).toEqual(["起動", "順序"]);
    // 起動 is in 3 of 4 blocks, 順序 in 1: 順序 tells more
    expect((w[0]?.units[1]?.w ?? 0) > (w[0]?.units[0]?.w ?? 0)).toBe(true);
  });

  test("katakana and hiragana meet (セッション = せっしょん); width and case do not matter", () => {
    const ix2 = buildTextIndex([section("s3", [block("b_00000001", "<p>セッションキーは SHA-256 で計算する</p>")])]);
    expect(searchText(ix2, "せっしょん", 3, nearTier).total).toBe(1);
    expect(searchText(ix2, "ｓｈａ２５６", 3, nearTier).total).toBe(1);
  });

  test("exact hits come before near hits; `max` caps the rows, `total` counts all", () => {
    const r = searchText(ix, "起動", 1, nearTier);
    expect(r.hits.length).toBe(1);
    expect(r.total).toBe(3);
    expect(r.hits[0]?.entry.block).toBe("b_00000041");
  });

  test("headings and placeholders are not indexed; reading order continues across sections", () => {
    const e = entriesOf(
      {
        blocks: [
          block("b_00000001", "<h2>見出し</h2>", "s3", { kind: "heading" }),
          block("b_00000002", "<p>未生成</p>", "s3", { status: "placeholder" }),
          block("b_00000003", "<p>本文</p>"),
        ],
      },
      10,
    );
    expect(e.map((x) => [x.block, x.order])).toEqual([["b_00000003", 13]]);
  });

  test("an unrelated question has no hit (the palette then offers 「AI に聞く」)", () => {
    expect(searchText(ix, "認証トークンの失効", 5, nearTier).total).toBe(0);
  });

  test("without a near tier (the export viewer) only the exact tier answers", () => {
    expect(searchText(ix, "起動順序の基盤は？", 5).total).toBe(0);
    expect(searchText(ix, "起動方法は？", 5).total).toBe(0);
    const r = searchText(ix, "起動", 5);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((x) => x.tier === "exact")).toBe(true);
    expect(r).toEqual(searchText(ix, "起動", 5, nearTier));
  });
});
