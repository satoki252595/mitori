import { describe, expect, test } from "bun:test";
import type { ClaimChecks, Verdict } from "./domain.ts";
import { computeVerdict } from "./verdict.ts";

const ok: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-10-03T00:00:00.000Z" };

describe("CR m1-17 computeVerdict (gen spec §7.2 + UXP-06)", () => {
  test.each([
    ["human-verified wins over everything", { checks: { ...ok, l0: false }, cites: 1, anyStale: true, lock: "human-verified" as const }, "human-verified"],
    ["stale cite", { checks: ok, cites: 1, anyStale: true }, "stale"],
    ["L2 fail is stale", { checks: { ...ok, l2: false }, cites: 1, anyStale: false }, "stale"],
    ["L0 fail", { checks: { ...ok, l0: false }, cites: 1, anyStale: false }, "unsupported"],
    ["L3 U", { checks: { ...ok, l3: "U" as const }, cites: 1, anyStale: false }, "unsupported"],
    ["no cite", { checks: ok, cites: 0, anyStale: false }, "inferred"],
    ["L1 fail without L3 S is inferred (row 5)", { checks: { ...ok, l1: "fail" as const }, cites: 1, anyStale: false }, "inferred"],
    ["L1 fail with L3 S", { checks: { ...ok, l1: "fail" as const, l3: "S" as const }, cites: 1, anyStale: false }, "verified"],
    ["L3 P", { checks: { ...ok, l3: "P" as const }, cites: 1, anyStale: false }, "inferred"],
    ["L1 vacuous", { checks: { ...ok, l1: "vacuous" as const }, cites: 2, anyStale: false }, "cited"],
    ["L1 pass", { checks: ok, cites: 1, anyStale: false }, "verified"],
  ])("%s", (_name, input, want) => {
    expect(computeVerdict(input)).toBe(want as Verdict);
  });
});
