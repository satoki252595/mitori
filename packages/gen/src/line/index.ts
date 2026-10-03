/**
 * @mitori/gen — `line/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { CoverageReport, LineAssembler, LineValidator, LineVerdict, RetryPlan, ValidationContext } from "../contract.ts";

/** Factory. */
export function createLineValidator(ctx: ValidationContext): LineValidator {
  return unsupported("gen.createLineValidator", ctx);
}

/** Factory. */
export function createLineAssembler(): LineAssembler {
  return unsupported("gen.createLineAssembler");
}

/** Decide whether to retry (null ⇒ no retry). */
export function planRetry(verdicts: readonly LineVerdict[], coverage: CoverageReport, attempt: 1 | 2): RetryPlan | null {
  return unsupported("gen.planRetry", verdicts, coverage, attempt);
}
