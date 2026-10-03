import { describe, expect, test } from "bun:test";
import type { BlockId, BlockView, SectionView } from "@mitori/core";
import { buildTextIndex, htmlText, searchText } from "./textsearch.ts";

const block = (id: string, html: string, over: Partial<BlockView> = {}): BlockView =>
  ({ id: id as BlockId, section: "s3", kind: "prose", status: "ready", html, ...over }) as BlockView;
const section = (id: string, blocks: BlockView[]): SectionView => ({ section: { id } as SectionView["section"], blocks, breadcrumbs: [] });

describe("EXP-U-02 htmlText", () => {
  test("tags, cite chips and svg go; entities decode; whitespace collapses", () => {
    const html =
      '<div class="mb"><p>キーは <code>a&lt;b</code> を使う<span class="mc"> ので</span><a class="mcite" data-cite="x.go:1-2"><span class="cs">x.go:1</span><span class="cl">x.go:1-2</span></a>。</p><svg><text>図の文字</text></svg><ul><li>一</li><li>二</li></ul></div>';
    expect(htmlText(html)).toBe("キーは a<b を使う ので 。 一 二");
  });
});

describe("EXP-U-03 text search", () => {
  const ix = buildTextIndex([
    section("s3", [
      block("b_00000001", "<p>セッションキーは SHA-256 で計算する</p>"),
      block("b_00000002", "<h2>見出し セッション</h2>", { kind: "heading" }),
      block("b_00000003", "<p>未生成</p>", { status: "placeholder" }),
      block("b_00000004", "<p>デーモンは準備が整うまで 503 を返す。セッションに依存する API は待つ</p>"),
    ]),
  ]);
  test("headings and placeholders are not in the index", () => {
    expect(ix.map((e) => e.block)).toEqual(["b_00000001", "b_00000004"]);
  });
  test("matches ignore width, case, spaces and hyphens; the snippet carries the mark", () => {
    const r = searchText(ix, "ｓｈａ256", 5);
    expect(r.total).toBe(1);
    const h = r.hits[0];
    expect(h?.entry.block).toBe("b_00000001");
    const [a, b] = h?.marks[0] ?? [0, 0];
    expect(h?.label.slice(a, b)).toBe("SHA-256");
  });
  test("counts every matching block, lists at most `max`", () => {
    const r = searchText(ix, "セッション", 1);
    expect(r.total).toBe(2);
    expect(r.hits.length).toBe(1);
  });
  test("a one-letter Latin query is too short; one CJK character is allowed", () => {
    expect(searchText(ix, "a", 5).total).toBe(0);
    expect(searchText(ix, "計", 5).total).toBe(1);
  });
  test("long text is cut around the match with ellipses", () => {
    const long = buildTextIndex([section("s3", [block("b_00000009", `<p>${"あ".repeat(80)}目印${"い".repeat(120)}</p>`)])]);
    const h = searchText(long, "目印", 1).hits[0];
    expect(h?.label.startsWith("…")).toBe(true);
    expect(h?.label.endsWith("…")).toBe(true);
    const [a, b] = h?.marks[0] ?? [0, 0];
    expect(h?.label.slice(a, b)).toBe("目印");
  });
});
