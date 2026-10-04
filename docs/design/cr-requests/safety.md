# safety (rem/safety) — change requests (2026-10-04)

The remaining-backlog pass of the safety track (`docs/progress/rem-safety.md`). Every contract change of this track is
small and additive, and is already applied and decided in `packages/core/CR-LEDGER.md` §8 (CR safe-1 … safe-6). This
file says where each one lives, and what another owner still has to do.

## CR safe-1 — gate loopback policy (ADR-0013 R2, cr-requests/agent.md #8)
- loop `gates/sandbox.ts`: `SandboxPaths.loopback?`, the listener parsers, the deny lists; `gates/runner.ts`:
  `hostListeners` (netstat ∪ lsof), `GateRunnerDeps.loopbackListeners?` for tests.
- platform `spawn/sandbox.ts`: the detection probe uses every Seatbelt construct of the profile; Linux probes
  `--unshare-net`. `SEATBELT_PROBE_PROFILE` is not re-exported (no public-surface change).
- open for another owner: none. Linux (bwrap) ran for real in the verification pass (Ubuntu 24.04 container,
  `docker run --privileged`: RT-30L); a desktop distro with live systemd-resolved / D-Bus / Docker is still to do.
- verification pass (same branch): files behind `/dev/null`, dirs behind a tmpfs (`SandboxPaths.isDir?` — a tmpfs over
  `~/.claude.json` failed every Linux gate); the detection probe runs the gate's exact bwrap (`BWRAP_PROBE_ARGS`);
  name-resolution sockets (systemd-resolved, nscd, avahi) hidden; credential stores of other tools read-denied
  (`SENSITIVE_HOME_DIRS/FILES`), every sensitive path also at its realpath (`SandboxPaths.realpath?`).

## CR safe-2 — `FsStat.ctimeNs?` (cr-requests/agent.md #3)
- core `domain.ts` (optional member), platform `fs/reader.ts` (WP-01's file: one property). Optional so the 23 fakes
  that build `FsStat` keep compiling.

## CR safe-3 — dependency links and symlinks in agent turns (F1 remainder)
- loop `GitSafety.linkDependencies` / `unlinkDependencies`; `git/worktree.ts` `escapingSymlinks` + skip-worktree.
- verification pass: `escapingSymlinks` resolves like the kernel (it normalized lexically); `escapingOnDisk` runs before
  every agent turn (`assertWorktreeScope`) — a symlink a gate left behind fails the job (`symlink_escape`).

## CR safe-7 — nothing a gate starts outlives it (verification pass)
- **cross-owner**: platform `spawn/spawner.ts` (WP-01) `RunOptions.reapGroup?` — SIGKILL to the process group once the
  leader exited; default unchanged (tools keep their grandchildren). The loop gate runner passes `true`.
- why: a test's background job planted a symlink in the tree after the post-gate checks, while the next agent turn read it.

## CR safe-4 — formatter identity in the trust hash (F9)
- loop `GateDetector.detect` input `binaryInfo?` / `readdir?`, `GATE_LOCAL_BINARIES`; `gates/binaries.ts`.

## CR safe-5 — pull-round scope check and Undo (F8)
- loop `GitSafety.markRound` / `roundChanges` / `undoRound`, `ReviewEngine.roundScope` / `noteRoundChanges`.
- core api `RoundChanges`, `RoundUndoRes`, two routes in `ApiRoutes` + `ROUTE_META`.
- **cross-owner**: `packages/server/src/contract.ts` `ROUTE_OWNERS` (+2 rows, "loop"). WP-09 please keep.
- open for the web owner (WP-10a/b): show `outside` of `GET /review/rounds/:n/changes` in the Inbox / Review after a
  pull round completes (the threads already get a system line), and a 「このラウンドを元に戻す」 button calling
  `POST /review/rounds/:n/undo` (its checkpoint appears in the existing checkpoint list, whose Undo re-applies it).

## CR safe-6 — `Thread.context` (cr-requests/ux.md #2 / #6)
- core `Thread.context?`, `ThreadContext`, `THREAD_CONTEXT_LIMITS`; api `CreateThreadReq.context?`,
  `PatchThreadReq.context?` (null clears), `CopyPromptReq.context?`, `ContextAdjust.remove` key `write:<path>`.
- loop migration v3 `rev_threads.context`; `review/context.ts`; plan merges the threads' context into the request.
- open for the web owner (WP-10a/b, `apps/web/src/threads/loop.svelte.ts`, `composer/`):
  1. `#submitThread` sends the Composer's chips as `context` (`{ add: picked + @, remove }`) on `POST /threads`
     (and `PATCH` for a draft whose chips change), and `copyPrompt` sends the same `context` on `POST /prompt`.
  2. The 「⚡ その場で実行にする」 block of an uncited Fix on ⤴ / ⧉ (cr-requests/ux.md #6 workaround) can go: the pick
     now travels on both.
  3. Cited 「対象コード」 chips get their ×: removing one sends `remove: ["write:<path>"]` (the file stays CODE, read only).
- behaviour change made here (ux.md #4 review): a job's pending AI edit of a **static** facts block is closed when the
  job's code is accepted (the row follows the code; before, its accept was a 409 once re-indexing rewrote the row).
