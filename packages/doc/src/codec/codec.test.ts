import { describe, expect, test } from "bun:test";
import type { Block, BlockId, BlockKind, Cite } from "@mitori/core";
import { BLOCK_ID_PLACEMENT, type CodecContext } from "../contract.ts";
import { hasher } from "../test/helpers.ts";
import { closeOpenFence } from "./blocks.ts";
import { deriveClaimSpans, fromMarkerForm, merge3, parseDocFile, semanticHash, serializeDocFile, toMarkerForm, yomiToRomaji } from "./index.ts";
import { parseDoc, reinterpret } from "./parse.ts";

const ctx: CodecContext = { lang: "ja", docFile: "doc/modules/internal-session.md", docDirAbs: "/r/.mitori", rootAbs: "/r" };
const en: CodecContext = { ...ctx, lang: "en" };
const blk = (id: string, kind: BlockKind, md: string) => ({ id: id as BlockId, kind, md }) as Block;
const cite = (path: string, start: number, end: number): Cite => ({ path, start, end, blob: "0".repeat(40), snippet: "0".repeat(16), precision: "exact" });

describe("DOC-G-002 ID placement per kind (O8 byte rules)", () => {
  const samples: Record<BlockKind, string> = {
    heading: "## 責務",
    prose: "一文目。\n二行目。",
    list: "- a\n- b",
    table: "| a | b |\n|---|---|\n| 1 | 2 |",
    diagram: '読み込みの流れ\n\n```mermaid\nflowchart LR\n  a["A"] --> b["B"]\n```',
    code: "```ts\nconst x = 1;\n```",
    facts: "- ファイル 5 · 1240 行",
    learn: "- 保存と取り出し\n- 期限切れ",
    recap: "要点は 2 つ。",
    pitfall: "並行に書くと壊れる。",
    deepdive: "詳しくは次の通り。\n\n二段落目。",
    why: "**なぜ 1 回だけか**\n待たせないため。",
    question: "再試行回数は設定可能にすべきか。",
    faq: "Q. 何をする？",
    placeholder: "この節はまだ生成されていません。",
  };
  test("every kind round-trips and puts the comment where BLOCK_ID_PLACEMENT says", () => {
    for (const [kind, md] of Object.entries(samples) as [BlockKind, string][]) {
      const text = serializeDocFile([blk("b_0000000a", "heading", "# 1. 題"), blk("b_0000000b", kind, md)], ctx);
      const last = text.trimEnd().split("\n");
      const tail = last[last.length - 1] as string;
      if (BLOCK_ID_PLACEMENT[kind] === "own_line") expect(tail).toBe("<!-- b_0000000b -->");
      else expect(tail.endsWith(" <!-- b_0000000b -->") && tail !== "<!-- b_0000000b -->").toBe(true);
      const parsed = parseDocFile(text, ctx.docFile, ctx).blocks[1];
      expect(parsed?.id).toBe("b_0000000b" as BlockId);
      const back = reinterpret(parsed?.md ?? "", parsed?.kindHint ?? "prose", kind, "ja");
      expect(back).toBe(md);
    }
  });
  test("alert wrapper bytes (§10.2): learn", () => {
    expect(serializeDocFile([blk("b_0000000a", "learn", "- 一\n\n- 二")], ctx)).toBe(
      "> [!NOTE]\n> **この章で分かること**\n> - 一\n>\n> - 二 <!-- b_0000000a -->\n",
    );
    expect(serializeDocFile([blk("b_0000000a", "recap", "x")], en)).toBe("> [!TIP]\n> **Recap**\n> x <!-- b_0000000a -->\n");
  });
  test("blocks are separated by exactly one blank line and the file ends with one LF", () => {
    expect(serializeDocFile([blk("b_0000000a", "prose", "a  "), blk("b_0000000b", "prose", "b")], ctx)).toBe(
      "a <!-- b_0000000a -->\n\nb <!-- b_0000000b -->\n",
    );
  });
  test("a trailing kind whose last line is a closing fence gets an own-line comment", () => {
    const text = serializeDocFile([blk("b_0000000a", "prose", "例:\n\n```sh\nls\n```")], ctx);
    expect(text).toBe("例:\n\n```sh\nls\n```\n<!-- b_0000000a -->\n");
    // with the sidecar kind the store reads it back as ONE prose block; without it the shape says code + a lead
    const known = parseDoc(text, "f.md", ctx, (id) => (id === "b_0000000a" ? "prose" : undefined));
    expect(known.blocks.map((b) => [b.id, b.kindHint, b.md])).toEqual([["b_0000000a", "prose", "例:\n\n```sh\nls\n```"]] as never);
    expect(parseDocFile(text, "f.md", ctx).blocks.map((b) => b.kindHint)).toEqual(["prose", "code"]);
  });
  test("closeOpenFence closes a top-level fence left open at the end; other text is unchanged", () => {
    expect(closeOpenFence("例:\n\n```ts\nconst x = 1;")).toBe("例:\n\n```ts\nconst x = 1;\n```");
    expect(closeOpenFence("~~~~sh\nls")).toBe("~~~~sh\nls\n~~~~");
    // inside a list item the next unindented line (the own-line ID comment) ends the item and the fence with it
    expect(closeOpenFence("- 手順:\n\n  ~~~~sh\n  ls")).toBe("- 手順:\n\n  ~~~~sh\n  ls");
    expect(closeOpenFence("```ts\nx\n```")).toBe("```ts\nx\n```");
    expect(closeOpenFence("`a` と ``` だけ")).toBe("`a` と ``` だけ");
  });
});

