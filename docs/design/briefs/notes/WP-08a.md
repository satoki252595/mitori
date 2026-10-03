---
read:
  - docs/design/specs/loop.md | 改訂 R1
  - docs/design/specs/loop.md | 3.
  - docs/design/specs/loop.md | 4.
  - docs/design/specs/loop.md | 5.
  - docs/design/specs/loop.md | 13.3
  - packages/loop/src/contract.ts | C3
  - packages/loop/src/contract.ts | C4
  - packages/loop/src/contract.ts | C5
  - packages/core/src/domain.ts | 12
  - packages/core/src/domain.ts | 16
crs: loop-2, loop-6, loop-8, ux-R8, ux-R9, m0-5
owns:
  - packages/loop/src/bundle
  - packages/loop/src/router
  - packages/loop/src/prompts
  - packages/loop/src/contracts
---
## Golden / truth / fixtures

- `fixtures/golden/<fixture>/bundles/<case>.<tier>.txt` + `.tokens` (normalized with testkit `normalizeForKey`);
  tier token windows XS 0.4–0.7k, S ≈ 1.1k, M 3.5–5k, L 9–12k. `scripts/nd bun run golden --filter loop.bundle`.
- Read code through an `Indexer` fake (testkit `indexerFromGolden` is a stub today — hand-build one).

## Notes (M0 layout)

- Stubs: `route`, `deriveWriteScope` (router/), `parseContract` (4 overloads), `applyEditsToText` (contracts/).
  The `BundleBuilder` itself is reached through `createLoop` (jobs/, WP-08b): implement it in `bundle/` and let
  08b compose it.
- Deny globs: match `DEFAULT_DENY_GLOBS` (core) with picomatch `{ dot: true }` — the semantics CORE-U-007 pins
  (`.envrc` and any `.env.*` are denied; CR m0-5). `picomatch` 4.0.7 is a loop dependency.
- Output contracts parse into core `ThreadOutcome` / `DocUpdate` / `PatchEdit` (CR loop-2); never trust engine
  output (validate everything server-side).
- **MBF/1 freezes when you finish** (SC-09) — bump `FORMAT.bundle` for any later byte change.

## Out of scope

Git application of edits (WP-08b), agent mode prompts beyond the shared prompt group (WP-08c), the CLI `bundle`
command (WP-11).
