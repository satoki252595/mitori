import { describe, expect, test } from "bun:test";
import { codeSpans, deriveSpans, normalizeMarkers, plainText, scanMarkers } from "./mdscan.ts";

const quotes = (md: string) => deriveSpans(md).map((s) => [s.n, s.quote, s.identifiers]);

describe("AC-11 marker → quote derivation (§6.6)", () => {
  test("ja: sentence boundaries after 。", () => {
    expect(quotes("ブラウザごとのセッションを発行する[[1]]。認可の判定は行わない[[2]]。")).toEqual([
      [1, "ブラウザごとのセッションを発行する", []],
      [2, "認可の判定は行わない", []],
    ]);
  });

  test("en: '.' + space is a boundary, '.' inside code is not", () => {
    expect(quotes("It stores sessions[[1]]. `Store.Get` returns the value for an id[[2]].")).toEqual([
      [1, "It stores sessions", []],
      [2, "Store.Get returns the value for an id", ["Store.Get"]],
    ]);
  });

  test("consecutive markers share the span", () => {
    expect(quotes("期限切れなら `ErrExpired` を返す[[1]][[2]]。")).toEqual([
      [1, "期限切れなら ErrExpired を返す", ["ErrExpired"]],
      [2, "期限切れなら ErrExpired を返す", ["ErrExpired"]],
    ]);
  });

  test("list items start a span at the item; the list marker is dropped", () => {
    expect(quotes("- `Get` は値を返す[[1]]。\n- `Put` は値を保存する[[2]]。\n1. `Del` を呼ぶ[[3]]")).toEqual([
      [1, "Get は値を返す", ["Get"]],
      [2, "Put は値を保存する", ["Put"]],
      [3, "Del を呼ぶ", ["Del"]],
    ]);
  });

  test("table cells start a span at the cell", () => {
    expect(quotes("| 名前 | 意味 |\n|---|---|\n| `id` | 識別子だ[[1]] |")).toEqual([[1, "識別子だ", []]]);
  });

  test("[[1]] inside a code span is not a marker", () => {
    expect(scanMarkers("`a[[1]]` と b[[2]]").map((m) => m.n)).toEqual([2]);
    expect(quotes("`x[[1]]` は値だ[[2]]。")).toEqual([[2, "x[[1]] は値だ", ["x[[1]]"]]]);
  });

  test("a second sentence without marker does not leak into the next span", () => {
    expect(quotes("前置きだ。`run` は処理する[[1]]。")).toEqual([[1, "run は処理する", ["run"]]]);
  });

  test("emphasis is removed from quotes; snake_case survives", () => {
    expect(plainText("**重要**: `snake_case` と _強調_ を扱う")).toBe("重要: snake_case と 強調 を扱う");
  });
});

describe("W07 normalization", () => {
  test("terminator and closers move behind the marker run", () => {
    expect(normalizeMarkers("返す。[[1]]")).toEqual({ md: "返す[[1]]。", moved: true });
    expect(normalizeMarkers("だ。」[[1]][[2]]次")).toEqual({ md: "だ[[1]][[2]]。」次", moved: true });
    expect(normalizeMarkers("works.[[1]] Then")).toEqual({ md: "works[[1]]. Then", moved: true });
    expect(normalizeMarkers("ok[[1]].")).toEqual({ md: "ok[[1]].", moved: false });
    expect(normalizeMarkers("`a.`[[1]]")).toEqual({ md: "`a.`[[1]]", moved: false });
  });
});

describe("code spans", () => {
  test("double backticks and fences", () => {
    expect(codeSpans("``a`b`` and `c`")).toEqual(["a`b", "c"]);
    expect(codeSpans("```\n`not`\n```\n`yes`")).toEqual(["yes"]);
  });
});
