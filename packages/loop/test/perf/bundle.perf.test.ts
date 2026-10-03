import { describe, expect, test } from "bun:test";
import { createBundleBuilder } from "../../src/bundle/index.ts";
import { CASES, goSmallWorld } from "../../src/bundle/test/cases.ts";

// AC-L22 / budget `loop.bundle`: building an M-tier bundle takes p95 ≤ 100 ms (hard cap 250 ms on slower machines).
// The WP-12 bench runner (`bun run bench --filter loop.bundle`, bench/loop.bench.ts#bundle:M) is not in the tree yet;
// this measures the same thing — a build over the go-small fixture through in-memory index fakes — as a test.

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] as number;

async function measure(name: string, runs: number): Promise<{ p50: number; p95: number }> {
  const w = goSmallWorld();
  const builder = createBundleBuilder(w.deps);
  const c = CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no case ${name}`);
  for (let i = 0; i < 10; i++) await c.run(builder, w); // warm up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await c.run(builder, w);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95) };
}

describe("loop.bundle build time", () => {
  test("M tier (3 anchors, REL, RULES, threads): p95 ≤ 100 ms", async () => {
    const { p50, p95 } = await measure("batch3", 100);
    console.log(`loop.bundle:M p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThanOrEqual(100);
  });

  test("L tier (8 anchors + 5 chips): p95 ≤ 250 ms", async () => {
    const { p50, p95 } = await measure("batch8", 50);
    console.log(`loop.bundle:L p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThanOrEqual(250);
  });

  test("XS / S tiers build in a few milliseconds", async () => {
    for (const name of ["question", "change", "pull-change"]) {
      const { p95 } = await measure(name, 50);
      expect([name, p95 <= 50]).toEqual([name, true]);
    }
  });
});
