import { describe, expect, test } from "bun:test";
import { availableParallelism } from "node:os";
import { hardwareInfo, parsePerfCores, parsePerfLevels } from "./hardware.ts";

describe("CR m1-116 authoritative hardware lookup", () => {
  test("valid highest-tier logical-core counts survive; unknown / malformed / impossible counts retain the fallback", () => {
    expect(parsePerfCores("6\n", 18)).toBe(6);
    for (const s of ["", "unknown oid", "0", "-1", "6.5", "19", "1e1", "6\n12"]) expect(parsePerfCores(s, 18)).toBeNull();
  });
  test("CR perf-tier-1 counts Super plus Performance and excludes Efficiency without accepting malformed tiers", () => {
    expect(parsePerfLevels("Super\n6\nPerformance\n12\n", 2, 18)).toBe(18);
    expect(parsePerfLevels("Performance\n8\nEfficiency\n2\n", 2, 10)).toBe(8);
    expect(parsePerfLevels("Super\n4\nEfficiency\n6\n", 2, 10)).toBe(4);
    expect(parsePerfLevels("Performance\n8\n", 1, 8)).toBe(8);
    for (const s of [
      "",
      "Super\n6",
      "Super\n0\nPerformance\n12",
      "Super\n6\nPerformance\n19",
      "Super\n6\nUnknown\n12",
      "Super\n6\nPerformance\n13",
      "Efficiency\n6\nEfficiency\n12",
    ]) {
      expect(parsePerfLevels(s, 2, 18)).toBeNull();
    }
  });
  test("the local lookup returns available cores and a bounded optional performance-core count", () => {
    const hw = hardwareInfo();
    expect(hw.cores).toBe(availableParallelism());
    expect(hw.perfCores === null || (hw.perfCores > 0 && hw.perfCores <= hw.cores)).toBe(true);
    if (process.platform !== "darwin") expect(hw.perfCores).toBeNull();
  });
});
