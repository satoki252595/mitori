# WP-06b — change requests (gen S9 / on-demand / translation, 2026-10-04)

Requests found while implementing `packages/gen/src/{incremental,ondemand,translate}/` and the CR m1-120 S5 items.
Each local workaround is marked `CR-PENDING(WP-06b)` in the code.

## R1 `DocIndex.modules[m].ifaceDigest` must stay "the digest the page was generated against"
- contract: `packages/core/src/domain.ts` — `DocModuleEntry.ifaceDigest`; `packages/doc/src/contract.ts` — `DocStore`
- change: `applyStatic` keeps the stored `ifaceDigest` of a module whose section has generated content (it only
  seeds it for new modules), and gen stamps it when a page is (re)generated:
  ```ts
  /** Interface digests the module pages were (re)generated against (S9 early cutoff, gen §11.3 R1/R4). */
  stampModules(entries: { module: ModuleId; ifaceDigest: Xxh3 }[]): void; // DocStore
  ```
- why: R1 compares the current interface digest with the one the page was generated against. Today `applyStatic`
  (`packages/doc/src/store/apply.ts` `syncModules`) overwrites the field with the current digest on every static
  refresh, which the composition root runs right after `gen.onIndexDelta`; the next delta no longer sees the change, and
  a doc generated on another machine (committed `doc.index.json`) loses the signal entirely.
- workaround in place: `packages/gen/src/incremental/state.ts` keeps gen's own baselines in `gen_meta` (`s9`), set by the
  run's task-done hook and seeded from the doc index the first time a page is seen (before the static refresh).
- urgency: nice to have (correct within one workspace DB; a fresh machine re-seeds from the current digest and misses
  interface changes made while the doc was not open).

## R2 `DocStore.setQuestions` (CR m1-18, deferred to WP-06b's questions prompt)
- contract: `packages/doc/src/contract.ts` — `DocStore`
- change:
  ```ts
  /** Replace the open-question list of §13 (gen `question` lines; ids kept for unchanged texts). Returns the blocks written. */
  setQuestions(list: { section?: SectionId; text: string; cites: RawCite[] }[], gen: BlockGenInfo): BlockId[];
  ```
- why: gen spec §5.6.10 / §13: the list is written as is (≤ 15 raw questions) or consolidated by `gen.questions`. There
  is no store API for it.
- workaround in place: `packages/gen/src/orchestrator/questions.ts` writes `kind: "question"` blocks into `s13` through
  `applyGenerated` (unchanged texts keep their blocks; an empty list never wipes the section; locked blocks stay).
- urgency: nice to have (the workaround renders correctly; a store-owned list could render the section link and cites as
  chips instead of code spans).

## R3 `GenOrchestrator.promoteAnswer` — Ask answer → doc (gen §12, loop spec §2.6.2)
- contract: `packages/gen/src/contract.ts` — `GenOrchestrator`; `packages/loop/src/contract.ts` — the loop deps
- change:
  ```ts
  /** Ask answer → insert proposal after `after` (kind faq | deepdive, source answer_promote); `[[path:a-b]]` cites become stamped claims. No LLM. */
  promoteAnswer(input: { thread: ThreadId; md: string; after: BlockId; kind: "faq" | "deepdive"; model?: ModelId; engine?: EngineId; title?: string }): Promise<ProposalId>;
  ```
  and a loop port (e.g. `LoopDeps.promoteAnswer`) the server wires to it, used by `ReviewEngine.promote(id, "doc")`.
- why: MILESTONES WP-06b 「Ask 回答の『文書に追記』（server の配線で loop → gen）」. Loop's current `promote` proposes the
  link-converted Markdown without claims, so the accepted block's cites are not stamped claims (no verdicts, no
  staleness) and the proposal has no `kind`.
- workaround in place: implemented as `GenInternal.promoteAnswer` (`packages/gen/src/ondemand/answer.ts`, tested), not on
  the public interface.
- urgency: before M3's thread → doc flow is user-facing.

## R4 Composition root: running suggestions (no contract change, for WP-INT / WP-09)
- `POST /ws/:ws/gen/suggestions/:sg/run` should call `gen.start(view.estimate.id)`: every S9 suggestion and every
  `syncBlocks(…, {confirm: false})` / `expand` / `translate` / `simplify` estimate is stored in `gen_estimates` with its
  trigger (`incremental` / `ondemand`) and lane (`doc`), so `start` runs it as such. Suggestion estimates stay valid for
  24 h (still bound to the index digest: a new delta recomputes the list anyway).
- `syncBlocks` results of `job.accepted` / `round.completed` are not part of `onIndexDelta`'s list; the server merges them
  into `SuggestionView[]` (reason `job_accepted` / `round_completed`).
- §11.3's 2 s quiet period is not a wait inside `onIndexDelta` (the server awaits it in the delta chain): the list is
  recomputed from state on every delta (baselines + claim verdicts), so a burst of saves converges on the same list.
- `IncrementalOutcome.staticRefreshed` is always `[]`: the static refresh is the composition root's `applyStatic` after
  S9 (DOMAIN_WIRING `index.delta`).

## R5 Spec text (gen spec §5.2 BLOCKS, §5.6.14) — doc.sync claim lines
- change: BLOCKS of doc.sync list one `> claim [[n]] <kind> <path>:<a>-<b>, …` line per claim instead of one
  `> claims: [[1]] …; [[2]] …` line.
- why: DATA lines are cut at 400 characters (§5.1-5); a block with ~10 claims lost the ranges the model must repeat
  for unchanged claims, and the repeated cites were rejected (V17). Found by the crit replay.
- applied in: `packages/gen/src/prompts/inputs.ts` (`blockLines`), template `doc.sync@1` wording (new prompt, not
  released before).
- urgency: spec text only.
