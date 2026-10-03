import { describe, expect, test } from "bun:test";
import { DEFAULT_MIN_N, EVAL_SEED, GATE_MARGIN, judgeRate, rng, seededShuffle, wilson, wilsonLower, wilsonUpper, Z_ONE_SIDED_95 } from "./stats.ts";

describe("EVAL-U-01 Wilson bounds", () => {
  test("matches the textbook interval: p = 0.5, n = 100, z = 1.96 → (0.4038, 0.5962)", () => {
    const w = wilson(0.5, 100, 1.96);
    expect(w.lower).toBeCloseTo(0.4038, 4);
    expect(w.upper).toBeCloseTo(0.5962, 4);
  });

  test("the bounds stay in [0, 1] at the edges and tighten with n", () => {
    expect(wilsonLower(0, 30)).toBe(0);
    expect(wilsonUpper(1, 30)).toBe(1);
    expect(wilsonLower(1, 30)).toBeGreaterThan(0.9);
    expect(wilsonUpper(0, 30)).toBeLessThan(0.1);
    expect(wilsonLower(0.75, 300)).toBeGreaterThan(wilsonLower(0.75, 30));
    expect(wilsonUpper(0.75, 300)).toBeLessThan(wilsonUpper(0.75, 30));
  });

  test("rejects impossible input", () => {
    expect(() => wilson(1.2, 30)).toThrow(RangeError);
    expect(() => wilson(0.5, 0)).toThrow(RangeError);
  });

  test("the default z is the one-sided 95 % quantile", () => {
    expect(Z_ONE_SIDED_95).toBeCloseTo(1.645, 3);
    expect(GATE_MARGIN).toBe(0.1);
    expect(DEFAULT_MIN_N).toBe(30);
  });
});

describe("EVAL-U-02 rate gate (MILESTONES WP-12: n = 30, p = 0.75 passes a 0.70 threshold)", () => {
  test("acceptance: 75 % of 30 against 70 % passes (Wilson lower bound 0.603 ≥ 0.60)", () => {
    const v = judgeRate({ successes: 0.75 * 30, n: 30 }, 0.7);
    expect(v.status).toBe("pass");
    expect(v.p).toBe(0.75);
    expect(v.bound).toBeCloseTo(0.6031, 3);
    expect(v.required).toBeCloseTo(0.6, 10);
  });

  test("the gate sits near 23 of 30: 23 passes, 22 and 21 fail", () => {
    expect(judgeRate({ successes: 23, n: 30 }, 0.7).status).toBe("pass");
    expect(judgeRate({ successes: 22, n: 30 }, 0.7).status).toBe("fail");
    expect(judgeRate({ successes: 21, n: 30 }, 0.7).status).toBe("fail");
  });

  test("a true 75 % rarely fails the Wilson gate but often fails the raw 70 % comparison", () => {
    // P(X ≤ 20 of 30) at p = 0.75 is the raw failure the review (SC-14) computed at ≈ 20 %; the Wilson gate needs ≥ 23 − ... : check the raw rule is the worse one
    const raw = [...Array(31).keys()].filter((x) => x / 30 < 0.7).length; // 0..20 fail the raw rule
    const wil = [...Array(31).keys()].filter((x) => judgeRate({ successes: x, n: 30 }, 0.7).status !== "pass").length; // 0..22 fail the Wilson rule
    expect(raw).toBe(21);
    expect(wil).toBe(23);
  });

  test("two runs of 22/30 pooled (44/60) pass where each alone fails", () => {
    expect(judgeRate({ successes: 22, n: 30 }, 0.7).status).toBe("fail");
    const pooled = judgeRate(
      [
        { successes: 22, n: 30 },
        { successes: 22, n: 30 },
      ],
      0.7,
    );
    expect(pooled).toMatchObject({ status: "pass", n: 60, runs: 2 });
    expect(pooled.bound).toBeCloseTo(0.6309, 3);
  });

  test("below minN the answer is `insufficient`, never `pass`", () => {
    expect(judgeRate({ successes: 20, n: 20 }, 0.7).status).toBe("insufficient");
    expect(judgeRate({ successes: 20, n: 20 }, 0.7, { minN: 15 }).status).toBe("pass");
    expect(judgeRate([], 0.7).status).toBe("insufficient");
  });

  test("dir max compares the upper bound with threshold + margin (hallucination ≤ 5 %)", () => {
    const ok = judgeRate({ successes: 1, n: 30 }, 0.05, { dir: "max" });
    expect(ok.status).toBe("pass");
    expect(ok.required).toBeCloseTo(0.15, 10);
    expect(ok.bound).toBeCloseTo(0.1364, 3);
    expect(judgeRate({ successes: 6, n: 30 }, 0.05, { dir: "max" }).status).toBe("fail");
  });

  test("a stricter margin and a different minN come from the caller (budgets `minN`)", () => {
    expect(judgeRate({ successes: 23, n: 30 }, 0.7, { margin: 0.02 }).status).toBe("fail");
    expect(judgeRate({ successes: 40, n: 40 }, 0.7, { minN: 50 }).status).toBe("insufficient");
  });

  test("impossible counts throw", () => {
    expect(() => judgeRate({ successes: 31, n: 30 }, 0.7)).toThrow(RangeError);
    expect(() => judgeRate({ successes: -1, n: 30 }, 0.7)).toThrow(RangeError);
  });
});

describe("EVAL-U-03 reproducible randomness (EVAL_SEED)", () => {
  test("the seed is 20261003", () => {
    expect(EVAL_SEED).toBe(20261003);
  });

  test("the same seed gives the same shuffle; another seed another; the input is untouched", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(xs)).toEqual(seededShuffle(xs));
    expect(seededShuffle(xs, 1)).not.toEqual(seededShuffle(xs, 2));
    expect([...seededShuffle(xs)].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBe(0);
    expect(seededShuffle(xs)).not.toEqual(xs);
  });

  test("rng is in [0, 1) and deterministic", () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(x).toBe(b());
    }
  });
});
