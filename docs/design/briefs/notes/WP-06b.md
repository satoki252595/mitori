---
read:
  - docs/design/specs/generation.md | 改訂 R1
  - docs/design/specs/generation.md | 11.
  - docs/design/specs/generation.md | 12.
  - packages/gen/src/contract.ts | B7
  - packages/gen/src/contract.ts | B8
crs: gen-C10, ux-R11, ux-R12, gL-10, m1-1, m1-10, m1-11, m1-12, m1-13, m1-14, m1-15, m1-16, m1-17, m1-18, m1-19, m1-22, m1-50, m1-62, m1-120
owns:
  - packages/gen/src/incremental
  - packages/gen/src/ondemand
  - packages/gen/src/translate
---
## Golden / truth / fixtures

- crit last-40-commit replay (cost per small commit ≤ 5 % of Pass 1, limit 10 %; average ≤ 15 %):
  `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/refs/crit`.
  Translation second run = 0 tokens (cache by block hash × lang).

## Notes (M0 layout)

- No M0 stubs sit in your directories: `onIndexDelta` / `syncBlocks` / `expand` / translate are methods of the
  `GenOrchestrator` returned by `createGen` (orchestrator/, WP-06). Implement them as modules in your
  sub-directories that the orchestrator calls (agree the internal shapes with WP-06; do not export new public
  names from `index.ts` without a CR).
- D12: the LLM never runs automatically — S9 only produces suggestions (+ estimate + id); `gen.suggestions` SSE is
  wired by the server (WP-INT).
- The 5 M4 prompts (datamodel, quality, decisions, risks, questions) live in `prompts/` (WP-06's dir) — send them
  to WP-06 / coordinate; simplify ("やさしく") is ☆.

## CR batch 2 (2026-10-03, ledger §5) — what changed for you

- **S5 stream continuation (CR m1-120)**: besides `incremental/ ondemand/ translate/` you may edit
  `packages/gen/src/{orchestrator,prompts,line}/` for exactly these items: implement `GenOrchestrator.runs(page)`
  (CR m1-12; stub in `orchestrator/gen.ts`, newest first over `store.runs()`, cursor = last run id); fix the
  **post-pause write bug** (after `control(run,"pause")` + `idle()` no `gen_tasks` row may be written — settle
  in-flight calls as paused, CR m1-11); call `doc.stampRun({effort, snapshot, usage, full})` in the run's final write
  slot (CR m1-50; implemented in the doc store — `full` only for a user-triggered whole-doc run that ended `done`); drop `GenCallResultExt` (fields are in the contract, CR m1-13) and `ASPECT_AUDIENCE` (read
  `ASPECT_DEFAULTS[aspect].audience`, CR m1-14).
- `GenDeps.fs: FsReader` is required now (CR m1-10); `GenOrchestrator.idle()` is contract (CR m1-11);
  `GEN_PROMPTS[gen.*].form = "compact"` (CR m1-15). `computeVerdict` lives in `@mitori/core` (gen re-exports it;
  CR m1-17 — L1 fail without L3 S ⇒ `inferred`).
- Cache key = SUBJECT bytes (target's own current content excluded; both addendum versions always in the key;
  CR m1-16) — S9 suggestions and the "second run = 0 tokens" translation cache rely on it.
- `createPromptRenderer` / `createVerifier` are public factories (CR m1-1); the composition root builds its own
  Verifier for the doc store.
- `UsageRange` gained `"month"` (CR m1-22; the ledger maps it once WP-05 lands it — until then it equals `all`).
- Deferred: `setQuestions` (CR m1-18, with your M4 questions prompt), shared §6.6 golden (CR m1-19), scheduler
  `resume(lane)` (CR m1-62).

## Out of scope

The base orchestrator and the 7 M2 prompts (WP-06), UI for suggestions (WP-10a/10b).
