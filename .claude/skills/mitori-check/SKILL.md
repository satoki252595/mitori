---
name: mitori-check
description: Run mitori's fast dev-loop gate (typecheck + biome + package boundaries + CR ledger + budgets lint/merge check + contract index + svelte-check, then unit tests) and fix what it reports. Use before every commit, after touching contracts/package imports, or when asked to "check", "verify" or "make CI green" in this repo.
---

# mitori-check

Always run tools through `scripts/nd` (cached nix devShell; never `nix develop`).

1. `scripts/nd bun run check` — parallel: `tsc -b`, `biome ci`, `scripts/check-boundaries.ts`,
   `scripts/check-cr-ledger.ts`, `scripts/check-budgets.ts` (= `budgets-merge --check`), `scripts/contract-index.ts --check`,
   `svelte-check`. `tsc -b` covers every package plus the `fixtures/`, `bench/`, `test/`, `e2e/`, `eval/` zones.
   Only failing steps print output. ≈ 1 s at M0; over 15 s warns, over 30 s fails.
   Subset: `scripts/nd bun run check boundaries cr-ledger` (step-name filter), `--verbose` prints every log.
2. `scripts/nd bun test [path]` — unit tests (next to code as `*.test.ts`, or `packages/<pkg>/test/`).
   Goldens: `scripts/nd bun run golden [--filter <pkg>[.<part>]]` (`MITORI_UPDATE_GOLDEN=1` to rewrite).

Fixing typical failures:
- **biome**: `scripts/nd bun run fmt` (biome check --write). Contract files keep their formatting (excluded).
- **boundaries**: imports must follow `PACKAGE_DEPS` (`packages/core/src/domain.ts` §19); no deep imports or `../`
  out of a package; `Bun.*`/`node:*`/`process.*` only in platform/server/cli; writes/spawns/entropy/clock only via
  platform ports; testkit and `/testing` subpaths only from tests. Do not weaken the checker — fix the import.
- **cr-ledger**: an unknown or unqualified CR id in a doc/contract. Write it qualified (`CR idx-10`) or ask the
  architect to add a ledger row (`docs/design/cr-requests/<WP>.md`); never invent ledger rows yourself.
- **contract-index**: a package's public surface changed. If intended (architect / CR batch), run
  `scripts/nd bun run contract:index` and commit `docs/design/briefs/INDEX.md`; otherwise stop exporting it.
- **budgets**: after editing `bench/budgets/<pkg>.json`, `scripts/nd bun run budgets:merge` and commit `bench/budgets.json`.
- **tsc / svelte-check**: fix the types; contracts in `packages/*/src/contract.ts` and `packages/core/src/{domain,api}.ts`
  are frozen — a needed change is a CR, not an edit.

CI (`.github/workflows/ci.yml`, PRs only) runs `bun install --frozen-lockfile && bun run ci:pr`
(= check + test + `fixtures:build --verify` + golden + size) on ubuntu.
