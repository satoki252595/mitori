import { describe, expect, test } from "bun:test";
import { floorFor, judge, NOISE_CV, REGRESSION_RATIO } from "./judge.ts";

const flat = (v: number, n = 5): number[] => Array.from({ length: n }, () => v);

describe("BENCH-U-01 judge (testing spec §6.7)", () => {
  test("constants are the spec's 20 % and 25 %", () => {
    expect(REGRESSION_RATIO).toBe(0.2);
    expect(NOISE_CV).toBe(0.25);
  });

  test("a 25 % slowdown above the floor is regressed", () => {
    const j = judge(flat(20), flat(25), "ms");
    expect(j.status).toBe("regressed");
    expect(j.delta).toBeCloseTo(0.25, 10);
    expect(j.floor).toBe(2);
  });

  test("exactly 20 % is not a regression (strictly greater is required)", () => {
    expect(judge(flat(100), flat(120), "ms").status).toBe("ok");
    expect(judge(flat(100), flat(120.01), "ms").status).toBe("regressed");
  });

  test("a slowdown below the ms floor is ignored: 6 ms → 7.5 ms is +25 % but only 1.5 ms", () => {
    expect(judge(flat(6), flat(7.5), "ms").status).toBe("ok");
  });

  test("the ms floor is max(2 ms, 5 % of base)", () => {
    expect(floorFor("ms", 10)).toBe(2);
    expect(floorFor("ms", 100)).toBe(5);
    // 100 ms → 124 ms: +24 % but 24 ms ≥ 5 ms floor ⇒ regressed; 100 → 104 is within both
    expect(judge(flat(100), flat(124), "ms").status).toBe("regressed");
    expect(judge(flat(100), flat(104), "ms").status).toBe("ok");
  });

  test("floors for the other units: MB 5, s 0.1, none elsewhere", () => {
    expect(floorFor("MB", 1)).toBe(5);
    expect(floorFor("s", 1)).toBe(0.1);
    expect(floorFor("count", 1)).toBe(0);
    expect(judge(flat(10), flat(14), "MB").status).toBe("ok"); // +40 % but 4 MB < 5 MB
    expect(judge(flat(100), flat(130), "MB").status).toBe("regressed");
    expect(judge(flat(0.3), flat(0.35), "s").status).toBe("ok"); // +16 %
  });

  test("0.09 s on a 0.3 s base is under the 0.1 s floor", () => {
    expect(judge(flat(0.3), flat(0.39), "s").status).toBe("ok");
    expect(judge(flat(0.3), flat(0.41), "s").status).toBe("regressed");
  });

  test("a spread above 25 % on either side is noisy, never regressed", () => {
    const spread = [10, 40, 10, 40, 10]; // cv ≈ 0.7
    expect(judge(flat(20), spread, "ms").status).toBe("noisy");
    expect(judge(spread, flat(60), "ms").status).toBe("noisy");
  });

  test("a spread of exactly the limit is not noisy", () => {
    // mean 100, sample stdev 25 ⇒ cv 0.25 exactly: [75, 125] has stdev 35.36, so build n=3 [75,100,125]: stdev 25
    const j = judge([75, 100, 125], [75, 100, 125], "ms");
    expect(j.cvB).toBeCloseTo(0.25, 10);
    expect(j.status).toBe("ok");
  });

  test("more than 20 % faster is improved", () => {
    const j = judge(flat(100), flat(70), "ms");
    expect(j.status).toBe("improved");
    expect(j.delta).toBeCloseTo(-0.3, 10);
  });

  test("a zero base does not divide by zero", () => {
    const j = judge(flat(0), flat(5), "count");
    expect(j.delta).toBe(0);
    expect(j.status).toBe("ok");
  });

  test("medians, not means, are compared (one outlier does not regress)", () => {
    expect(judge([20, 20, 20, 20, 20], [20, 20, 20, 20, 200], "ms").status).toBe("noisy"); // outlier ⇒ cv way over 25 %
    expect(judge([20, 20, 20, 20, 20, 20, 20, 20, 20], [20, 20, 20, 20, 20, 20, 20, 20, 30], "ms").status).toBe("ok");
  });
});
