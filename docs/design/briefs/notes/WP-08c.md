---
read:
  - docs/design/specs/loop.md | 改訂 R1
  - docs/design/specs/loop.md | 6.6
  - docs/design/specs/loop.md | 7.6
  - docs/design/specs/loop.md | 7.7
  - docs/design/specs/loop.md | 8.
  - docs/design/specs/loop.md | 12.
  - docs/design/specs/loop.md | 13.7
  - docs/design/adr/0013-gate-sandbox-and-consent.md | *
crs: loop-7, loop-9, m0-5
owns:
  - packages/loop/src/agent
  - packages/loop/src/repair
  - packages/loop/src/external
  - packages/loop/src/pr
---
## Golden / truth / fixtures

- Injection fixture (`fixtures/repos/injection`, payloads in `fixtures/injection/RT-*`): 0 out-of-scope writes;
  RT-30 (sandboxed AI-written test cannot read `~/.aws`; without a sandbox → `pending_consent`), RT-31 (dependency
  rewrite fails the job). Eval fixtures with hidden tests (WP-12): gate pass rate first try ≥ 70 %, with repair
  ≥ 85 % (Wilson lower bound), $/successful Fix median ≤ $0.05 — measured in the eval window, not in unit tests.

## Notes (M0 layout)

- No M0 stubs in your directories: agent mode, typecheck/test gates, repair, promotion and external patches plug
  into `createLoop` / the job runner (jobs/, WP-08b) and the gate runner (gates/, WP-08b) — extend through internal
  modules and agree the seams with WP-08b.
- Agent mode spawns through the agent bridge (`@mitori/agent`, I1–I14 invariants) with `Edit(//abs)` permissions
  on the job worktree and `dontAsk`; never spawn directly.
- Opus escalation is a proposal requiring confirmation, never automatic.

## Out of scope

GitHub PR creation (☆, route answers 501), codex agent mode (after MVP).
