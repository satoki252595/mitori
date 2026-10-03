import { describe, expect, test } from "bun:test";
import type { ClaimId } from "@mitori/core";
import { snippetHash, splitLines } from "../normalize/index.ts";
import { testHasher } from "../testing.ts";
import { createAnchorEngine } from "./index.ts";

const h = testHasher();
const eng = createAnchorEngine({ hasher: h });
const FILE = "package main\r\n\r\nfunc a() {\r\n\treturn 1\r\n}\r\n";

describe("LOOP §1.2.2 code capture", () => {
  test("snippet over normalized lines, quote over the LF text with 32-char context", () => {
    const a = eng.codeAnchor("main.go", 3, 5, FILE, "b1", "main.go#a");
    expect(a).toMatchObject({ path: "main.go", start: 3, end: 5, blob: "b1", symbol: "main.go#a" });
    expect(a.snippet).toBe(snippetHash(h, splitLines(FILE), 3, 5));
    expect(a.quote).toEqual({ prefix: "package main\n\n", exact: "func a() {\n\treturn 1\n}", suffix: "" });
  });

  test("exact capped at the last LF within 256 chars; char selection", () => {
    const long = `${Array.from({ length: 40 }, (_, i) => `line number ${i} with text`).join("\n")}\n`;
    const a = eng.codeAnchor("x.txt", 1, 40, long, "b");
    expect(a.quote?.exact.length).toBeLessThanOrEqual(256);
    expect(a.quote?.exact.endsWith("text")).toBe(true);
    expect(a.quote?.suffix.startsWith("\n")).toBe(true);
    const sel = eng.codeAnchor("x.txt", 2, 2, long, "b", undefined, { from: long.indexOf("number 1 "), to: long.indexOf("number 1 ") + 8 });
    expect(sel.quote?.exact).toBe("number 1");
  });

  test("invalid ranges are E_INVALID_INPUT", () => {
    expect(() => eng.codeAnchor("x", 0, 1, "a\n", "b")).toThrow();
    expect(() => eng.codeAnchor("x", 2, 2, "a\n", "b")).toThrow();
    expect(() => eng.codeAnchor("x", 2, 1, "a\nb\n", "b")).toThrow();
  });
});

describe("LOOP §1.2.1 doc capture", () => {
  const text = "ログインは internal/auth で処理する。セッションは 30 日で失効する。";
  const claims = [
    { id: "cl_aaaaaaaa" as ClaimId, start: 0, end: 22 },
    { id: "cl_bbbbbbbb" as ClaimId, start: 22, end: text.length },
  ];

  test("quote, offset, claim binding (≥50 % of selection and ≥30 % of claim)", () => {
    const s = text.indexOf("セッション");
    const a = eng.docAnchor("b_aaaaaaaa", text, "h1", s, s + 12, claims);
    expect(a.quote?.exact).toBe(text.slice(s, s + 12));
    expect(a.quote?.prefix).toBe(text.slice(Math.max(0, s - 32), s));
    expect(a.offset).toBe(s);
    expect(a.claim).toBe("cl_bbbbbbbb");
    const tiny = eng.docAnchor("b_aaaaaaaa", text, "h1", 0, 2, claims);
    expect(tiny.claim).toBeUndefined(); // 2 chars < 30 % of the claim
  });

  test("empty selection ⇒ whole block; > 2000 chars ⇒ truncated, no suffix", () => {
    expect(eng.docAnchor("b_aaaaaaaa", text, "h1", 5, 5)).toEqual({ block: "b_aaaaaaaa", blockHash: "h1" });
    // Non-integer offsets never produce a NaN offset / empty quote: whole block.
    expect(eng.docAnchor("b_aaaaaaaa", text, "h1", Number.NaN, 4)).toEqual({ block: "b_aaaaaaaa", blockHash: "h1" });
    expect(eng.docAnchor("b_aaaaaaaa", text, "h1", 1.5, 4)).toEqual({ block: "b_aaaaaaaa", blockHash: "h1" });
    const big = "あ".repeat(2500);
    const a = eng.docAnchor("b_aaaaaaaa", big, "h", 0, 2500);
    expect(a.quote?.exact.length).toBe(2000);
    expect(a.quote?.suffix).toBe("");
  });

  test("verifyDocQuote: exact context or fuzzy ≥ 0.9", () => {
    expect(eng.verifyDocQuote(text, { prefix: "ログインは ", exact: "internal/auth", suffix: " で処理" })).toBe(true);
    expect(eng.verifyDocQuote(text, { prefix: "zzz", exact: "internal/auth", suffix: "zzz" })).toBe(true);
    expect(eng.verifyDocQuote(text, { prefix: "", exact: "まったく別の文章です", suffix: "" })).toBe(false);
  });
});
