/**
 * EX-09: where the Review route opens its left body — on the block the reviewed job is anchored on: the first of its
 * threads anchored in the doc, else the block of its first doc proposal (an insert has none); null = the job touches
 * no block (the body opens at §0). Pure.
 */
import type { Anchor, BlockId, JobDetail, ThreadId } from "@mitori/core";

export function reviewAnchor(
  d: Pick<JobDetail, "threads" | "proposalViews">,
  threadOf: (id: ThreadId) => { anchor: Pick<Anchor, "doc"> } | undefined,
): BlockId | null {
  for (const id of d.threads) {
    const b = threadOf(id)?.anchor.doc?.block;
    if (b) return b;
  }
  return d.proposalViews.find((p) => p.block)?.block ?? null;
}
