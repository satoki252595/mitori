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

## #3 A human-edited placeholder kept being a placeholder (FIXED here, cross-owner — please review)
- where: doc `editBlock` (`packages/doc/src/store/store.ts`), static `placeholders()` / `hasContent()` (`apply.ts`)
- observed: a human writes into an ungenerated section's placeholder (「設計書を直す」 / the edit route) → the block is
  `human-edited` but still `kind: "placeholder"` in the placeholder slot, so `hasContent` saw no content and every
  static refresh (any facts change, e.g. after an accepted Fix) proposed 「この節はまだ生成されていません…」 back over
  the human's text (source `regen`/`static`) — a junk proposal in the prose next to the AI's real one
  (`docs/progress/ux/ux-10-proposal-standalone.png` before the fix).
- fix: `editBlock` turns a placeholder into `prose` and detaches it from the placeholder slot (6 lines). Regression
  test `DOC-U-007b` in `packages/doc/src/store/store.test.ts` (fails without the fix).
- left open: a locked static facts block still gets a proposal whenever its generated text differs from the human's
  text, even when the generated text itself did not change since the last apply (compare with the last static text
  instead). Not seen in the flows of this track.

## #4 Cross-owner edits this track made (small, additive — please keep or move)
- `packages/server/src/wiring/workspace.ts` (WP-INT): `observeDoc` also reports created proposals; the workspace
  publishes `doc.proposal.upsert` (with the suggestion-mode diff) — no package emitted it before, so an AI doc edit
  only appeared after a page reload.
- `apps/web/src/stores/doc.svelte.ts` (WP-10a): `pendingInserts()` — INSERT proposals have no block of their own, the
  proposal layer shows them after the block they follow (promoted answers were invisible).
- `packages/server/src/contract.ts`: `ROUTE_OWNERS["POST /ws/:ws/jobs/targets"] = "loop"` (with CR ux-F1).
- `apps/web/src/shell/Header.svelte` (WP-10a), the Review header declutter: the job chip no longer repeats the ready
  count the レビュー tab already shows (◆ once), and the drawer menu button is hidden while reviewing on a ≥ 1024 px
  screen (prototype 03e; the drawer stays on `pane.nav`).
- `packages/doc/src/store/store.ts` (#3 above).

## #5 `Installer` has no per-file state of a target × scope
- contract: `packages/loop/src/contract.ts` C11 `Installer`
- change: `states(target, scope, opts: { mcp: boolean; project?: { root: string; docDir: string } }): Promise<{ abs: string; rel: string; template: string; state: IntegrationState; recorded: boolean }[]>`
- why: `GET /integrations` lists every file a target × scope consists of (installed or not, hand-written or not);
  `status()` only covers the files mitori recorded, without their scope root, so a project install of one repo could
  not be told from another's.
- workaround in place: `makeInstaller` returns `states` as an extra member; `packages/server/src/wiring/integrations.ts`
  reads it structurally. `project` still travels in the options object (cr-requests/WP-11.md #2).
- also: compose (`packages/server/src/compose.ts`, WP-INT) now creates the installer and merges the integration
  handlers; `POST /ws/:ws/init {agentsBlock: true}` installs the AGENTS.md block (spec §11.3).
