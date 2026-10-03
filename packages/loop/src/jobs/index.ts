/**
 * @mitori/loop — `jobs/` (owner: WP-08b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */

import type { Anchor, AnchorInput } from "@mitori/core";
import { unsupported } from "@mitori/core";
import type { BundleBuilder, CapturedAnchor, GateRunner, GitSafety, JobRunner, LoopDeps, ReviewEngine } from "../contract.ts";

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
  /**
   * Capture an anchor OUTSIDE the write slot (async file / block reads, `AnchorEngine` stamping); the server then
   * calls `review.create(req, by, captured)` / `review.patch(id, req, captured)` inside the slot [CR m1-68].
   */
  capture(input: AnchorInput, previous: Anchor | null): Promise<CapturedAnchor>;
} {
  return unsupported("loop.createLoop", deps);
}
