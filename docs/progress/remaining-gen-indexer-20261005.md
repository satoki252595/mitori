# Generation and indexer continuation — 2026-10-05

Integration update: the final Mac check passed in 12.61 seconds, including semantic checks for all 20 projects; the indexer contract blocker in the original table below is resolved. The coordinator subsequently tested Muse on three pinned OSS repositories, fixed module/flow descriptions and dependency preparation, and retained observed explanation limits in [the OSS report](oss-quality-2026-10-05/README.md). The following workstream record describes its earlier snapshot.

No live LLM calls, installs, commits or target-OSS content changes were made by this workstream. Source changes remain uncommitted for review. The coordinator owns the Muse Contributor/max OSS experiments and their measured quality/cost report.

## Changes

- `outbound.calls@2` records literal filesystem writes through imported Node fs, Go os/ioutil, Python's unshadowed built-in `open` in w/a/x mode, and Rust std/tokio fs. The parser must identify code, the path must be literal, and link-time secret redaction still applies. Write payloads are not recorded.
- A directly bound known DB client executing literal write SQL contributes a `db` fact whose target is only the SQL operation (INSERT, UPDATE, DELETE, etc.). Creating a client does not imply a write. Queries, arguments and values are not saved.
- `mitori.repopack/2` and module facts include deduplicated, sorted `> O channel via target path:line` lines, with at most 40 outbound entries and the existing fact/token budgets. Examples and tests remain outside the main repo pack. The contract mirror is updated; the core `write_sink` union and static/UI rendering belong to the coordinator/UI workstreams.
- A queued pin retains its pending bytes until the outer write promise succeeds, rather than deleting them inside the transaction callback. A rollback after the callback therefore retains readable text and permits retry.
- Shallow Git history includes commits with available parents. The artificial root boundary and its whole-tree paths are excluded; `revCount` remains unknown for shallow repositories.
- Design-decision inputs prioritize architecture documents and ADRs, then contributor guidance, then README, and include up to 80 lines per document within the existing 6k DOCS budget. TODO inputs include two adjacent lines on each side, using the existing safe read/stamp path.
- `gen.system@6`, `gen.quality@3`, `gen.decisions@2` and `gen.questions@2` prioritize architectural reasons, common technical terms, one explanation per mechanism, and one concrete unresolved decision per question. Questions about mitori's clustering or directly visible behaviour are discouraged. `gen.risks@4` invalidates cached input after the TODO format change. Both prompt locks are updated.
- Code-naming sentences without a claim become inferred claims with no borrowed cites. Existing cited sentences retain their own proof. Editor rewrites, learning/recap blocks, diagrams, tables and module deep-dive placeholders keep their existing contract. Exceeding the existing 12-claim cap fails validation and follows the normal retry path.
- The standard-library/existing-helper preference for actual repair prompts was coordinated with the agent/loop owner; gen continues to describe code rather than propose implementation changes.

## Targeted verification

All commands use the repository's Nix environment through `scripts/nd`.

| Check | Result |
| --- | --- |
| gen validator, Markdown scan, renderer and M4 inputs | 75 pass, 742 assertions |
| renderer golden regeneration and lock check | 1 pass, 2 assertions |
| outbound detector and link-time secret redaction | 9 pass, 24 assertions |
| repo pack, module context and pending-pin rollback | 18 pass, 3,577 assertions |
| normal/shallow/side Git log | 4 pass, 29 assertions |
| gen and platform targeted TypeScript | passed |
| indexer targeted TypeScript | blocked only by concurrent doc/layout return-contract change; coordinator notified |
| changed source formatting | passed after formatting the generated lock files |

No broad test suite or production build ran in this workstream.

## Limits for the OSS experiment

This is static detection, not a proof of runtime I/O. Dynamic filenames, aliases not recognized by the existing import scanner, DB receivers passed as arguments, prepared statements without literal SQL at the execution call, and indirect write helpers may remain absent. Constructor facts are kept distinct from write-operation facts. Python read modes do not become write sinks.

Document excerpts remain bounded; architecture outside the selected 80 lines can still be missed. Prompt changes guide model quality, so repetition, terminology and question quality require the coordinator's actual OSS output review. Automatic inference repair is deliberately limited to unmarked code-naming sentences in prose/list-like generation blocks; sentences without identifiers and table/fenced content still rely on the prompt and existing uncited-sentence audit. It does not turn unsupported statements into verified facts.
