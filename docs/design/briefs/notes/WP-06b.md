---
read:
  - docs/design/specs/generation.md | 改訂 R1
  - docs/design/specs/generation.md | 11.
  - docs/design/specs/generation.md | 12.
  - packages/gen/src/contract.ts | B7
  - packages/gen/src/contract.ts | B8
crs: gen-C10, ux-R11, ux-R12, gL-10
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

## Out of scope

The base orchestrator and the 7 M2 prompts (WP-06), UI for suggestions (WP-10a/10b).
