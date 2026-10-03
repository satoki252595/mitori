# fixtures/ — test data (no code that ships)

Owner: S10 (WP-00b → WP-12). Each package WP may **add** files under its own `fixtures/<pkg>/` or with its own
prefix, never edit another WP's files (SC-16). Spec: `docs/design/specs/testing.md` §2 (+ its 改訂 R1 table) and
`packages/core/CR-LEDGER.md` CR m0-8 (truth location).

| dir | what | naming |
|---|---|---|
| `repos/` | small, realistic fixture repos (the working tree, **no `.git`**) + `fixture.json` (`mitori.fixture/1`) | `repos/<name>/` with `<name>` ∈ testkit `FixtureName` |
| `truth/` | hand-written ground truth per fixture (`mitori.fixture-truth/1`), independent of the implementation | `truth/<name>.json` |
| `golden/` | frozen implementation outputs (byte-exact; canonical JSON) — change only in a `golden:` commit with a version bump | `golden/<name>/<artifact>` (testing spec §2.5) |
| `agent-streams/` | recordings of real `claude -p` stream-json (normalizer/scheduler tests) | `agent-streams/<scenario>.jsonl` |
| `injection/` | prompt-injection / red-team payloads by RT id (the `injection` repo itself lives in `repos/injection/`) | `injection/RT-<nn>-<slug>.<ext>` |

Rules: deterministic (fixed author/committer/date via `buildFixture`), no network at test time, stdlib-only code
where gates or hidden tests run, big inputs generated at build time (`generate` in `fixture.json`) instead of committed.
Lint, format and the boundary checker skip `repos/`, `golden/`, `agent-streams/` and `injection/` (they are data).

Commands (from the repo root, through `scripts/nd`):

- `bun test fixtures/truth` — truth self-consistency + red-team / secret fixture checks (WP-00b acceptance)
- `bun fixtures/build.ts [--only <name>] [--verify | --update]` — build every fixture; compare / rewrite `golden/<name>/commits.json`
- `bun scripts/fetch-corpus.ts [--only crit,flask] [--verify [--strict]]` — pinned real-repo corpus (`bench/corpus.lock.json`) into
  `~/.cache/mitori-corpus/<name>@<sha12>/`; never committed
- `bun scripts/budgets-merge.ts [--check]` — `bench/budgets/<pkg>.json` → `bench/budgets.json`
