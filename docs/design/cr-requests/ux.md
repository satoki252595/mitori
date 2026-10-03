# ux (finishing pass) — change requests (2026-10-04)

Track ux of the finishing pass (`docs/progress/ux.md`). Each request names its workaround (`CR-PENDING(ux)` in the code).
Applied contract change of this track: **CR ux-F1** (`POST /ws/:ws/jobs/targets`, ledger §6) — the only `packages/core`
edit, tiny and additive.

## #1 The Fix code targets are not a `ReviewEngine` method
- contract: `packages/loop/src/contract.ts` `ReviewEngine`
- change: `targets(anchor: Anchor, opts: { selStart?: number; selEnd?: number; text?: string; limit?: number }): CodeTargets`
  (deterministic, token-free; the same answer the router would turn into a write scope for the cites).
- why: the server route calls the pure resolver `resolveCodeTargets` (`packages/loop/src/review/targets.ts`) with the
  workspace's doc / indexer / deny globs directly; `createLoop` (WP-08b's `jobs/assemble.ts`) has no seam for it.
- workaround in place: `packages/loop/src/review/index.ts` exports `resolveCodeTargets` (a non-contract name);
  `packages/server/src/wiring/loop-routes.ts` builds its deps.
- urgency: nice to have (behaviour is complete).

## #2 Removing a cited target from a Fix's write scope
- contract: router `deriveWriteScope` (loop spec §3.2/§3.3), `ContextAdjust.remove`
- change: a removed `code:<path>:<a>-<b>` key of a range that comes from the anchor's cites leaves the WRITE paths
  (the range may stay as read context). Today `code:` items of anchored ranges are `removable: false` (the anchor body).
- why: the Composer shows the cites of the selected sentence as 「対象コード」. For a whole-block anchor that cites many
  files a user may want fewer files written; the router always writes every cite (spec §3.2), so the chip cannot offer
  an honest ×.
- workaround in place: cited targets have no × (tooltip: select another sentence to leave it out); picked candidates
  and `@` mentions do (they are `context.add`). Narrowing = selecting the sentence (the claim's own cites only).
- urgency: before the router is touched again (WP-08c).

## #3 A human-edited static placeholder gets a "revert to placeholder" proposal on every static refresh
- contract: doc `applyStatic` (locked static blocks ⇒ proposals), server `wiring/static-input.ts`
- observed: a human writes into an ungenerated section's placeholder (「設計書を直す」 / the edit route) → the block is
  `human-edited`; the next `applyStatic` (any facts change, e.g. after an accepted Fix) proposes
  「この節はまだ生成されていません…」 for it (source `regen`/`static`). Seen in `test/int/ux.test.ts` (UX-INT-02).
- change: a static slot whose generated text did NOT change since the last apply proposes nothing for a locked block
  (compare with the last static text, not the human's), and a `placeholder` slot never proposes over human text.
- workaround: none (the proposal can be rejected; it is harmless but noisy in the Inbox and the prose).
- urgency: before generation-free docs are edited by hand at scale.

## #4 Cross-owner edits this track made (small, additive — please keep or move)
- `packages/server/src/wiring/workspace.ts` (WP-INT): `observeDoc` also reports created proposals; the workspace
  publishes `doc.proposal.upsert` (with the suggestion-mode diff) — no package emitted it before, so an AI doc edit
  only appeared after a page reload.
- `apps/web/src/stores/doc.svelte.ts` (WP-10a): `pendingInserts()` — INSERT proposals have no block of their own, the
  proposal layer shows them after the block they follow (promoted answers were invisible).
- `packages/server/src/contract.ts`: `ROUTE_OWNERS["POST /ws/:ws/jobs/targets"] = "loop"` (with CR ux-F1).
