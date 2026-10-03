import { describe, expect, test } from "bun:test";
import { sloEntry, specOf } from "./slo.ts";

describe("EVAL-U-20 SLO rows", () => {
  test("a rate is judged by its Wilson bound, not its point estimate (quality.patch.hiddenPass: ≥ 70 % target, 60 % limit)", () => {
    expect(sloEntry("quality.patch.hiddenPass", { successes: 27, n: 30 })).toMatchObject({ status: "green", n: 30, value: 90 });
    // the acceptance example: 75 % of 30 against the 70 % threshold passes (bound 60.3 % ≥ the 60 % limit)
    const accept = sloEntry("quality.patch.hiddenPass", { successes: 22.5, n: 30 });
    expect(accept.status).toBe("green");
    expect(accept.bound).toBeCloseTo(60.31, 1);
    expect(sloEntry("quality.patch.hiddenPass", { successes: 23, n: 30 }).status).toBe("green");
    expect(sloEntry("quality.patch.hiddenPass", { successes: 15, n: 30 }).status).toBe("red");
  });

  test("regression: the 10 pp margin is not taken off the limit a second time (MILESTONES M3: Wilson 下限 ≥ 60 %)", () => {
    // 22 of 30 = 73 % has a bound of 58.5 %: it fails judgeRate(…, 0.7) and so must be red, not yellow
    const mid = sloEntry("quality.patch.gateFirst", { successes: 22, n: 30 });
    expect(mid.value).toBeCloseTo(73.33, 1);
    expect(mid.bound).toBeCloseTo(58.5, 0);
    expect(mid.status).toBe("red");
    expect(sloEntry("quality.patch.gateFirst", { successes: 21, n: 30 }).status).toBe("red");
    // two runs of 22 / 30 pooled (44 / 60) clear it
    expect(sloEntry("quality.patch.gateFirst", { successes: 44, n: 60 }).status).toBe("green");
  });

  test("a large population is judged close to its point estimate (citation L0: 99 % target, 97 % limit, minN 100)", () => {
    expect(sloEntry("gen.cite.l0", { successes: 4950, n: 5000 }).status).toBe("green"); // 99.0 %
    expect(sloEntry("gen.cite.l0", { successes: 4900, n: 5000 }).status).toBe("yellow"); // 98.0 %
    expect(sloEntry("gen.cite.l0", { successes: 4800, n: 5000 }).status).toBe("red"); // 96.0 %
    expect(sloEntry("gen.cite.l0", { successes: 90, n: 99 }).status).toBe("insufficient");
  });

  test("fewer observations than the budget's minN are `insufficient`, even at 100 %", () => {
    const e = sloEntry("quality.patch.hiddenPass", { successes: 12, n: 12 });
    expect(e.status).toBe("insufficient");
    expect(e.value).toBe(100);
  });

  test("a scalar budget compares directly and honours the direction", () => {
    expect(sloEntry("ui.inp", { value: 90 }).status).toBe("green");
    expect(sloEntry("ui.inp", { value: 150 }).status).toBe("yellow");
    expect(sloEntry("ui.inp", { value: 250 }).status).toBe("red");
    expect(sloEntry("asset.precompressed", { value: 100 }).status).toBe("green");
    expect(sloEntry("asset.precompressed", { value: 90 }).status).toBe("red");
  });

  test("a rate against a non-rate budget is a bug; an unknown id throws", () => {
    expect(() => sloEntry("ui.inp", { successes: 1, n: 30 })).toThrow("pct or ratio");
    expect(() => specOf("no.such.id")).toThrow("no budget");
  });

  test("explicit specs (the smoke row) and the synthetic flag", () => {
    const row = sloEntry({ id: "smoke.x", target: 100, limit: 100, unit: "pct", dir: "min" }, { value: 100 }, { synthetic: true });
    expect(row).toMatchObject({ status: "green", synthetic: true });
  });

  test("a max-direction rate uses the upper bound (hallucination)", () => {
    const spec = { id: "h", target: 5, limit: 10, unit: "pct" as const, dir: "max" as const };
    expect(sloEntry(spec, { successes: 0, n: 40 }).status).toBe("green");
    expect(sloEntry(spec, { successes: 12, n: 40 }).status).toBe("red");
  });
});
