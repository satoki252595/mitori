/**
 * The ONE verdict truth table [CR m1-17]: gen's Verifier and the doc store both call it, so a claim shows the same
 * badge wherever it is computed. Gen spec §7.2 (first matching row) plus R1 UXP-06 (`cited` for an L1 vacuous
 * check). Pure.
 */
import type { BlockLock, ClaimChecks, Verdict } from "./domain.ts";

/**
 * human-verified lock → stale cite → L0 fail or L3 U → no cite → L1 fail (L3 ≠ S) → L3 P → L1 vacuous (L3 ≠ S) →
 * verified.
 */
export function computeVerdict(input: {
  /** Checks. */
  checks: ClaimChecks;
  /** Cite count. */
  cites: number;
  /** Any cite stale (overlap/outdated since stamping). */
  anyStale: boolean;
  /** Block lock. */
  lock?: BlockLock;
}): Verdict {
  const { checks, cites, anyStale, lock } = input;
  if (lock === "human-verified") return "human-verified";
  if (anyStale || !checks.l2) return "stale";
  if (!checks.l0 || checks.l3 === "U") return "unsupported";
  if (cites === 0) return "inferred";
  if (checks.l1 === "fail" && checks.l3 !== "S") return "inferred";
  if (checks.l3 === "P") return "inferred";
  if (checks.l1 === "vacuous" && checks.l3 !== "S") return "cited";
  return "verified";
}
