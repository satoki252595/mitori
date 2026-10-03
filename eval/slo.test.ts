import { describe, expect, test } from "bun:test";
import { sloEntry, specOf } from "./slo.ts";

describe("EVAL-U-20 SLO rows", () => {
  test("a rate is judged by its Wilson bound, not its point estimate (quality.patch.hiddenPass: ≥ 70 % target, 60 % limit)", () => {
    // limit 60 % − 10 pp = 50 %; target 70 % − 10 pp = 60 %
    expect(sloEntry("quality.patch.hiddenPass", { successes: 27, n: 30 })).toMatchObject({ status: "green", n: 30, value: 90 });
    const mid = sloEntry("quality.patch.hiddenPass", { successes: 22, n: 30 });
    expect(mid.status).toBe("yellow"); // clears the limit's gate, not the target's
    expect(mid.value).toBeCloseTo(73.33, 1);
    expect(sloEntry("quality.patch.hiddenPass", { successes: 15, n: 30 }).status).toBe("red");
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
