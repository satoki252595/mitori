import { describe, expect, test } from "bun:test";
import type { CheckError } from "@mitori/core";
import type { CoverageReport, LineVerdict } from "../contract.ts";
import { planRetry } from "./index.ts";

const ok: CoverageReport = { missingAspects: [], unaccounted: [], moduleLineMissing: false, flows: 0, blocks: 3, truncated: false, ok: true };
const err = (line: number): CheckError => ({ at: `L${line}/section`, expected: "V05 one of s6/x", actual: "s7", code: "E_GEN_OUTPUT_INVALID" });
const bad = (line: number): LineVerdict => ({ line, errors: [err(line)], warnings: [] });
const good = (line: number): LineVerdict => ({
  line,
  value: { t: "block", id: "new:1", section: "s6/x", aspect: "learn", md: "読むこと[[1]]", claims: [] },
  errors: [],
  warnings: [],
});

describe("GEN-U-023 exactly one retry", () => {
  test("no retry for warnings only / clean replies, and never after attempt 2", () => {
    expect(planRetry([good(1), { line: 2, errors: [], warnings: ["W07"] }], ok, 1)).toBeNull();
    expect(planRetry([bad(1)], ok, 2)).toBeNull();
  });

  test("rejected lines ⇒ diff retry with at most 20 errors", () => {
    const verdicts = [...Array.from({ length: 5 }, (_, i) => bad(i + 1)), ...Array.from({ length: 30 }, (_, i) => good(i + 6))];
    const plan = planRetry(verdicts, { ...ok, blocks: 30 }, 1);
    expect(plan?.kind).toBe("diff");
    expect(plan?.errors.length).toBe(5);
    expect(plan?.previous).toEqual([]);
    const many = planRetry(
      Array.from({ length: 25 }, (_, i) => bad(i + 1)).concat(Array.from({ length: 30 }, (_, i) => good(i + 30))),
      { ...ok, blocks: 30 },
      1,
    );
    expect(many?.errors.length).toBe(20);
  });

  test("> 50 % of block lines and ≥ 6 errors ⇒ whole retry", () => {
    const verdicts = [...Array.from({ length: 6 }, (_, i) => bad(i + 1)), good(7), good(8)];
    expect(planRetry(verdicts, { ...ok, blocks: 2 }, 1)?.kind).toBe("whole");
    expect(
      planRetry(
        Array.from({ length: 5 }, (_, i) => bad(i + 1)),
        { ...ok, blocks: 0 },
        1,
      )?.kind,
    ).toBe("diff");
  });

  test("coverage gaps become MISSING lines", () => {
    const plan = planRetry([good(1)], { ...ok, missingAspects: ["interface"], moduleLineMissing: true, unaccounted: ["b_k3f9a2cq"], ok: false }, 1);
    expect(plan).toEqual({ kind: "diff", errors: [], previous: [], missing: ["aspect interface", "module line", "id b_k3f9a2cq"] });
    const trunc = planRetry([good(1)], { ...ok, truncated: true, ok: false }, 1);
    expect(trunc?.missing).toEqual(["continue after block new:1 aspect=learn: 読むこと"]);
    expect(planRetry([], { ...ok, flows: 1, ok: false }, 1)?.missing).toEqual(["more flow lines (1 written)"]);
  });
});
