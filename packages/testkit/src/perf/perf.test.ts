import { describe, expect, test } from "bun:test";
import { MitoriError } from "@mitori/core";
import { findBudget, loadBudgetsFile } from "./budgets.ts";
import { budget, measure, rssPeak } from "./index.ts";
import { cv, mean, median, percentile, stdev, toSamples } from "./stats.ts";

describe("PERF-U-01 sample statistics", () => {
  test("median of odd and even counts, empty input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test("p95 is nearest-rank", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(19); // ceil(0.95 * 20) = 19th value
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3], 100)).toBe(3);
    expect(percentile([], 95)).toBe(0);
  });

  test("cv uses the sample stdev; constant samples have cv 0", () => {
    expect(mean([2, 4])).toBe(3);
    expect(stdev([2, 4])).toBeCloseTo(Math.SQRT2, 10);
    expect(cv([2, 4])).toBeCloseTo(Math.SQRT2 / 3, 10);
    expect(cv([7, 7, 7])).toBe(0);
    expect(cv([0, 0])).toBe(0);
    expect(cv([5])).toBe(0);
  });

  test("toSamples fills the contract shape", () => {
    const s = toSamples("x.y", "ms", [1, 2, 3, 4]);
    expect(s).toMatchObject({ id: "x.y", unit: "ms", values: [1, 2, 3, 4], median: 2.5, p95: 4 });
  });
});

describe("PERF-U-02 measure", () => {
  test("discards warm-up runs and counts exactly `runs` samples", async () => {
    let calls = 0;
    const s = await measure("t.count", () => calls++, { runs: 5, warmup: 2 });
    expect(calls).toBe(7);
    expect(s.values).toHaveLength(5);
    expect(s.unit).toBe("ms");
  });

  test("awaits async work and takes the unit from opts", async () => {
    const s = await measure("t.async", () => new Promise((r) => setTimeout(r, 5)), { runs: 3, warmup: 0, unit: "s" });
    expect(s.unit).toBe("s");
    expect(s.median).toBeGreaterThanOrEqual(4);
  });

  test("without `runs`, a micro case keeps sampling until 1 s of work (capped)", async () => {
    const s = await measure("t.micro", () => {}, { warmup: 0 });
    expect(s.values.length).toBeGreaterThan(15);
    expect(s.values.length).toBeLessThanOrEqual(5000);
  });
});

describe("PERF-U-03 rssPeak", () => {
  test("reports the value and a peak at least the current RSS", async () => {
    const { value, peakMb } = await rssPeak(async () => {
      const hold = new Uint8Array(32 * 1024 * 1024).fill(1);
      await new Promise((r) => setTimeout(r, 30));
      return hold.length;
    });
    expect(value).toBe(32 * 1024 * 1024);
    expect(peakMb).toBeGreaterThanOrEqual(process.memoryUsage.rss() / 1e6 - 1);
  });

  test("stops sampling when fn throws", async () => {
    await expect(rssPeak(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("PERF-U-04 budget lookup", () => {
  test("returns the committed entry", () => {
    const b = budget("asset.js.initial.gz");
    expect(b).toMatchObject({ target: 60, limit: 150, unit: "KB", dir: "max" });
  });

  test("unknown ids throw E_NOT_FOUND instead of passing", () => {
    expect(() => budget("no.such.budget")).toThrow(MitoriError);
    try {
      findBudget("no.such.budget");
    } catch (err) {
      expect((err as MitoriError).code).toBe("E_NOT_FOUND");
    }
  });

  test("the merged file carries counters", () => {
    expect(loadBudgetsFile().counters.some((c) => c.id === "idx.warm.parseCalls" && c.max === 0)).toBe(true);
  });
});
