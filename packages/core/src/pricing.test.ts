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
      const cases: [keyof typeof zero, number][] = [
        ["in", p.inPerMTok],
        ["cacheWrite5m", p.cacheWrite5mPerMTok],
        ["cacheWrite1h", p.cacheWrite1hPerMTok],
        ["cacheRead", p.cacheReadPerMTok],
        ["out", p.outPerMTok],
      ];
      for (const [field, perMTok] of cases) {
        expect(priceUsage(model, { ...zero, [field]: M }, false)).toBeCloseTo(perMTok, 6);
        expect(priceUsage(model, { ...zero, [field]: M }, true)).toBeCloseTo(perMTok * p.batchMultiplier, 6);
      }
    }
  });

  test("cache-read ratios: Opus 0.05×, Sonnet 0.1×; Batch 0.5×", () => {
    const o = PRICING["claude-opus-5-5"];
    const s = PRICING["claude-sonnet-5-5"];
    expect(o.cacheReadPerMTok / o.inPerMTok).toBeCloseTo(0.05, 9);
    expect(s.cacheReadPerMTok / s.inPerMTok).toBeCloseTo(0.1, 9);
    expect(priceUsage("claude-sonnet-5-5", { ...zero, out: 2 * M }, true)).toBe(10);
  });

  test("mixed usage sums the classes and rounds to 6 decimals", () => {
    const usd = priceUsage("claude-opus-5-5", { in: 1234, cacheWrite5m: 10, cacheWrite1h: 2000, cacheRead: 50_000, out: 777 }, false);
    expect(usd).toBe(Math.round(((1234 * 4 + 10 * 5 + 2000 * 8 + 50_000 * 0.2 + 777 * 20) / M) * 1e6) / 1e6);
    expect(String(usd).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
    expect(priceUsage("claude-haiku-4-5", { ...zero, in: 1 }, false)).toBe(0.000001);
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
