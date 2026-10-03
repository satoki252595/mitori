# fixtures/repos/

One directory per fixture repo (`FixtureName` in `packages/testkit/src/contract.ts`). The directory is the working tree
of the first commit (never a git repo: **no `.git`**); `fixture.json` (`mitori.fixture/1`, testing spec §2.2) describes how
`buildFixture(name)` (`packages/testkit/src/fixtures/build.ts`) turns it into a deterministic git repo in a temp dir:

1. copy the tree **without** `fixture.json`, `history/`, `dirty/`;
2. `generate`: files too big or too odd to store — `isbn-json`, `ts-lines`, `minified-line`, `nul-blob`, `md-long-block`
   (exact `bytes`, seeded), `text` (verbatim, e.g. CRLF or NFD file names), `hex` (exact bytes: BOM, invalid UTF-8, PNG);
3. `symlinks` (`tracked: false` leaves one untracked), then `git init -b main` with `core.precomposeunicode=false`;
4. commit step 0, apply each `history/*.patch` and commit — author `mitori fixture`, date `2026-01-01T00:00:00Z` + k minutes;
5. `dirty` (only for `buildFixture(name, { step: "dirty" })`): apply an uncommitted patch and create untracked files
   from `dirty/untracked/<path>`.

`fixtures/golden/<name>/commits.json` records the commit ids; `bun fixtures/build.ts --verify` checks them
(`--update` rewrites; run it after changing a fixture).

| fixture | what it is for |
|---|---|
| `ts-small` | tsundoku in TypeScript: hono + express routes, commander CLI, drizzle schema, `MAX_RETRIES = 1`; excluded kinds (generated, lockfile, data_large) |
| `py-small` | the same domain in Python: fastapi + flask routes, argparse + click, SQLAlchemy, unittest; stdlib-only core |
| `go-small` | the demo repo: `internal/meta/fetch.go` with `maxRetries = 1` and the sentence "生成失敗時は正確に 1 回だけ再試行する"; 3 commits (init → retry → pagination) + a dirty state; `//go:build ignore` cobra / chi drafts |
| `rust-small` | the same domain in Rust, no crates: trait / impl / macro, `detect-only/clap_cli.rs` (not built) |
| `mixed` | polyglot monorepo (Next.js app router, gin / echo, typer, clap builder, Java, Dockerfile / Procfile / justfile) |
| `nongit` | a directory without git (shadow workspace): default-ignored `node_modules/` `.venv/` `build/`, NFC Japanese file name |
| `injection` | prompt-injection material (README, comments, fences, canary `CLAUDE.md` / hook / MCP config, fake secrets, bidi controls, 500k-char line, LFS pointer) in a tiny payments library; the 33 red-team payloads are in `fixtures/injection/` |
| `secrets` | clean tracked tree; the dirty state adds untracked `credentials.json`, `service-account.json`, `*.tfvars`, `kubeconfig`, keys, `.aws/`, `.docker/`, `.env*` (SEC-07 / RT-32) plus one harmless untracked control file |
| `edge-inventory` | one file per S0 classification rule boundary (50 KiB, 2 MiB, avg line 300, NUL, BOM, CRLF, latin1, NFD names, symlinks, vendored, generated, lockfiles, secrets); truth is exhaustive |
| `doc-roundtrip` | 20 Markdown docs in the mitori block-id format for load → save round-trips (`roundtrip.json` states the expectation of each) |

The domain of the code fixtures is "tsundoku" (books, tags, ISBN metadata with a single retry, CSV import, JSON export).
Where hidden tests or gates run, the code uses the standard library only; framework material (hono, cobra, clap, chi …)
sits in files nothing builds. Patch-eval tasks (testing §7.4) apply their bug-seeding `setup` patches on top of the tip.

All credentials in these trees are made up. The `.gitignore` in this directory exists so that the repo-wide ignore rules
(`.env*`, `dist/`, `node_modules/`) do not swallow fixture content.
