/**
 * @mitori/gen — `line/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { CoverageReport, LineAssembler, LineValidator, LineVerdict, RetryPlan, ValidationContext } from "../contract.ts";
import { createAssembler } from "./assembler.ts";
import { planRetryImpl } from "./retry.ts";
import { GenLineValidator } from "./validator.ts";

/** Factory. */
export function createLineValidator(ctx: ValidationContext): LineValidator {
  return new GenLineValidator(ctx);
}

/** Factory. */
export function createLineAssembler(): LineAssembler {
  return createAssembler();
}

/** Decide whether to retry (null ⇒ no retry). */
export function planRetry(verdicts: readonly LineVerdict[], coverage: CoverageReport, attempt: 1 | 2): RetryPlan | null {
  return planRetryImpl(verdicts, coverage, attempt);
}
