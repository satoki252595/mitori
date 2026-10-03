---
read:
  - docs/design/specs/testing.md | 改訂 R1
  - docs/design/specs/testing.md | 2.
  - docs/design/specs/testing.md | 6.1
  - docs/design/ARCHITECTURE.md | 10.2
  - docs/design/specs/indexer.md | 11.3
  - docs/design/specs/loop.md | 0.3
  - docs/design/specs/generation.md | 7.4
  - docs/design/specs/ux.md | 13.1
  - packages/testkit/src/contract.ts | 3. fixtures
  - packages/testkit/src/contract.ts | 7. perf
crs: test-*, m0-6, m0-8, m0-9, m0-5
owns:
  - packages/testkit/src/fixtures
---
## Golden / truth / fixtures

- Already there (M0): `fixtures/README.md` + per-dir READMEs, `fixtures/repos/ts-small/` (3-file skeleton +
  `fixture.json`), `fixtures/truth/ts-small.json` (template). Grow ts-small to testing spec §2.3.1 (~900 LOC) and
  rewrite its truth; add the other fixtures of §2.3 (py-small, go-small with the demo "retry count" code,
  rust-small, mixed, nongit, injection, edge-inventory, doc-roundtrip) + `secrets` (untracked
  `credentials.json` etc. for SEC-07).
- Truth location is `fixtures/truth/<name>.json` (CR m0-8), **not** `fixtures/repos/<name>/truth.json` as the spec
  body says. `fixtures/build.ts`/`buildFixture` must exclude `fixture.json`, `history/`, `dirty/` from the copy.
- Budgets: one file per package `bench/budgets/<pkg>.json` (`{ "v": "mitori.budgets/1", "budgets": [...],
  "counters": [...] }`, ids namespaced like `idx.s01.cold.100kloc`, optional `minN`). `scripts/check-budgets.ts`
  (in `check`) already lints shape, unique ids across files, target vs limit, gates, units, `<file>#<case>`
  measures. You write `scripts/budgets-merge.ts` (→ `bench/budgets.json`, `--check`). Values come from the spec
  tables (the spec wins over MILESTONES numbers, CONS-29).
- CORE-U-009 (code constants == budgets: `Limits` defaults, `UI_THRESHOLDS`, bundle constants) is yours to add as a
  test under `bench/` once budgets exist (core itself does not read bench files).

## Notes

- Corpus clones already exist on the maintainer machine (session scratch, read-only reference):
  `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/corpus/{flask,ripgrep,hono,excalidraw,fastapi,react}`
  and `…/scratchpad/refs/{crit,m3e-canvas}`. `scripts/fetch-corpus.ts` must still shallow-clone into
  `~/.cache/mitori-corpus/<name>@<sha12>/` with the SHAs of testing spec §2.7 and `--verify` hashes; never commit
  corpus content.
- `packages/testkit` is S10's (MILESTONES §1.2; contract.ts stays architect-owned). Its stubs for
  `buildFixture`/`loadTruth`/`scoreIndex`/`indexerFromGolden` are in `packages/testkit/src/fixtures/index.ts`.
  `bun test fixtures/truth` runs (bunfig ignores only `fixtures/{repos,golden,agent-streams,injection}`).
- Fixture code must be stdlib-only where gates/hidden tests run (Go no modules, Python stdlib + unittest, Rust no
  crates, TS bun built-ins); framework detector material goes where builds/tests never look (testing spec §2.1).
- `devShells.ci` already has go, python3, rustc, cargo, rustfmt (flake.nix); locally use `scripts/nd` (default
  shell has no go/rust/python — use the host toolchains or ask the architect to add them to `default`).

## Out of scope

Bench runners, eval, e2e harness (WP-12); package-specific goldens (each owner WP); cassettes (WP-05/06/12).
