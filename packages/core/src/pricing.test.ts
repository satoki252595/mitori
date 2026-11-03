import { describe, expect, test } from "bun:test";
import { type ClaudeModelId, PRICING } from "./domain.ts";
import { MitoriError } from "./errors.ts";
import { priceUsage, tokenBand } from "./pricing.ts";

const M = 1_000_000;
const zero = { in: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, out: 0 };

describe("CORE-U-004 priceUsage", () => {
  test("each token class × each model × batch follows PRICING", () => {
    for (const model of Object.keys(PRICING) as ClaudeModelId[]) {
      const p = PRICING[model];
      // two-tier models cross into the upper tier at 1M input tokens: stay small to price the lower tier
      const n = "longContext" in p ? 1000 : M;
      const cases: [keyof typeof zero, number][] = [
        ["in", p.inPerMTok],
        ["cacheWrite5m", p.cacheWrite5mPerMTok],
        ["cacheWrite1h", p.cacheWrite1hPerMTok],
        ["cacheRead", p.cacheReadPerMTok],
        ["out", p.outPerMTok],
      ];
      for (const [field, perMTok] of cases) {
        expect(priceUsage(model, { ...zero, [field]: n }, false)).toBeCloseTo((perMTok * n) / M, 6);
        expect(priceUsage(model, { ...zero, [field]: n }, true)).toBeCloseTo(((perMTok * n) / M) * p.batchMultiplier, 6);
      }
    }
  });

  test("cache-read ratios: Opus 0.05×, Sonnet 0.05×; Batch 0.5×", () => {
    const o = PRICING["claude-opus-5-5"];
    const s = PRICING["claude-sonnet-5-5"];
    expect(o.cacheReadPerMTok / o.inPerMTok).toBeCloseTo(0.05, 9);
    expect(s.cacheReadPerMTok / s.inPerMTok).toBeCloseTo(0.05, 9);
    expect(priceUsage("claude-sonnet-5-5", { ...zero, out: 2 * M }, true)).toBe(10);
  });

  test("mixed usage sums the classes and rounds to 6 decimals", () => {
    const usd = priceUsage("claude-opus-5-5", { in: 1234, cacheWrite5m: 10, cacheWrite1h: 2000, cacheRead: 50_000, out: 777 }, false);
    expect(usd).toBe(Math.round(((1234 * 4 + 10 * 5 + 2000 * 8 + 50_000 * 0.2 + 777 * 20) / M) * 1e6) / 1e6);
    expect(String(usd).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
    expect(priceUsage("claude-haiku-4-5", { ...zero, in: 1 }, false)).toBe(0.000001);
  });

  test("WP36-A fable-5-1 list prices follow the 2026-11-03 table", () => {
    const f = PRICING["claude-fable-5-1"];
    expect([f.inPerMTok, f.cacheWrite5mPerMTok, f.cacheWrite1hPerMTok, f.cacheReadPerMTok, f.outPerMTok]).toEqual([10, 12.5, 20, 0.25, 50]);
    expect(f.minCachePrefixTokens).toBe(512);
    expect(f.tokenizer).toBe("claude-v5");
    expect(priceUsage("claude-fable-5-1", { ...zero, in: M }, false)).toBe(10);
  });

  test("WP36-A haiku-5-5 has two tiers around 100,000 input tokens", () => {
    const h = PRICING["claude-haiku-5-5"];
    expect([h.inPerMTok, h.cacheWrite5mPerMTok, h.cacheWrite1hPerMTok, h.cacheReadPerMTok, h.outPerMTok]).toEqual([0.1, 0.125, 0.2, 0.01, 0.5]);
    expect(h.longContext?.overInTokens).toBe(100_000);
    expect(h.longContext?.price).toEqual({ inPerMTok: 0.5, cacheWrite5mPerMTok: 0.625, cacheWrite1hPerMTok: 1, cacheReadPerMTok: 0.05, outPerMTok: 2.5 });
    // at/below the threshold the lower tier applies to every item
    expect(priceUsage("claude-haiku-5-5", { in: 60_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 40_000, out: M }, false)).toBeCloseTo(
      (60_000 * 0.1 + 40_000 * 0.01 + M * 0.5) / M,
      6,
    );
    // above the threshold the whole request moves to the upper tier (input and output alike)
    expect(priceUsage("claude-haiku-5-5", { in: 60_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 40_002, out: 0 }, false)).toBeCloseTo(
      (60_000 * 0.5 + 40_002 * 0.05) / M,
      6,
    );
    expect(priceUsage("claude-haiku-5-5", { in: 100_002, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, out: 1000 }, false)).toBeCloseTo(
      (100_002 * 0.5 + 1000 * 2.5) / M,
      6,
    );
    // cache writes count toward the threshold too
    expect(priceUsage("claude-haiku-5-5", { in: 10_000, cacheWrite5m: 90_002, cacheWrite1h: 0, cacheRead: 0, out: 0 }, false)).toBeCloseTo(
      (10_000 * 0.5 + 90_002 * 0.625) / M,
      6,
    );
  });

  test("WP36-A CLAUDE_MODEL_IDS is exactly the PRICING key set", async () => {
    const { CLAUDE_MODEL_IDS } = await import("./domain.ts");
    expect([...CLAUDE_MODEL_IDS].sort()).toEqual([...(Object.keys(PRICING) as ClaudeModelId[])].sort());
    expect(CLAUDE_MODEL_IDS).toContain("claude-haiku-5-5");
    expect(CLAUDE_MODEL_IDS).toContain("claude-fable-5-1");
    expect(CLAUDE_MODEL_IDS).toContain("claude-haiku-4-5");
  });

  test("rejects unknown models and negative / non-finite counts", () => {
    expect(() => priceUsage("claude-x" as ClaudeModelId, zero, false)).toThrow(MitoriError);
    expect(() => priceUsage("claude-opus-5-5", { ...zero, out: -1 }, false)).toThrow(MitoriError);
    expect(() => priceUsage("claude-opus-5-5", { ...zero, in: Number.NaN }, false)).toThrow(MitoriError);
  });

  test("arbitrary models require explicit prices, including free local models", () => {
    const model = "generic:muse-spark-1.3-contributor" as const;
    const prices = { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 };
    expect(priceUsage(model, { ...zero, in: M, out: M, cacheRead: M }, false, prices)).toBe(0.302);
    expect(() => priceUsage(model, zero, false)).toThrow(MitoriError);
    expect(() => priceUsage(model, zero, false, { ...prices, inPerMTok: -1 })).toThrow(MitoriError);
    expect(priceUsage("generic:local", { ...zero, in: M }, false, { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 })).toBe(0);
  });
});

describe("CORE-U-005 tokenBand", () => {
  test("bands change exactly at 10,000 / 50,000 / 200,000", () => {
    expect(tokenBand(0)).toBe("lt10k");
    expect(tokenBand(9_999)).toBe("lt10k");
    expect(tokenBand(10_000)).toBe("10k_50k");
    expect(tokenBand(49_999)).toBe("10k_50k");
    expect(tokenBand(50_000)).toBe("50k_200k");
    expect(tokenBand(199_999)).toBe("50k_200k");
    expect(tokenBand(200_000)).toBe("gt200k");
  });
});