describe("DOC-U-004 ID comments", () => {
  test("ids outside the alphabet are text; duplicates are reported and the second gets null", () => {
    const p = parseDocFile("a <!-- b_ILOU1234 -->\n\nb <!-- b_aaaaaaaa -->\n\nc <!-- b_aaaaaaaa -->\n", "f.md", ctx);
    expect(p.blocks.map((b) => b.id)).toEqual(["b_aaaaaaaa", null] as never);
    expect(p.blocks[0]?.md).toBe("a <!-- b_ILOU1234 -->\n\nb");
    expect(p.duplicates).toEqual(["b_aaaaaaaa"]);
    expect(p.problems[0]?.code).toBe("E_DOC_ID_COLLISION");
  });
  test("ID-like comments inside fences and code spans are not delimiters", () => {
    const p = parseDocFile("```md\n段落 <!-- b_3k9m2q7a -->\n```\n<!-- b_aaaaaaaa -->\n\n`x <!-- b_bbbbbbbb -->` y <!-- b_cccccccc -->\n", "f.md", ctx);
    expect(p.blocks.map((b) => b.id)).toEqual(["b_aaaaaaaa", "b_cccccccc"] as never);
  });
  test("text a human put before a wrapped block becomes its own block (§10.4-4)", () => {
    const p = parseDocFile("新しい段落。\n\n## 見出し <!-- b_aaaaaaaa -->\n\n末尾の段落\n", "f.md", ctx);
    expect(p.blocks.map((b) => [b.id, b.kindHint, b.md])).toEqual([
      [null, "prose", "新しい段落。"],
      ["b_aaaaaaaa", "heading", "## 見出し"],
      [null, "prose", "末尾の段落"],
    ] as never);
  });
  test("BOM and CRLF are normalized", () => {
    expect(parseDocFile("﻿a <!-- b_aaaaaaaa -->\r\n", "f.md", ctx).blocks[0]?.md).toBe("a");
  });
});

