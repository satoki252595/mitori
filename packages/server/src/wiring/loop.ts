/**
 * The workspace's loop part (server spec §10): `createLoop` (`@mitori/loop`, WP-08b) fed from the workspace's own
 * services, plus the members of its result that the contract types leave out.
 *
 * CR-PENDING(loop-wiring) (docs/design/cr-requests/loop-wiring.md): `createLoop` returns more than the contract
 * names — `close()` (lifecycle), `threadBundle`, `checkpoints`, and `jobs.list` — and `LoopDeps` has no `fs` / `env`
 * (passed as extra properties). The structural types below say exactly which extras the server reads.
 */

import type { Anchor, AnchorInput, Checkpoint, FsReader, Job, JobState, ThreadId } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import type { BundleBuilder, CapturedAnchor, createLoop } from "@mitori/loop";

/** Ports `LoopDeps` has no member for (read structurally by `createLoop`). */
export interface LoopDepsExt {
  gh?: string;
  fs: FsReader;
  env: { PATH?: string | undefined; HOME?: string | undefined };
}

/** What the server uses of `createLoop`'s result beyond the contract. */
export interface LoopExtras {
  /** Stop pipelines, close parked engine processes and the side repo's blob reader. */
  close(): Promise<void>;
  /** `GET /threads/:th/bundle`, pull / copy bundles of a thread. */
  threadBundle(id: ThreadId, opts?: { budget?: number; lines?: boolean; mode?: "pull" | "copy" }): Promise<string>;
  /** `GET /checkpoints`. */
  checkpoints(): Checkpoint[];
  /** Anchor capture outside the write slot [CR m1-68]. */
  capture(input: AnchorInput, previous: Anchor | null): Promise<CapturedAnchor>;
  /** `GET /jobs` (the contract's `JobRunner` has no list). */
  listJobs(q: { state?: JobState; thread?: ThreadId; limit?: number; cursor?: string }): { items: Job[]; next: string | null };
  /** Bundle builder (copy-as-prompt). */
  bundles: BundleBuilder;
}

/** Narrow the result of `createLoop` to the extras the server needs. */
export function loopExtras(loop: ReturnType<typeof createLoop>): LoopExtras {
  const x = loop as ReturnType<typeof createLoop> & Partial<Pick<LoopExtras, "close" | "threadBundle" | "checkpoints">>;
  const jobs = loop.jobs as typeof loop.jobs & { list?: LoopExtras["listJobs"] };
  if (!x.close || !x.threadBundle || !x.checkpoints || !jobs.list)
    throw new MitoriError("E_INTERNAL", "createLoop does not provide the lifecycle extras the server needs (loop-wiring CR)");
  const { close, threadBundle, checkpoints } = x;
  const listJobs = jobs.list.bind(jobs);
  return {
    close: () => close.call(loop),
    threadBundle: (id, opts) => threadBundle.call(loop, id, opts),
    checkpoints: () => checkpoints.call(loop),
    capture: (input, previous) => loop.capture(input, previous),
    listJobs,
    bundles: loop.bundles,
  };
}
