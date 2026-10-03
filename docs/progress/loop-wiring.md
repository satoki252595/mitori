# createLoop wiring (branch `integrate/loop`, 2026-10-04)

The review → AI fix loop runs on the real daemon: `createLoop` (WP-08b parts + WP-07 review engine) is assembled per
workspace and the thread / review / job / checkpoint / touch routes call it. Zero tokens: the engine in the tests is the
REAL claude-cli engine, normalizer, scheduler and ledger behind a scripted `claude`.

## What is in

| Where | What |
|---|---|
| `packages/loop/src/jobs/assemble.ts` | `createLoop(deps)`: review engine, bundle builder, git safety (side repo), gate runner (format gates detected from the index, trust from `LoopDeps.trust`), job runner, `capture`. Extras beyond the contract type: `close()`, `threadBundle()`, `checkpoints()`, `jobs.list()` |
| `packages/loop/src/jobs/{plan,runner,store,pipeline}.ts` | `scopeCtx` exported for the Finish partition; `JobStore.page` + `JobRunnerHandle.list`; **fix**: a patch edit outside WRITE fails the job at once with `E_SCOPE_VIOLATION` (it used to start a REPAIR turn and report `E_AGENT_PROTOCOL`) |
| `packages/server/src/wiring/workspace.ts` | `pendingLoop()` → `createLoop(...)` from the workspace's db / write queue / SafeWriter / scheduler / spawner / settings / trust / secrets / events / renderer. Loop domain events: `job.accepted`, `round.completed`, `checkpoint.undone` → re-index the written files through the watcher's serialized chain (own threads never turn stale), then the doc-sync estimate; `files.touched` → blocks citing the paths go stale. `recover()` on start, `close()` on unload, `busy()`/counts/badges from the real review + jobs |
| `packages/server/src/wiring/loop-routes.ts` | 38 routes: threads (CRUD, messages, transition, reanchor, promote, bundle, reply, propose-resolution), review (status, estimate, finish, wait, rounds complete / withdraw), jobs (estimate, create, list, get, events, diff, prompt, cancel, gates/run, accept, reject, revise, retry, commit, pr), prompt, patches, checkpoints (+ undo), touch. `wiring/loop.ts` carries the structural types of the extras. Inbox rows of the loop are served |
| `test/int/int06.test.ts` | INT-06, 12 tests (below) |
| `docs/design/cr-requests/loop-wiring.md` | 7 contract gaps, each with its `CR-PENDING(loop-wiring)` workaround |

## INT-06 (`scripts/nd bun test test/int/int06.test.ts`, ≈ 2–5 s)

go-small → thread anchored to the retry loop of `internal/meta/fetch.go` (stamped blob / snippet) → Explain (answer/1 with a
cite, thread `answered`) → Fix "再試行回数を設定可能に" (patch/1: 2 edits, `new_text` deliberately mis-formatted; input ≤ 3k, output
≤ 1.5k) → the gofmt gate is `untrusted` → trust it (browser session > 60 s via a skewed clock) → `gates/run` → `pass`, autofix
puts `var MaxRetries = 1` right → accept: working tree changed, **uncommitted** (` M`), HEAD / refs / all objects / index / config
/ worktrees / stash of the user's repo byte-identical (side repo), `gofmt -l` and `go vet` clean → other threads over the changed
lines go stale, the job's own does not, anchors follow the new blob → Undo: the original bytes, job `reverted`, thread `open` → an
edit to `README.md` fails the job `E_SCOPE_VIOLATION`, tree untouched → read routes (list / paging / events / diff / copy prompt)
→ Pull: `Finish(pull)` → `GET /review/wait` (waiter + agent headers) → `mitori.review/1` text → bundle → reply → complete, and the
same through the real `mitori review | bundle | touch | reply` commands (exit 0 / 11, `approved:` last stderr line).
Two engine turns in total, two ledger rows, both with the private cwd and lean flags.

Verified: `scripts/nd bun run check` green; `scripts/nd bun test` 2,511 pass / 0 fail (155 s).

## What remains

- **Contract gaps** (CR doc): `LoopDeps` has no `fs` / `env`, `createLoop` no `close()`, `JobRunner.list` / `GitSafety.checkpoints` /
  thread bundle are not contract methods, trust-request ids (loop vs `TrustService`), `trust.decided` cannot re-run gates without
  the consent a manual run implies, long-poll deadline semantics, post-accept `syncBlocks` has no suggestion to publish.
- **Not wired**: `GET/POST /integrations` (installer is still the WP-11 stub), doc proposal routes, `POST /export`, MCP `submit_patch`
  (`externalPatch` → `E_UNSUPPORTED`, WP-08c), agent mode / test gates / repair turns (WP-08c), PR creation. `bundle≈k` in the
  `mitori.review/1` heading (the engine's port is synchronous; the bundle builder is not). Word-level `diffHtml` of doc proposals.
- **Known soft spots**: a continuation (REPAIR / revise) on a resident process that already exited waits for the turn timeout
  instead of failing fast (observed with a test double whose process ends after one turn; the scope-violation path no longer
  gets there); `list` of threads is capped at 500 per call (re-anchoring reads one page).
- **Not run**: the real engine (no `claude -p`), Linux, the web UI against the real routes (the contract is `ApiRoutes`; `e2e/loop`
  from track/10b was not re-run).