describe("§10.3 cite links ⇄ markers", () => {
  const claims = [
    { n: 1, cites: [cite("internal/session/store.go", 12, 30)] },
    { n: 2, cites: [] },
  ];
  test("fromMarkerForm renders the §6.8 example bytes", () => {
    const md = fromMarkerForm("ブラウザごとのセッションを発行・検証・失効させる。[[1]]認可の判定は行わない[[2]]。", claims, ctx);
    expect(md).toBe(
      "ブラウザごとのセッションを発行・検証・失効させる（[store.go:12-30](../../../internal/session/store.go#L12-L30)）。認可の判定は行わない（推測）。",
    );
    const back = toMarkerForm(md, "ja");
    expect(back.md).toBe("ブラウザごとのセッションを発行・検証・失効させる[[1]]。認可の判定は行わない[[2]]。");
    expect(back.links.map((l) => l.inferred)).toEqual([false, true]);
  });
  test("en groups, single-line labels, spaces encoded", () => {
    const md = fromMarkerForm("It rounds half up[[1]].", [{ n: 1, cites: [cite("src/my file.ts", 5, 5), cite("src/a.ts", 1, 3)] }], en);
    expect(md).toBe("It rounds half up ([my file.ts:5](../../../src/my%20file.ts#L5), [a.ts:1-3](../../../src/a.ts#L1-L3)).");
    const p = parseDocFile(`${md} <!-- b_aaaaaaaa -->\n`, ctx.docFile, en);
    expect(p.blocks[0]?.links[0]?.cites).toEqual([
      { path: "src/my file.ts", start: 5, end: 5 },
      { path: "src/a.ts", start: 1, end: 3 },
    ]);
  });
  test("labels escape Markdown punctuation (`[id].tsx`, `__init__.py`, `a|b`) and still parse; `#` `|` are encoded in hrefs", () => {
    const cites = [cite("app/[id]/[slug].tsx", 3, 9), cite("pkg/__init__.py", 1, 1), cite("x/a|b#c.ts", 2, 2)];
    const md = fromMarkerForm("ページを返す[[1]]。", [{ n: 1, cites }], ctx);
    expect(md).toBe(
      "ページを返す（[\\[slug&#93;.tsx:3-9](../../../app/[id]/[slug].tsx#L3-L9)、[\\_\\_init\\_\\_.py:1](../../../pkg/__init__.py#L1)、[a\\|b#c.ts:2](../../../x/a%7Cb%23c.ts#L2)）。",
    );
    const p = parseDocFile(`${md} <!-- b_aaaaaaaa -->\n`, ctx.docFile, ctx);
    expect(p.blocks[0]?.links[0]?.cites).toEqual(cites.map(({ path, start, end }) => ({ path, start, end })));
    expect(toMarkerForm(md, "ja").md).toBe("ページを返す[[1]]。");
  });
  test("percent escapes in a hand-written href decode as UTF-8", () => {
    const p = parseDocFile("返す（[a:1](../../../src/%E3%81%82.ts#L1)）。 <!-- b_aaaaaaaa -->\n", ctx.docFile, ctx);
    expect(p.blocks[0]?.links[0]?.cites[0]?.path).toBe("src/あ.ts");
  });
  test("links inside code spans are not cite groups", () => {
    expect(toMarkerForm("`（[a.ts:1](../a.ts#L1)）` です（[a.ts:1](../a.ts#L1)）。", "ja").md).toBe("`（[a.ts:1](../a.ts#L1)）` です[[1]]。");
  });
  test("external URLs with #L anchors are not cites", () => {
    expect(toMarkerForm("見る（[x](https://github.com/a/b/blob/main/a.ts#L1)）。", "ja").links).toEqual([]);
  });
  test("semantic hash ignores line-number-only cite moves, not text or cite-count changes", () => {
    const a = semanticHash("返す（[a.ts:1-3](../a.ts#L1-L3)）。", "ja", hasher);
    expect(semanticHash("返す（[a.ts:4-6](../a.ts#L4-L6)）。  \n\n\n", "ja", hasher)).toBe(a);
    expect(semanticHash("返す（推測）。", "ja", hasher)).toBe(a);
    expect(semanticHash("返す。", "ja", hasher)).not.toBe(a);
    expect(semanticHash("返す（[a.ts:1-3](../a.ts#L1-L3)）（[a.ts:1-3](../a.ts#L1-L3)）。", "ja", hasher)).not.toBe(a);
  });
});

describe("§6.6 claim spans", () => {
  test("W07-normalized markers, sentence spans, consecutive markers share the span", () => {
    const md = "`Store.Get` は ID から取り出す[[1]]。期限切れなら `ErrExpired` を返す[[2]][[3]]。";
    const s = deriveClaimSpans(md);
    expect(s.map((x) => [x.n, x.quote, x.identifiers])).toEqual([
      [1, "Store.GetはIDから取り出す", ["Store.Get"]],
      [2, "期限切れならErrExpiredを返す", ["ErrExpired"]],
      [3, "期限切れならErrExpiredを返す", ["ErrExpired"]],
    ]);
    expect(md.slice(s[0]?.start, s[0]?.end)).toBe("`Store.Get` は ID から取り出す");
  });
  test("list items and table cells start a span", () => {
    const s = deriveClaimSpans("- 保存する[[1]]。\n- 読む[[2]]。\n\n| 名前 | 説明[[3]] |");
    expect(s.map((x) => x.quote)).toEqual(["保存する", "読む", "説明"]);
  });
});

describe("yomiToRomaji", () => {
  test("Hepburn with long vowels spelled out", () => {
    expect(yomiToRomaji("にんしょう")).toBe("ninshou");
    expect(yomiToRomaji("きっぷ")).toBe("kippu");
    expect(yomiToRomaji("まっちゃ")).toBe("matcha");
    expect(yomiToRomaji("サーバー")).toBe("saabaa");
    expect(yomiToRomaji("じゅうしょ")).toBe("juusho");
  });
});

describe("§10.6 merge3", () => {
  const base = "一文目。二文目。三文目。";
  test("non-overlapping sentence edits merge", () => {
    expect(merge3(base, "一文目を変えた。二文目。三文目。", "一文目。二文目。三文目を変えた。")).toEqual({
      ok: true,
      md: "一文目を変えた。二文目。三文目を変えた。",
    });
  });
  test("the same sentence changed differently conflicts", () => {
    expect(merge3(base, "一文目。二文目A。三文目。", "一文目。二文目B。三文目。")).toEqual({ ok: false, conflicts: 1 });
  });
  test("identical changes and list lines", () => {
    expect(merge3(base, "一文目。X。三文目。", "一文目。X。三文目。")).toEqual({ ok: true, md: "一文目。X。三文目。" });
    expect(merge3("- a\n- b\n- c", "- A\n- b\n- c", "- a\n- b\n- C")).toEqual({ ok: true, md: "- A\n- b\n- C" });
  });
});
