# WP-06b — incremental S9, on-demand, translation (2026-10-04)

Branch `track/06b`. `scripts/nd bun run check` is green; `scripts/nd bun test packages/gen` passes 192 tests (crit
replay included when the pinned corpus is present); `packages/server` 114 and `test/int` 13 pass unchanged.

## 1. What is implemented

| Deliverable | Where | Notes |
|---|---|---|
| `onIndexDelta` | `gen/src/incremental/{s9,rules,state}.ts` | idempotent marking (overlapped / outdated ⇒ claim `stale` + block freshness; moved ⇒ new cites), R1–R8 over the generated units, one suggestion per unit, stable `sg_` id, stored + startable estimate (trigger `incremental`, lane `doc`, 24 h TTL), replaced list drops its estimates. D12: no engine call. |
| Baselines | `incremental/state.ts` | interface digest per page, §3 flow facts (route / cli / entry without line numbers), §7 schema, §0–§2 module structure (+ top-level parents' digests). Set in the write slot that finishes a task; seeded from the doc index on first sight (CR R1). |
| Scoped runs | `ondemand/plan.ts` | one task per section (`s6/<slug>` ⇒ module / parent page, `s0`–`s2` ⇒ final overview, `s3`, `s7`, `s9`…`s13`), built directly (no whole-repo plan), planner-identical task ids, no cross-section deps; doc.sync 8 blocks / call; translate ≤ 30 blocks / 6,000 chars. |
| `expand` | `ondemand/ondemand.ts` | lazy-module and section placeholders ⇒ the section prompt (written directly, locks ⇒ proposals); AI deep-dive placeholders ⇒ `gen.deepdive` topic mode replacing the block under its id. |
| `syncBlocks` | `ondemand/ondemand.ts` | stale text blocks only; `confirm:false` = stored estimate; `confirm:true` runs and returns its proposals. Always proposals (`source.kind: "sync"`) unless `autoAcceptDocUpdates`. |
| Translation (D5) | `translate/{select,sink}.ts` | block or section (+ sub-sections); `TranslationSink` stores `TranslationRecord{srcHash}` (not a proposal); fresh records are skipped ⇒ second request 0 tokens; markers checked (V14). |
| やさしく (☆) | `ondemand/ondemand.ts` | `doc.simplify` proposal keeping the claim ids; a pending simplify proposal on the current text is the cache hit. |
| Ask answer → doc | `ondemand/answer.ts` | insert proposal after the anchor, kind faq / deepdive, `[[path:a-b]]` ⇒ stamped claims. Internal (`GenInternal.promoteAnswer`) until CR R3. |
| M4 prompts | `prompts/{templates,inputs,context,renderer}.ts`, `planner/planner.ts`, `orchestrator/questions.ts` | datamodel, quality, decisions, risks, questions + deep dive + doc.sync / simplify / translate texts (lock updated), DATA builders (SCHEMA, CLAIMS, COMMENTS, TODOS, UNTESTED, LARGE, RAW, TOPIC, BLOCKS, GLOSSARY); standard / complete plans include the section tasks; the s13 list is written as is up to 15 raw questions, consolidated above (CR R2). COMMITS / CHURN wait for `GitReader.log`. |
| S5 stream (CR m1-120) | `orchestrator/{runner,store,gen,apply,execute}.ts` | `runs(page)` (CR m1-12); pause stops in-flight calls, they settle `pending` and their partial new blocks are removed ⇒ nothing is written after pause + `idle()` (CR m1-11); `doc.stampRun` in the final write slot (CR m1-50); `GenCallResultExt` / `ASPECT_AUDIENCE` removed (CR m1-13 / m1-14). |

Behaviour worth knowing:
- An update whose text is unchanged records its re-stamped claims (cites, checks, verdict): a sync or regeneration
  that confirms a sentence clears its staleness without a proposal. Claim identity ignores whitespace (stored quotes
  drop the CJK↔ASCII space).
- Blocks awaiting a pending proposal on their current text, and `excludeBlocks`, are not suggested again.
- The top-level parent's interface digest is part of the §0–§2 structure (R7): in a repo with one root parent every
  interface change also suggests the overview. Per spec; it dominates the cost of interface commits (below).
- On-demand / S9 runs use the default gen engine, or claude-cli when the default is the session engine.

## 2. Acceptance (`scripts/nd bun test packages/gen/src/incremental`)

crit, last 40 commits (pinned corpus `~/.cache/mitori-corpus/crit@406875dd31e0`, depth 41), doc generated at HEAD~40
with the scripted engine (0 tokens); every suggestion is run and its proposals accepted before the next commit.
Costs are the suggestions' own estimates (all token classes) against the Pass 1 estimate.

| Measure | Budget (target / limit) | Measured |
|---|---|---|
| Pass 1 (standard, estimate) | — | 504,220 tok, $1.23 API-equivalent |
| `gen.incremental.typical` (≤ 3 files, no interface change; 13 commits) | 5 % / 10 % | max **1.00 %**, mean 0.08 % |
| `gen.incremental.mean` (40 commits) | 15 % / 25 % | **4.79 %** (USD 7.7 %) |
| Interface-change commits (13) | — | 8.5–15.7 % each (R1 + R4 root parent + R7 overview); 422-file commit 31.8 % |
| S9 wall time (`out.ms`) | §11.2 marking ≤ 30 ms | typical ≤ 2 ms; max 68 ms (7 suggestions estimated) |
| D12 | no automatic LLM run | 0 engine calls from S9 in all 40 steps (asserted) |
| Translation second request | 0 tokens | 0 (GEN-TR-01) |

Save → stale badge (e2e) is the composition root's re-anchoring slot, which runs before S9: INT-02 still measures
29 ms (go-small). The crit target (≤ 50 ms) is WP-INT §C's.

## 3. Edits outside `incremental/ ondemand/ translate/`

- `orchestrator/` — CR m1-120 items (above) and the wiring of the WP-06b entry points (`gen.ts`); `taskDone` hook and
  trigger / lane from the stored estimate (`runner.ts`, `store.ts` `EstimateRequest`); `ApplySink` patch-form lines
  (section / kind from the block, sync / simplify sources and modes, unchanged-text claim refresh), `LineSink` for the
  translation sink, `questions.ts`; executor: sink choice, the direct question list, pause settling.
- `prompts/` — the M4 / doc.* texts and DATA builders (brief: "the 5 M4 prompts live in prompts/"); CHANGES now uses the
  claim's marker number; doc.* prompts keep CHANGES in the cache subject; `parseBlocks` validation context.
- `line/validator.ts` — patch lines without `claims` inherit the block's markers (V14 for translate / simplify).
- `planner/planner.ts` — M4 section tasks in standard / complete plans.
- `session/session.ts` — `afterLines` gets the line context (question list in ingest).
- `engines/scheduler-engine.ts`, `line/aspects.ts` — CR m1-13 / m1-14.
- Tests whose expectations follow from the above: planner / orchestrator / transport / session / control (pause
  semantics), render and prompt locks; `test/fake-doc.ts` records `stampRun`.

## 4. Not done / follow-ups

- CRs in `docs/design/cr-requests/WP-06b.md`: R1 doc-store interface digest, R2 `setQuestions`, R3 `promoteAnswer` on the
  contract + loop wiring, R4 server route `POST /gen/suggestions/:sg/run` ⇒ `gen.start(estimate.id)`, R5 spec text.
- `gen.judge` (P3) and the deep dive's `files` mode (complete effort) have no texts yet (E_UNSUPPORTED on render).
- COMMITS / CHURN DATA need `GitReader.log` (§17 C5).
- Real-engine measurements of the M4 prompts and of doc.sync quality belong to the M2 measurement window.
