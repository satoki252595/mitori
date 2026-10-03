/**
 * @mitori/loop — `jobs/` (owner: WP-08b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { BundleBuilder, GateRunner, GitSafety, JobRunner, LoopDeps, ReviewEngine } from "../contract.ts";

/** Factory (per workspace). */
export function createLoop(deps: LoopDeps): {
  /** Review engine. */
  review: ReviewEngine;
  /** Jobs. */
  jobs: JobRunner;
  /** Bundles. */
  bundles: BundleBuilder;
  /** Git safety. */
  git: GitSafety;
  /** Gate runner. */
  gates: GateRunner;
} {
  return unsupported("loop.createLoop", deps);
}
