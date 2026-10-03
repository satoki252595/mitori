/**
 * @mitori/gen — `verify/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { BlockLock, ClaimChecks, Verdict } from "@mitori/core";
import { codeSpans } from "../line/mdscan.ts";

/**
 * Verdict truth table (§7.2, first matching row; R1 UXP-06 adds `cited` for L1 vacuous). Pure.
 * human-verified lock → stale cite → L0 fail or L3 U → no cite → L1 fail (L3 ≠ S) → L3 P → L1 vacuous (L3 ≠ S) → verified.
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

/** Backticked identifiers of a Markdown span (L1 input). Pure. */
export function extractIdentifiers(markdownSpan: string): string[] {
  return codeSpans(markdownSpan).map((s) => s.trim());
}
