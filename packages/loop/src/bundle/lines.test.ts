import { describe, expect, test } from "bun:test";
import { firstSentence, headingText, renderMarkers, toMarkers } from "./doc-md.ts";
import { codeLines, field, japaneseRatio, quote, quoteLabelled, safeLine, splitText, usdText } from "./lines.ts";

const cp = (n: number) => String.fromCodePoint(n);

describe("safeLine / field (spec §4.1)", () => {
  test("plain text passes through untouched, tabs included", () => {
    expect(safeLine("\tfunc f() {}  // 日本語 😀")).toBe("\tfunc f() {}  // 日本語 😀");
  });
  test("CR is dropped; C0 controls and DEL become \\x{XX}; bidi and zero-width characters become \\u{XXXX}", () => {
    expect(safeLine(`a\r${cp(7)}${cp(0x7f)}${cp(0x202e)}${cp(0x200b)}${cp(0x2066)}${cp(0xfeff)}${cp(0x2060)}b`)).toBe(
      "a\\x{07}\\x{7F}\\u{202E}\\u{200B}\\u{2066}\\u{FEFF}\\u{2060}b",
    );
  });
  test("lines longer than the cap end in …[+N]; a surrogate pair is never split", () => {
    expect(safeLine("x".repeat(501))).toBe(`${"x".repeat(500)}…[+1]`);
    expect(safeLine("x".repeat(500))).toBe("x".repeat(500));
    const emoji = `${"x".repeat(499)}😀tail`;
    const cut = safeLine(emoji);
    expect(cut.startsWith("x".repeat(499))).toBe(true);
    expect(cut).toMatch(/…\[\+\d+\]$/u);
    expect(cut.includes("\ud83d")).toBe(false);
    expect(safeLine("y".repeat(900), Number.POSITIVE_INFINITY)).toBe("y".repeat(900));
  });
  test("field escapes every line break and control character as well (a value cannot start a line)", () => {
    expect(field(`a\nb\rc\td${cp(0x2028)}e`)).toBe("a\\x{0A}b\\x{0D}c\\x{09}d\\u{2028}e");
    expect(field("src/ok-file_1.ts")).toBe("src/ok-file_1.ts");
  });
});

describe("quote / code lines", () => {
  test("quote: empty lines are a bare >, a final newline adds nothing, CRLF and CR are line breaks", () => {
    expect(quote("a\n\nb\n")).toEqual(["> a", ">", "> b"]);
    expect(quote("a\r\nb\rc")).toEqual(["> a", "> b", "> c"]);
    expect(quote("")).toEqual([]);
  });
  test("quoteLabelled puts the label on the first line only", () => {
    expect(quoteLabelled("R1 human: ", "x\ny")).toEqual(["> R1 human: x", "> y"]);
    expect(quoteLabelled("R1 human: ", "")).toEqual(["> R1 human: "]);
  });
  test("codeLines: N| or |, empty lines keep the bar", () => {
    expect(codeLines(["a", "", "c"], 9, true)).toEqual(["9|a", "10|", "11|c"]);
    expect(codeLines(["a", ""], 9, false)).toEqual(["|a", "|"]);
  });
  test("splitText", () => {
    expect(splitText("a\nb\n")).toEqual(["a", "b"]);
    expect(splitText("\n")).toEqual([""]);
  });
});

describe("usdText / japaneseRatio", () => {
  test("usd: two to four decimals", () => {
    expect([0.1, 0.0123, 0, 2, 0.05, 0.123456, 1.5].map(usdText)).toEqual(["0.10", "0.0123", "0.00", "2.00", "0.05", "0.1235", "1.50"]);
  });
  test("japanese ratio counts kana and kanji among non-space characters", () => {
    expect(japaneseRatio("abc")).toBe(0);
    expect(japaneseRatio("日本語 abc")).toBe(0.5);
    expect(japaneseRatio("")).toBe(0);
  });
});

describe("doc text in bundles", () => {
  const cites: Record<number, { path: string; start: number; end: number }[]> = {
    1: [
      { path: "a.go", start: 1, end: 2 },
      { path: "b/c.go", start: 7, end: 7 },
    ],
    2: [],
  };
  const at = (n: number) => cites[n] ?? null;
  test("toMarkers: ids and the space before them are removed, every cite group (ja / en, cited or inferred) becomes [[k]] in order", () => {
    expect(toMarkers("再試行する（[a.go:1-2](a.go#L1-L2)、[c.go:7](../b/c.go#L7)）（推測）。 <!-- b_abcdefgh -->")).toBe("再試行する[[1]][[2]]。");
    expect(toMarkers("Retries once ([x.ts:3](x.ts#L3), [e.ts:1-2](d%20e.ts#L1-L2)) and more (inferred).")).toBe("Retries once[[1]] and more[[2]].");
  });
  test("renderMarkers: [[n]] ⇒ claim n's cites as [path:a-b] (a single line is not a range), the inferred label for no cite, nothing for no claim", () => {
    expect(renderMarkers("再試行する[[1]]。推測[[2]]。無い[[3]]。", at, "ja")).toBe("再試行する[a.go:1-2][b/c.go:7]。推測（推測）。無い。");
    expect(renderMarkers("Retries once[[2]].", at, "en")).toBe("Retries once (inferred).");
  });
  test("renderMarkers leaves markers inside code spans and fences alone; ordinary links and text too", () => {
    const md = "Use `[[1]]` here[[1]].\n```\n[[1]]\n```\nSee [the docs](https://example.com/a) for ``a`[[2]]`` code.";
    expect(renderMarkers(md, at, "en")).toBe(
      "Use `[[1]]` here[a.go:1-2][b/c.go:7].\n```\n[[1]]\n```\nSee [the docs](https://example.com/a) for ``a`[[2]]`` code.",
    );
  });
  test("first sentence: CJK terminators anywhere, ASCII ones only before a space; markup removed; ≤ 80 characters", () => {
    expect(firstSentence("**重要**: 先に検証する。次に保存する。")).toBe("重要: 先に検証する。");
    expect(firstSentence("Uses v1.2 of `the` API. Then stops.")).toBe("Uses v1.2 of the API.");
    expect(firstSentence("- 箇条書きの項目[a.go:1-2]。続き")).toBe("箇条書きの項目[a.go:1-2]。");
    expect(firstSentence("詳細は [仕様](docs/spec.md) を参照。次")).toBe("詳細は 仕様 を参照。");
    expect(firstSentence("あ".repeat(120))).toBe(`${"あ".repeat(79)}…`);
  });
  test("heading text drops the marks", () => {
    expect(headingText("## リトライ <!-- b_abcdefgh -->")).toBe("リトライ");
  });
});
