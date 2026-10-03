import { describe, expect, test } from "bun:test";
import { bitap, findQuote, levenshtein, similarity } from "./quote.ts";

const TEXT = "alpha beta gamma. The quick brown fox jumps over the lazy dog. delta epsilon. The quick brown fox jumps again.";

describe("LOOP §1.5 findQuote", () => {
  test("prefix + exact + suffix ⇒ score 1", () => {
    const at = TEXT.indexOf("quick brown fox jumps over");
    const m = findQuote(TEXT, { prefix: "gamma. The ", exact: "quick brown fox jumps over", suffix: " the lazy" });
    expect(m).toEqual({ start: at, end: at + 26, score: 1 });
  });

  test("exact only ⇒ 0.9 + 0.1·ctxSim, best context wins, hint breaks ties", () => {
    const m = findQuote(TEXT, { prefix: "XXXXX", exact: "quick brown fox jumps", suffix: " again." }, 0);
    expect(m?.start).toBe(TEXT.lastIndexOf("quick brown fox jumps"));
    expect(m?.score).toBeGreaterThan(0.9);
    expect(m?.score).toBeLessThan(1);
    const tie = findQuote(TEXT, { prefix: "", exact: "quick brown fox jumps", suffix: "" }, TEXT.length);
    expect(tie?.start).toBe(TEXT.lastIndexOf("quick brown fox jumps"));
  });

  test("bitap + levenshtein for an edited quote near the hint", () => {
    const text = `${"x".repeat(300)}function computeTotal(items) { return items.reduce((a, b) => a + b, 0); }${"y".repeat(300)}`;
    const m = findQuote(text, { prefix: "", exact: "function computeTotals(items) { return items.reduce((a, b) => a + b, 0) }", suffix: "" }, 300);
    expect(m).not.toBeNull();
    expect(m?.start).toBe(300);
    expect(m?.score).toBeGreaterThanOrEqual(0.75 * 0.9);
    expect(m?.score).toBeLessThan(0.9);
  });

  test("unrelated text ⇒ null; empty exact ⇒ null", () => {
    expect(findQuote(TEXT, { prefix: "", exact: "zzzzzzzzzzzzqqqqqqqqqqqq", suffix: "" })).toBeNull();
    expect(findQuote(TEXT, { prefix: "a", exact: "", suffix: "b" })).toBeNull();
  });

  test("Japanese / emoji / combining characters", () => {
    const text = "設計書の見取り図 🚀 を作る。ログイン処理は é を扱う。";
    const m = findQuote(text, { prefix: "", exact: "ログイン処理は", suffix: "" });
    expect(m?.start).toBe(text.indexOf("ログイン処理は"));
  });

  test("bitap finds the nearest fuzzy location; levenshtein / similarity", () => {
    expect(bitap("abcdefghij", "cdxfg", 0)).toBe(2);
    expect(bitap("aaaaaaaaaa", "zzzz", 3)).toBe(-1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
  });
});
