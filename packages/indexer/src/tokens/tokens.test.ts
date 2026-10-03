// IDX-AT-46 (token estimate: CHARS_PER_TOKEN with the CJK split, `kind:*` calibration only — R1 CONS-24).
import { describe, expect, test } from "bun:test";
import { CHARS_PER_TOKEN } from "@mitori/core";
import { estimateFromCounts, estimateText, kindOfFile, validCalibrationSample } from "./estimate.ts";
import { countCjk, estimateTokensRaw } from "./index.ts";

describe("IDX-AT-46 token estimate", () => {
  test("CJK ranges (UTF-16 code units)", () => {
    expect(countCjk("abc")).toBe(0);
    expect(countCjk("日本語テキスト、ＡＢ")).toBe(10);
    expect(countCjk("한국어")).toBe(3);
    expect(countCjk("　")).toBe(1);
  });
  test("raw = non-CJK / cpt[kind] + CJK / cpt.markdown_ja, rounded up", () => {
    const code = "x".repeat(2_300);
    expect(estimateTokensRaw(code, "code", "claude-v5")).toBe(1_000);
    expect(estimateTokensRaw("日".repeat(125), "markdown_en", "claude-v5")).toBe(100);
    const mixed = `${"a".repeat(287)}${"日".repeat(125)}`;
    expect(estimateTokensRaw(mixed, "markdown_en", "claude-v5")).toBe(Math.ceil(287 / 2.87 + 125 / 1.25));
    expect(estimateTokensRaw(code, "code", "claude-v4")).toBe(Math.ceil(2_300 / CHARS_PER_TOKEN["claude-v4"].code));
  });
  test("kind:* calibration divides the chars/token ratio; no per-call factor", () => {
    const calib = { kindFactor: (_t: string, k: string) => (k === "code" ? 1.1 : 1), version: 1 };
    expect(estimateText("x".repeat(2_300), "code", "claude-v5", calib)).toBe(1_100); // 2300 / (2.3 / 1.1)
    expect(estimateText("x".repeat(2_300), "code", "claude-v5")).toBe(1_000);
    expect(estimateFromCounts(0, 0, "code", "claude-v5")).toBe(0);
  });
  test("text kind of a file (spec §2.6)", () => {
    expect(kindOfFile("a/b.min.js", "minified", 10, 0)).toBe("minified");
    expect(kindOfFile("bun.lock", "lockfile", 10, 0)).toBe("lock");
    expect(kindOfFile("README.md", "docs", 100, 0)).toBe("markdown_en");
    expect(kindOfFile("README.ja.md", "docs", 100, 40)).toBe("markdown_ja");
    expect(kindOfFile("package.json", "config", 10, 0)).toBe("json");
    expect(kindOfFile("a.css", "source", 10, 0)).toBe("css");
    expect(kindOfFile("a.go", "source", 10, 0)).toBe("code");
  });
  test("calibrate() validation: chars ≥ 2,000 and 0.25 < ratio < 4", () => {
    const ok = { tokenizer: "claude-v5", kind: "code", chars: 2_300, cjk: 0, tokens: 1_100, source: "count_tokens" } as const;
    expect(validCalibrationSample(ok)).toBe(true);
    expect(validCalibrationSample({ ...ok, chars: 1_999 })).toBe(false);
    expect(validCalibrationSample({ ...ok, tokens: 4_100 })).toBe(false);
    expect(validCalibrationSample({ ...ok, tokens: 200 })).toBe(false);
    expect(validCalibrationSample({ ...ok, cjk: 3_000 })).toBe(false);
  });
});
