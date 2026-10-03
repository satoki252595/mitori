# WP-11a — change requests (walking skeleton, 2026-10-03)

Details and measurements: `apps/cli/BUILD-NOTES.md`.

## `bin.size` target per binary target (linux-x64 runtime floor is 81.3 MB)
- contract: budgets (`bench/budgets/cli.json`, testing spec §6 `bin.size` 85 / 95 MB) — owner WP-00b / WP-12
- change: keep the 95 MB limit, set the target per target, e.g. `bin.size.darwin-arm64` 85 / 95 and
  `bin.size.linux-x64` 88 / 95 (or state that the target applies to darwin-arm64 only).
- why: Bun 1.4.2's linux-x64 runtime alone is 81.3 MB (darwin-arm64 62.2 MB). The skeleton is 64.4 / 83.5 MB after
  brotli-packing the pinned wasm/grammars (7.3 → 0.9 MB); every later WP's bytes push linux-x64 over 85 MB.
- workaround in place: `apps/cli/src/build/size.ts` gates the 95 MB limit and only warns over 85 MB (SC-11: target =
  trend), on every built target.
- urgency: nice to have before M1 (the warning will appear on Linux CI as soon as markdown-it / MCP SDK land).

## Declare the CLI's runtime third-party imports in `apps/cli/package.json`
- contract: `apps/cli/package.json` dependencies (root/architect-owned manifest; changing it rewrites `bun.lock`)
- change: add the exact pins already in the lockfile: `elkjs@0.12.0`, `web-tree-sitter@0.27.0`, `@shikijs/core@4.5.0`,
  `@shikijs/engine-oniguruma@4.5.0`, `@shikijs/langs@4.5.0` (the pinned wasm come from `tree-sitter-*` and `shiki`
  through `assets.lock.json`, which needs no manifest entry).
- why: the skeleton Worker entries (`apps/cli/src/build/workers/{parse,compute}.ts`) and the ELK pool
  (`apps/cli/src/daemon/elk.ts`) import these packages; today they resolve only because `bunfig.toml` uses the hoisted
  linker. Alternatively WP-INT moves the Worker entries to `packages/server/src/workers/` (indexer spec §3.3) and the
  server manifest declares them.
- workaround in place: hoisted resolution (no manifest change, `bun install --frozen-lockfile` stays green).
- urgency: before anyone switches the linker to `isolated`.

## Type-check the root `test/` zone
- contract: root `tsconfig.json` references (architect)
- change: add a `test/tsconfig.json` project (types: bun; references core/server/cli) and reference it from the root,
  or include `test/**` in an existing project.
- why: `test/skeleton/skeleton.test.ts` (and WP-INT's `test/int/`) are linted by biome but not type-checked by `tsc -b`.
- workaround in place: none (bun runs the file; biome lints it).
- urgency: nice to have.

## Ignore `dist/**` in `bunfig.toml [test] pathIgnorePatterns`
- contract: root `bunfig.toml` (architect)
- change: add `"dist/**"`.
- why: `dist/` holds build output (`dist/.build/`, release staging); a stray `*.test.ts` there is collected by
  `bun test` at the root.
- workaround in place: gen-assets never writes test files into `dist/`.
- urgency: nice to have.

## State-DB migration list for the daemon start
- contract: `packages/server/src/contract.ts` §3 — `MIGRATION_ORDER.state` (server + `AGENT_MIGRATIONS`)
- change: none to the shapes; the composition root (WP-INT) should expose the collected `Migration[]` per database
  (e.g. `stateMigrations()` / `workspaceMigrations()` in `wiring/`), because `@mitori/cli` may not import
  `@mitori/agent` (PACKAGE_DEPS) and so cannot build the state list itself.
- why: server spec §1.1 (d) runs `MIGRATION_ORDER.state` at daemon start; the skeleton's runner
  (`apps/cli/src/daemon/migrate.ts`) is wired with an empty list.
- workaround in place: `// CR-PENDING(WP-11a)` at `apps/cli/src/daemon/serve.ts` (`STATE_MIGRATIONS = []`).
- urgency: before the first state-DB migration lands (WP-05 ledger, WP-09 sessions).

## Project skill `mitori-release-build` (MILESTONES §0.8)
- contract: `.claude/skills/` (architect)
- change: add the skill: `scripts/nd bun run build:bin && scripts/nd bun run size && scripts/nd bun test test/skeleton`
  (+ `scripts/nd bun scripts/release.ts` for both targets; `bun scripts/gen-assets.ts --update-lock` after bumping a
  pinned package, review the lock diff).
- why: the release build is a repeated procedure (global rule: repeated steps become skills); WP-11a may not write
  `.claude/`.
- workaround in place: the commands are documented in `apps/cli/BUILD-NOTES.md` §1.
- urgency: nice to have.
