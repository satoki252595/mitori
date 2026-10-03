# loop-wiring — change requests collected while wiring `createLoop` into the workspace (integrate/loop, 2026-10-04)

Found while assembling the review engine, bundle builder, git safety, gate runner and job runner into `createLoop`
(`packages/loop/src/jobs/assemble.ts`) and wiring it into `packages/server/src/wiring/{workspace,loop,loop-routes}.ts`.
Each has a working local workaround marked `// CR-PENDING(loop-wiring)`; no contract file was edited.

## 1. `LoopDeps` has no filesystem reader, child env or blob-reader factory
- contract: `packages/loop/src/contract.ts` `LoopDeps`
- change: add `fs: FsReader` and `env: { PATH: string; HOME: string }` (SAFE_PATH and the user's HOME for git / gate children). The
  side repo's `BlobReader` can then be built inside loop (`createGitReader` from `@mitori/platform`, which loop may import).
- why: `GitSafetyDeps`, `GateRunnerDeps` and `JobRunnerDeps` all need an `FsReader` (index copy, untracked scan, working-tree
  bytes, gate binaries, sandbox paths) and the git / gate child env; neither is derivable from the other `LoopDeps` members.
- workaround in place: `createLoop` reads `fs?` / `env?` structurally from the deps object (`LoopDepsExt` in `jobs/assemble.ts`,
  the server's twin in `wiring/loop.ts`); absent ⇒ `createFsReader()` and `PATH=/usr/bin:/bin`, `HOME=<~/.mitori>`.
- urgency: nice to have (the server always passes them).

## 2. `createLoop` has no lifecycle
- contract: `packages/loop/src/jobs/index.ts` `createLoop` return type
- change: `close(): Promise<void>` (finish / abort running pipelines, close parked engine processes, close the side repo's
  persistent `cat-file --batch`, release `mitori review` waiters with `shutdown`).
- why: the workspace unloads (idle, settings, daemon stop) and the DB closes right after; a running pipeline or a parked
  process must not outlive it.
- workaround in place: the returned object carries `close()`; `wiring/loop.ts loopExtras` narrows to it.
- urgency: before WP-08c (agent mode keeps long-lived processes).

## 3. Reads the routes need that no contract method serves
- contract: `JobRunner`, `GitSafety`, `ReviewEngine` / `BundleBuilder`
- change: `JobRunner.list(q: { state?, thread?, limit?, cursor? }): Page<Job>` (`GET /jobs`); `GitSafety.checkpoints(): Checkpoint[]`
  (`GET /checkpoints`); `ReviewEngine.bundle(id, { budget?, lines?, mode? }): Promise<string>` or a `BundleBuilder.forThread`
  (`GET /threads/:th/bundle`: the thread's write scope, gates and trust come from the same plan inputs as a job).
- why: the server must stay a thin adapter; none of the three can be answered from the contract members, and scope
  derivation (`deriveWriteScope` over the index + doc) is loop's, not the server's.
- workaround in place: `JobRunnerHandle.list`, `createLoop().checkpoints()` and `createLoop().threadBundle()` (non-contract
  members, read structurally by `wiring/loop.ts`).
- urgency: before the web Review pane shows job history.

## 4. Who owns trust-request ids
- contract: `LoopDeps.trust` / `LoopDeps.events` (`trust.request`), server `TrustService.request`
- change: the loop should ask the host to register content (`requestTrust(item, hash, preview)`), not emit an SSE
  `trust.request` with a made-up id; or the SSE payload's `id` must be documented as advisory.
- why: `gateHead` emits `{ type: "trust.request", request: { id: newId("trust"), … } }`; the trust service (state.sqlite
  `srv_trust`) owns the ids a human decides on, so the loop's id could never be decided.
- workaround in place: the workspace wraps `LoopDeps.events`: a `trust.request` from the loop becomes
  `TrustService.request(ws, item, hash, preview)` (dedup per hash, the service publishes the real SSE event); `LoopDeps.trust`
  registers `rules` / `git_config` content itself (unknown ⇒ `pending`).
- urgency: nice to have.

## 5. `trust.decided` → re-evaluate jobs waiting for gate trust
- contract: server `DOMAIN_WIRING["trust.decided"]` ("loop.jobs (gates pending trust re-evaluated)")
- change: a `JobRunner` method that re-runs the `untrusted` gates of ready jobs WITHOUT the consent a manual `runGates` implies,
  e.g. `JobRunner.retrust(hash)`.
- why: `runGates` runs with `consent: true` ("the human looked at the diff and clicked run"); calling it from a trust decision
  would run repo-code gates without that click.
- workaround in place: none — the human re-runs the gates from the job card (`POST /jobs/:job/gates/run`), INT-06 does exactly that.
- urgency: nice to have.

## 6. Long-poll routes: deadline vs. disconnect
- contract: server spec §7.4 / `RouteCtx.signal` ("aborted when the client goes away, or at the long-poll deadline")
- change: say that a long-poll handler returns its own `timeout` result and watches only the client's disconnect.
- why: `ReviewEngine.wait` answers `shutdown` for an aborted signal; the HTTP layer aborts `ctx.signal` at `timeoutMs`, the same
  instant as the engine's own timer, so a plain pass-through raced `timeout` against `shutdown` (`mitori review --wait-sec 1`
  exited 10 instead of 11). The waiter registry is also started by the HTTP layer, not the handler.
- workaround in place: the `GET /review/wait` adapter passes `ctx.req.signal` (connection only) to the engine.
- urgency: fixed locally; document it.

## 7. Post-accept doc sync has no suggestion to publish
- contract: server `DOMAIN_WIRING["job.accepted" | "round.completed"]` (`gen.syncBlocks(..., {confirm:false})` → `server.publishSuggestions`)
- change: `syncBlocks`' `OnDemandResult` should carry (or be convertible to) `IncrementalSuggestion[]`, or the wiring should call
  `gen.onIndexDelta` with the accept's delta.
- why: with `confirm: false` the call only estimates; its result has no shape `suggestionViews` can publish.
- workaround in place: the estimate call is made (E_UNSUPPORTED tolerated) and its result ignored; the S9 suggestions of the
  `index.delta` chain that the accepted files trigger are published as before.
- urgency: before M4 (INT-09).
