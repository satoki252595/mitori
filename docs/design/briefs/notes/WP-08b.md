---
read:
  - docs/design/specs/loop.md | 改訂 R1
  - docs/design/specs/loop.md | 7.
  - docs/design/specs/loop.md | 8.
  - docs/design/specs/loop.md | 13.5
  - docs/design/adr/0006-git-safety-model.md | *
  - docs/design/adr/0012-git-side-repo.md | *
  - docs/design/adr/0013-gate-sandbox-and-consent.md | *
  - packages/loop/src/contract.ts | C6
  - packages/loop/src/contract.ts | C7
  - packages/loop/src/contract.ts | C8
  - packages/core/src/domain.ts | 11
  - packages/core/src/domain.ts | 13
crs: loop-2, loop-8, loop-9, jdg-7, jdg-8, ux-R18, ux-R19, m0-5
owns:
  - packages/loop/src/git
  - packages/loop/src/gates
  - packages/loop/src/jobs
---
## Golden / truth / fixtures

- Demo Fix on `go-small` ("make the retry count configurable", WP-00b): patch mode, input ≤ 3k / output ≤ 1.5k
  tokens, gofmt gate, accept → uncommitted working-tree change → Undo restores fully, **user repo refs/objects/
  worktree metadata unchanged** (GIT-S-06). Engines replay recordings (`fixtures/agent-streams/`) — no real calls.
- Go/Rust/Python toolchains for gates: present in `devShells.ci`; locally use the host toolchains.

## Notes (M0 layout)

- Stubs: `gateExcerpt` (gates/), `createLoop` (jobs/ — the loop facade: compose the review engine from `review/`
  (WP-07), the bundle builder/router/contracts (WP-08a) and your git safety + job runner). `LOOP_MIGRATIONS`
  lives in `review/` (v1 = loop spec §2.8 incl. `job_*`); append later versions there (same S6 stream).
- §7.6 here is the **format gate only** (gofmt, biome/prettier, ruff/black, cargo fmt); typecheck/test gates and
  sandbox detectors are WP-08c.
- All git runs through the hardened env of ADR-0012 (empty env + allowlist, `GIT_CONFIG_NOSYSTEM=1`, stdin
  /dev/null, timeouts) via the `Spawner` port — never `node:child_process` (boundary checker). Writes to the user's
  working tree only via `SafeWriter` kind `accept`.
- Deny globs: core `DEFAULT_DENY_GLOBS` with picomatch `{ dot: true }` (CR m0-5).

## Out of scope

Agent mode, repair loop, promotion, external patches, GitHub PR (WP-08c); bundle/router (WP-08a).
