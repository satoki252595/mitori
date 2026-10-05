import { describe, expect, test } from "bun:test";
import { availableParallelism } from "node:os";
import { hardwareInfo, parsePerfCores } from "./hardware.ts";

describe("CR m1-116 authoritative hardware lookup", () => {
  test("valid highest-tier logical-core counts survive; unknown / malformed / impossible counts retain the fallback", () => {
    expect(parsePerfCores("6\n", 18)).toBe(6);
    for (const s of ["", "unknown oid", "0", "-1", "6.5", "19", "1e1", "6\n12"]) expect(parsePerfCores(s, 18)).toBeNull();
  });
  test("the local lookup returns available cores and a bounded optional highest-tier logical-core count", () => {
    const hw = hardwareInfo();
    expect(hw.cores).toBe(availableParallelism());
    expect(hw.perfCores === null || (hw.perfCores > 0 && hw.perfCores <= hw.cores)).toBe(true);
    if (process.platform !== "darwin") expect(hw.perfCores).toBeNull();
  });
});
