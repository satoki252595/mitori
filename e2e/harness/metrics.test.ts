import { describe, expect, test } from "bun:test";
import { checkBudget, EVENT_TIMING_FLOOR_MS, inpSummary, medianOfRuns, percentile } from "./metrics.ts";
import { findSpecs, playwrightArgs } from "./run.ts";

describe("E2EH-U-01 INP summary (testing spec §6.6)", () => {
  test("nearest-rank percentiles", () => {
    expect(percentile([10, 20, 30, 40], 75)).toBe(30);
    expect(percentile([10, 20, 30, 40], 98)).toBe(40);
    expect(percentile([], 75)).toBe(0);
  });

  test("interactions below the 16 ms reporting floor are counted as 16 ms", () => {
    const s = inpSummary([{ duration: 200 }], 10);
    expect(s).toMatchObject({ count: 10, reported: 1, max: 200 });
    expect(s.p75).toBe(EVENT_TIMING_FLOOR_MS); // 9 of 10 interactions were fast
    expect(s.p98).toBe(200);
  });

  test("60 interactions: p75 and p98 follow the slow tail", () => {
    const reported = [
      ...Array.from({ length: 45 }, () => ({ duration: 40 })),
      ...Array.from({ length: 13 }, () => ({ duration: 120 })),
      { duration: 190 },
      { duration: 260 },
    ];
    const s = inpSummary(reported);
    expect(s.count).toBe(60);
    expect(s.p75).toBe(40);
    expect(s.p98).toBe(190);
    expect(s.max).toBe(260);
  });

  test("with no interactions at all the summary is zero, not NaN", () => {
    expect(inpSummary([])).toEqual({ count: 0, reported: 0, p75: 0, p98: 0, max: 0 });
  });

  test("the median of five repeated runs", () => {
    const runs = [80, 120, 95, 70, 300].map((p75) => ({ count: 1, reported: 1, p75, p98: p75, max: p75 }));
    expect(medianOfRuns(runs)).toBe(95);
  });
});

describe("E2EH-U-02 budget checks", () => {
  test("ui.dom.typical: under target, over target (warning), over limit (failure)", () => {
    expect(checkBudget("ui.dom.typical", 4000)).toMatchObject({ failed: false, warned: false });
    expect(checkBudget("ui.dom.typical", 6000)).toMatchObject({ failed: false, warned: true });
    expect(checkBudget("ui.dom.typical", 15001)).toMatchObject({ failed: true, warned: false });
  });

  test("ui.inp is p75 100 / p98 200 ms", () => {
    expect(checkBudget("ui.inp", 100).warned).toBe(false);
    expect(checkBudget("ui.inp", 150).warned).toBe(true);
    expect(checkBudget("ui.inp", 201).failed).toBe(true);
  });

  test("dir min budgets mirror it", () => {
    expect(checkBudget("asset.precompressed", 100)).toMatchObject({ failed: false, warned: false });
    expect(checkBudget("asset.precompressed", 99)).toMatchObject({ failed: true });
  });

  test("an unknown budget id throws instead of silently passing", () => {
    expect(() => checkBudget("ui.nope", 1)).toThrow("no budget");
  });
});

describe("E2EH-U-03 runner arguments", () => {
  test("chromium is the default project, perf runs with one worker", () => {
    expect(playwrightArgs(["--grep", "@wp10a"])).toEqual(["--grep", "@wp10a", "--project=chromium"]);
    expect(playwrightArgs(["--project", "webkit"])).toEqual(["--project", "webkit"]);
    expect(playwrightArgs(["--project=perf"])).toEqual(["--project=perf", "--workers=1"]);
    expect(playwrightArgs(["--project=perf", "--workers=2"])).toEqual(["--project=perf", "--workers=2"]);
  });

  test("the harness' own self-test is found; node_modules is not", () => {
    expect(findSpecs()).toContain("harness/harness.e2e.ts");
    expect(findSpecs().some((f) => f.includes("node_modules"))).toBe(false);
  });
});
