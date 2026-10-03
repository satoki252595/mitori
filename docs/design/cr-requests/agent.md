# agent (WP-08c finishing pass) — change requests (branch `fin/agent`, 2026-10-04)

Found while building agent mode, the check gates, the repair turns, escalation and external patches
(`packages/loop/src/{agent,repair,external,gates}/`, `jobs/{pipeline,plan}.ts`). No contract file was edited. Items 1, 5
and 6 are the ones that change what a user sees.

## 1. The CLI never detects the gate sandbox (every check gate waits for a click on macOS)
- contract: server `ServerDeps.gateSandbox` (CR m1-119 / m1-4) — exists; the producer is missing
- change: platform `detectGateSandbox(): "sandbox-exec" | "bwrap" | "none"` (macOS: `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`
  exits 0; Linux: `bwrap --version`), and `apps/cli/src/daemon/server.ts` passes it instead of the literal `"none"`.
- why: with `"none"` every `executesRepoCode` gate (go vet, go test, tsc, bun test, pytest, cargo check) is `pending_consent` on an AI
  diff (ADR-0013 4) — correct, but the macOS default should be the sandbox: then checks run unattended and a failing check gets its
  REPAIR turn without a click (INT-08 sandbox block, and the live run below, both with `gateSandbox: "sandbox-exec"`).
- workaround in place: none needed in loop (both values are handled and tested); the daemon simply under-uses it.
- urgency: high (UX of every Fix with checks).

## 2. The input meter counts cache reads at full weight
- contract: agent `EngineRequest.budget.inTokens` ("Input tokens (meter limit; agent mode = `limits.agentMaxInputTokens`)")
- change: the meter compares `in + cacheWrite` (the new context) with `budget.inTokens`, or the budget gets a separate
  `cacheReadTokens` limit. An agent turn is many API calls that re-send the conversation: the live Fix read 26–46k cache tokens over
  8 tool calls with a 7.7k context.
- why: with the literal 30k the first live agent run was stopped by the meter after 5 Read/Grep calls, before its first edit
  (`E_BUDGET_EXCEEDED`, $0.038 spent for nothing — docs/progress/agent-mode.md run 1).
- workaround in place: `CR-PENDING(agent)` `AGENT_CALLS_PER_TURN = 10` in `agent/run.ts` — the cumulative meter limit is
  `agentMaxInputTokens × 10`; the USD budget (≥ $0.30, stopped at 80 %) stays the cost guard.
- urgency: medium.

## 3. `FsStat` has no ctime
- contract: core `FsStat`
- change: `ctimeNs: bigint` (lstat `ctime`).
- why: the RT-31 fallback (no sandbox, after consent) fingerprints the linked dependency trees by (size, mtime, inode). A writer that
  edits a file in place and restores its size and mtime with `utimes` is not seen; ctime cannot be set from user space.
- workaround in place: the fingerprint documents the gap (`gates/deps.ts`); the sandbox (item 1) is the real defence.
- urgency: low (only the consent path without a sandbox).

## 4. Owner-file edits outside the WP-08c directories (please review with WP-08b)
- `jobs/runner.ts`: dispatch of agent mode, agent revise, the R2 hand-over hook in `launch`, repair after a consented gate run,
  RT-31 discard of a tampered ready job, `externalPatch`, `create` from a `failed` thread for the human's escalation (fires `retry`,
  sets `escalatedFrom`), `retry` refuses the final escalation (confirm reason `escalation`; other reasons unchanged), re-plans use
  the persisted request.
- `jobs/assemble.ts`: `readJobFile` for REPAIR / revise CODE (it was not wired: a revise turn of a patch job had no CODE at all),
  `detectGates` (format + checks), gate-set trust for the bundle's GATE line.
- `jobs/store.ts`: `JobExtra.req` — the request's context chips / mode / model / budget survive for re-plans (a revise of a job
  created with `@` chips used to re-plan WITHOUT them: a narrower write scope, or another mode).
- verification pass (same branch): `git/side.ts` `inWorktree` now pins `GIT_DIR` / `GIT_WORK_TREE` to the worktree's
  side.git admin dir (new `worktreeAdmin(wt)` checks admin `gitdir` ⇄ `<wt>/.git` and throws `E_SCOPE_VIOLATION`
  `worktree_tampered`); `jobs/runner.ts` `runGates` also discards a ready job on `worktree_tampered`. Reason: git
  discovered the repository through `<wt>/.git`, a file code under test (or the agent) can rewrite — mitori's own git
  would then follow it outside the sandbox. WP-08b please review.
- urgency: review only.

## 5. One trust dialog for a SET of gates
- contract: core `TrustRequest.preview` (one string, ≤ 8000 chars)
- change: `TrustRequest.items?: { id: GateId; argv: string; executesRepoCode: boolean }[]` so the dialog can show one row per gate
  with the ADR-0013 wording next to the ones that run repo code.
- why: spec §7.6.2 hashes "all gate specs" together; loop now asks once per set (gofmt + go vet + go test in one decision) with a
  newline-separated preview. Per-gate trust records still count (a gate trusted alone stays trusted; a single denial wins).
- workaround in place: newline-separated `preview` (`gates/trust.ts gatePreview`).
- urgency: medium (the web dialog renders the preview as text).

## 6. `needs_more_context` hints do not reach the agent bundle
- contract: `BundleBuilder.build` input
- change: `readHints?: RepoPath[]` — resolved deterministically (`indexer.file` / `findSymbols`) into REL items of the agent bundle
  (spec §3.5: "読み取り用の REL に足す。write scope は広げない").
- why: the R2 agent job starts without the files the patch turn asked for; the agent can still Read them (one call each).
- workaround in place: none (the agent reads them itself).
- urgency: low.

## 8. The gate sandbox blocks loopback too (decision needed, ADR-0013)
- contract: ADR-0013 decision 3 ("network 拒否"), `gates/sandbox.ts`
- observation: live run 4 — go-small's `internal/meta` tests use `httptest.NewServer` (listen on 127.0.0.1); under
  `sandbox-exec` the listen is denied, the test panics at the base and at the head. The base comparison now reports it
  as `error` (pre-existing, no REPAIR) and the verdict stays unverified — honest, but such packages are never verified.
- options: (a) keep (current); (b) allow bind/listen and connect on loopback only (`(local ip "localhost:*")` /
  `(remote ip "localhost:*")`; bwrap would need a private netns with lo up) — local services and a loopback proxy
  become reachable from AI-written code; (c) (b) plus a deny list of known local proxy ports.
- urgency: medium (common in Go / Node / Python test suites).

## 9. First-turn input limit ignores the system prompt
- contract: `jobs/engine.ts` (WP-08b) `inTokens: Math.max(plan.budget.in * 2, 4000)`
- observation: a live patch turn read 3.3k (system prompt + a 1.7k bundle) against the 4k floor; trusted repo rules in
  the system prompt would push a small Fix over it before it answers. Repair / revise turns were fixed in this track
  (`repair/turn.ts repairInTokens`); the first turn needs `+ system prompt tokens` (or the same rule).
- urgency: medium.

## 7. Not done in this pass
- `docpatch/1` (a sent doc note) still answers `E_UNSUPPORTED` from `create`.
- `GIT_LIMITS.maxWorktreesPerWs` is not enforced for the lazily created check worktrees of ready patch jobs (GC and accept / reject
  remove them).
- GitHub PR creation (☆) stays 501.
