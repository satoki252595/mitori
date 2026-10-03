/**
 * @mitori/loop — `jobs/` (owner: WP-08b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */

import type { Anchor, AnchorInput } from "@mitori/core";
import type { BundleBuilder, CapturedAnchor, GateRunner, GitSafety, JobRunner, LoopDeps, ReviewEngine } from "../contract.ts";
import { createLoop as assemble } from "./assemble.ts";

/**
 * Factory (per workspace): the review engine, bundle builder, git safety (side repo), gate runner and job runner,
 * assembled from the ports in `deps` (see `assemble.ts`). The returned object also carries `close()` (lifecycle; not part
 * of the contract type — CR-PENDING(loop-wiring), docs/design/cr-requests/loop-wiring.md #2).
 */
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
  return assemble(deps);
}
