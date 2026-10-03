/**
 * @mitori/server — `wiring/` (owner: WP-INT). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import type { AnchoredItem, ReanchorReport } from "@mitori/anchor";
import { type AnchorHealth, type Cite, type ClaimChecks, type ClaimId, type IndexDelta, type ThreadId, unsupported } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { ThreadReanchorUpdate } from "@mitori/loop";

/**
 * Build the re-anchoring input for one delta (§4.3): every claim cite whose path is in `delta.changed`/`renames`
 * (`kind: "cite"`, in claim-id then cite-index order) followed by every non-resolved thread whose code member's
 * path changed (`kind: "thread"`, thread-id order). Doc-primary threads contribute their code member only when it
 * was captured explicitly; otherwise they follow their claim. Pure given the stores.
 */
export function assembleAnchoredItems(
  delta: IndexDelta,
  doc: Pick<DocStore, "index">,
  threads: readonly { id: ThreadId; code?: Cite | null }[],
): AnchoredItem[] {
  return unsupported("server.assembleAnchoredItems", delta, doc, threads);
}

/** Distribute a report back (same order as the items) [§4.3]. Pure. */
export function distributeReanchor(
  items: readonly AnchoredItem[],
  report: ReanchorReport,
): {
  /** Claim updates for `DocStore.setClaimChecks` (moved cites re-rendered; overlapped ⇒ verdict `stale`). */
  claims: { id: ClaimId; cites: Cite[]; checks: ClaimChecks; stale: boolean }[];
  /** Thread updates for `ReviewEngine.applyReanchor`. */
  threads: ThreadReanchorUpdate[];
  /** Counts by health (metrics, `mitori doctor`). */
  counts: Record<AnchorHealth, number>;
} {
  return unsupported("server.distributeReanchor", items, report);
}
