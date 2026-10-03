/**
 * @mitori/gen — `verify/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type BlockLock, type ClaimChecks, unsupported, type Verdict } from "@mitori/core";

/** Verdict truth table (§7.2). Pure. */
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
  return unsupported("gen.computeVerdict", input);
}

/** Backticked identifiers of a Markdown span (L1 input). Pure. */
export function extractIdentifiers(markdownSpan: string): string[] {
  return unsupported("gen.extractIdentifiers", markdownSpan);
}
