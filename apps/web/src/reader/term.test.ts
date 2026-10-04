/** NC-18 term card line: a reading for kanji, the English name when it differs, the defining file for identifiers, never romaji. */
import { describe, expect, test } from "bun:test";
import type { SymbolKey } from "@mitori/core";
import { termLine } from "./term.ts";

describe("NC-18 term card", () => {
  test("a kanji term keeps its reading and English name; the romaji is never shown", () => {
    expect(termLine({ term: "持ち越し", yomi: "もちこし", en: "carry-forward" })).toEqual({ yomi: "もちこし", en: "carry-forward" });
  });
  test("a katakana term needs no reading", () => {
    expect(termLine({ term: "プロンプト", yomi: "ぷろんぷと", en: "prompt" })).toEqual({ en: "prompt" });
  });
  test("an identifier: no reading, no English echo, the place it is defined", () => {
    expect(termLine({ term: "Item", yomi: "あいてむ", en: "Item", symbol: "lib/tokens.ts#Item" as SymbolKey })).toEqual({ where: "lib/tokens.ts" });
    expect(termLine({ term: "KIND_SPEC", yomi: "きんどすぺっく" })).toEqual({});
  });
});
