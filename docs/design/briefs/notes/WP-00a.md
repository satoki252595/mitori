---
read:
  - docs/design/MILESTONES.md | 0.
  - docs/design/MILESTONES.md | 1.
  - docs/design/ARCHITECTURE.md | 3.
  - docs/design/ARCHITECTURE.md | 9.
  - docs/design/ARCHITECTURE.md | 12.
  - docs/design/adr/0010-package-boundaries.md | *
crs: m0-*
owns:
  - packages/core
---
## Status: done (M0, 2026-10-03)

Delivered on `main`: bun workspaces + exact pins + `bun.lock`; the 7 contracts (+ testkit) moved into packages with
`E_UNSUPPORTED` stubs in the owning sub-directories (one-time compat check: 1,024 exports equal, then deleted);
core pure helpers with CORE-U-001…008 tests; `scripts/check.ts` (tsc -b, biome, boundaries, CR ledger, budgets,
contract index, svelte-check); `.github/workflows/ci.yml` (pull_request + workflow_dispatch); compiled hello
(`dist/mitori-<os>-<arch> --version`, median 10.5 ms); fixtures skeleton; these briefs; `.claude/skills/mitori-check`.

## Where things are

- Contracts: `packages/core/src/{domain,api}.ts`, `packages/<pkg>/src/contract.ts`, `apps/web/src/contract.ts`,
  `packages/testkit/src/contract.ts`. The frozen R1 snapshot stays in `docs/design/contracts/`.
- Living CR ledger: `packages/core/CR-LEDGER.md` (§3 = M0 decisions). Requests: `docs/design/cr-requests/<WP>.md`.
- Export index: `docs/design/briefs/INDEX.md` (`bun run contract:index`, checked by `check`).
- Briefs: `bun run briefs` regenerates `docs/design/briefs/WP-*.md` from MILESTONES + ledger + stubs + `notes/`.

## Out of scope

Everything implemented by other WPs; architect duties continue as the weekly CR batch.
