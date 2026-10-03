import { describe, expect, test } from "bun:test";
import { testHasher } from "../testing.ts";
import { normLine, snippetHash, snippetText, splitLines } from "./index.ts";

describe("LOOP §1.1 normalization", () => {
  test("splitLines: CRLF and lone CR become LF; one trailing empty element dropped", () => {
    expect(splitLines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
    expect(splitLines("a")).toEqual(["a"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
    expect(splitLines("é")).toEqual(["é"]); // no NFC
  });

  test("normLine collapses every whitespace run and trims", () => {
    expect(normLine("\t if  (x)　{  ")).toBe("if (x) {");
    expect(normLine("   ")).toBe("");
  });

  test("snippetText is 1-based inclusive and empty out of range", () => {
    const lines = ["  a ", "b\tb", "c"];
    expect(snippetText(lines, 1, 2)).toBe("a\nb b");
    expect(snippetText(lines, 3, 3)).toBe("c");
    expect(snippetText(lines, 0, 1)).toBe("");
    expect(snippetText(lines, 2, 4)).toBe("");
    expect(snippetText(lines, 3, 2)).toBe("");
  });

  test("snippetHash is xxh3 of snippetText; whitespace-only reformat keeps it", () => {
    const h = testHasher();
    expect(snippetHash(h, ["x = 1", "y"], 1, 2)).toBe(h.xxh3("x = 1\ny"));
    expect(snippetHash(h, ["\tx  =  1", "y   "], 1, 2)).toBe(snippetHash(h, ["x = 1", "y"], 1, 2));
  });
});
