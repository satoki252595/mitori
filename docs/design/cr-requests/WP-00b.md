# WP-00b — requests and spec conflicts found while writing fixtures, truth and budgets

Everything below has a working default in the tree; the architect (or the WP named) decides whether to keep it.

## A. Truth follows one side of a spec conflict — please confirm or flip (edit `fixtures/truth/<name>.json`, no code change)

| # | where | testing spec §2.3 says | domain spec says | truth does |
|---|---|---|---|---|
| A1 | ts-small `dist/app.min.js` | minified (1 line of 3,000 chars) | indexer §2.3: R09 `generated_path` (`dist` ∈ `GENERATED_SEGMENTS`) comes before R10/R12 | `generated` / `generated`. The content-based minified case lives in `edge-inventory` (`web/long-lines.js`, avg 301) |
| A2 | ts-small `.env.example` | no env fact from it (deny glob) | indexer CR-11 / O-IDX-15: `ENV_TEMPLATE_GLOBS` may be read for key names | `forbiddenFacts: env TSUNDOKU_DEBUG_SQL @ .env.example` (a key that exists only there). If CR-11 means "emit env facts from templates", move it to `facts` and drop the forbidden entry |
| A3 | py-small / rust-small entries | `script:tsundoku`, `script:tsundoku-stats`; rust `main:src/main.rs` + `bin:tsundoku` | indexer `entry.python@1`: `[project.scripts]` → `main` / `bin`; `entry.rust@1`: `main` only | testing spec's keys. `scoreIndex` does not compare an entry's `path` (manifest vs. file it runs) |
| A4 | mixed routes | `web/app/page.tsx` not listed | indexer `route.next-app@1` also turns `app/**/page.*` into `GET` routes | `GET /` (next-app) is in the truth |
| A5 | edge-inventory symlinks | "source (as resolved)" | indexer R00: symlink → `ignored` / `special` | `ignored` / `special`, `lang: generic` |
| A6 | `lang` of excluded files | not stated | indexer §2.4: by extension | truth gives the extension's language even for excluded files (`vendor/lib.js` → `javascript`, `dist/app.min.js` → `javascript`) |
| A7 | edge-inventory `enc/nfd-ファイル.md` | name has no decomposable character | — | uses `enc/nfd-ガイド.md` (U+30AB U+3099), generated at build time with `core.precomposeunicode=false` so the NFD name survives macOS |
| A8 | go-small `todo` | `// TODO: paginate list results` | — | HEAD (after the pagination commit) keeps a TODO in `server.go` (`expose the total count`); step 0 has the original text |

## B. Conventions I had to fix (documented in `fixtures/truth/README.md`)

- Truth describes the **tip of `fixture.json` history** (`buildFixture(name)`); `fixtures/repos/<name>/` itself is step 0. Only go-small has more than one commit.
- Fact keys: route `METHOD pattern`, env `NAME`, cli `prog sub`, schema `source:entity`, entry `flavor:label`, script `name`, test `name`, dependency `ecosystem:name`, existing_doc `role` (+ `attrs.title`), todo `MARKER`. `line` is given only when the defining statement is one unambiguous line (no decorators, no multi-line expressions).
- `stretch: true` facts absorb an actual fact with the same `path` + `key`, whatever its attrs/line; they are never required.
- Symbol `start` = the line of the declaration keyword (decorators, attributes and doc comments excluded); decorated Python symbols and any file whose path contains `#` are left out of `symbols`.
- `config` facts have no truth (not graded). `scoreIndex` returns one `TruthScore` per graded fact kind + `files`, `symbols`, `imports`, `calls`, `modules`.

## C. For WP-00a / the architect (root-owned files)

1. Root `package.json` scripts: `fixtures:build` = `bun fixtures/build.ts` (`--verify` / `--update`), `corpus:fetch` = `bun scripts/fetch-corpus.ts`, `budgets:merge` = `bun scripts/budgets-merge.ts`. The testing spec §1.3 names the first two.
2. `ci.yml`: add `bun scripts/budgets-merge.ts --check`, `bun fixtures/build.ts --verify` (int job) and, after the actions/cache restore, `bun scripts/fetch-corpus.ts --only crit,flask --verify`.
3. `tsc -b` does not cover `fixtures/*.ts`, `fixtures/truth/*.test.ts`, `bench/budgets/*.test.ts`. A `fixtures/tsconfig.json` + a `bench/tsconfig.json` referenced from the root `tsconfig.json` would put them under the gate (I type-checked them ad hoc).
4. `devShells.default` has no go / python3 / rustc / cargo (only `ci` has). I verified go-small / py-small / rust-small with the host toolchains (go 1.27.1, Python 3.14, rustc 1.95, `cargo test --offline`, `gofmt -l`, `cargo fmt --check` all clean).
5. `fixtures/repos/.gitignore` (mine) re-includes `.env*`, `dist/`, `node_modules/` for the fixture trees; the root `.gitignore` would otherwise drop them.
6. Intentionally fake secret-shaped strings live in `fixtures/repos/{injection,secrets,edge-inventory}` and `fixtures/injection/` (`AKIA…` shaped ids, `sk-ant-api03-FAKE…`, PEM blocks with a base64 "FAKE FIXTURE KEY" body, `sk_test_FAKE…`). `sk_live_` and well-known provider example keys were avoided on purpose (the core placeholder filter ignores `example`). If GitHub push protection objects, allowlist those paths.

## D. Contract gaps (testkit/contract.ts is architect-owned)

1. **`FixtureName` has no `"secrets"`** although MILESTONES lists the `secrets` fixture (SEC-07 / RT-32) and `fixtures/repos/secrets/`
   + `fixtures/truth/secrets.json` exist. Proposal: add `| "secrets"` to the union (testing spec §2.3 list). Until then callers
   write `"secrets" as FixtureName` (`// CR-PENDING(WP-00b)` in `fixtures/truth/security-fixtures.test.ts`); `buildFixture` / `loadTruth`
   already work for it at runtime.

## E. Left open on purpose

- `bench/corpus.lock.json`: `gostd` is pinned by tag `go1.27.1` only (`commit`, `tree`, `contentHash` are null until the first online `fetch-corpus --only gostd --update-lock`; no network was used here). The other eight entries carry commit + tree.
- `gen:palette-50k`, `gen:doc-1000`, `gen:large-file` fixtures (testing §2.3.10) are not built: generators belong with the e2e/perf harness (WP-12); `buildFixture` rejects them as unknown.
- `indexerFromGolden` stays an `E_UNSUPPORTED` stub: it reads goldens that WP-02/03 produce. `fixtures/golden/<name>/commits.json` (commit ids) is the only golden written here.
- `bench/budgets/*.json`: `measure` files (`bench/*.bench.ts` …) do not exist yet (WP-12 and the owning WPs create them). `gen.std.100k` is not transcribed: the spec fixes its value only after the O2 measurement.
- CORE-U-009 compares `BUNDLE_BUDGETS` and `UI_THRESHOLDS`; `Limits` defaults exist only as comments in `packages/core/src/domain.ts` (no constant to compare). Add the comparison when core exports `DEFAULT_LIMITS`.
