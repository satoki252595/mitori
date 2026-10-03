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
crs: loop-7, loop-9, m0-5, m1-4, m1-57, m1-58, m1-63, m1-66, m1-86, m1-88, m1-119, m1-120
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

## CR batch 2 (2026-10-03, ledger §5) — what changed for you

- **Gate sandbox source (CR m1-119, m1-4)**: `ServerDeps.gateSandbox` is contract; `LoopDeps.sandbox` comes from it.
  The detector `detectGateSandbox()` is WP-01's (`@mitori/platform`); until it lands the CLI passes `"none"`, so your
  sandbox-requiring gates must go `pending_consent` in that state (RT-30) — test both values with your own deps.
- Agent mode / resume through the bridge: `BridgePaths.sessionId?` (CR m1-58); the bridge deps gain `safeWrite`/`fs`
  (I3 system prompt files, I9 empty sandbox — CR m1-57, WP-05 applies the signature). Warm reuse needs an identical
  launch (CR m1-63).
- An interrupted turn (SIGINT) is ledgered from the meter (`usageEstimated: true`), the CLI's `result` usage is 0
  (CR m1-66) — repair accounting must not trust it.
- **S6 stream continuation (CR m1-120)**: like WP-08b you may touch `packages/loop/src/{review,router,bundle,contracts}/`
  only for the items the ledger names (e.g. router escalation rules), coordinating with WP-08b's open branch.
- Git env hardening (CR m1-88) applies to worktree / agent runs too (`GIT_NO_LAZY_FETCH`, `GIT_CONFIG_*` env
  neutralizers).

## Out of scope

GitHub PR creation (☆, route answers 501), codex agent mode (after MVP).
