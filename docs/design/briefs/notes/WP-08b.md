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
crs: loop-2, loop-8, loop-9, jdg-7, jdg-8, ux-R18, ux-R19, m0-5, m0-16, m1-6, m1-25, m1-45, m1-55, m1-68, m1-69, m1-70, m1-71, m1-72, m1-73, m1-74, m1-77, m1-79, m1-81, m1-82, m1-83, m1-84, m1-86, m1-87, m1-88, m1-115, m1-120
owns:
  - packages/loop/src/git
  - packages/loop/src/gates
  - packages/loop/src/jobs
---
## Golden / truth / fixtures

- Demo Fix on `go-small` ("make the retry count configurable", WP-00b): patch mode, input ≤ 3k / output ≤ 1.5k
  tokens, gofmt gate, accept → uncommitted working-tree change → Undo restores fully, **user repo refs/objects/
  worktree metadata unchanged** (GIT-S-06). Engines replay recordings (`fixtures/agent-streams/`) — no real calls.
- Go/Rust/Python toolchains for gates: in both `devShells.default` and `ci` (CR m0-16); run them via `scripts/nd`.

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

## CR batch 2 (2026-10-03, ledger §5) — what changed for you

- **S6 stream continuation (CR m1-120)**: you may edit `packages/loop/src/{review,router,bundle,contracts}/` for these
  items only: `ReviewEngine.recordTouched(paths)` (stub in `review/engine.ts`, CR m1-72), `create/patch(…, captured?)`
  using the passed `CapturedAnchor` (CR m1-68), `renderReviewStdout` entries `bundleTokens?` (CR m1-69),
  `planBatch` partitions by route group (question vs sent note, CR m1-86 (a)), `deriveWriteScope` ctx
  `sectionOfBlock? / refsOfDiagram? / writable?` (CR m1-82), swap `contracts/text.ts` copies for `@mitori/anchor`
  imports (CR m1-86 (e)).
- **`createLoop` return type gained `capture(input: AnchorInput, previous: Anchor | null): Promise<CapturedAnchor>`**
  (`jobs/index.ts` stub signature): async capture OUTSIDE the slot (indexer/doc reads + `AnchorEngine`), then the
  server calls `review.create(req, by, captured)` inside it. `CapturedAnchor` moved to the loop contract.
- `LoopDeps.renderMessage(md)` = the workspace `BlockRenderer.renderMessage` (implemented, CR m1-70) — wire it into
  the review engine's `renderMarkdown`.
- `ReviewEngine` now also has `status / waiters / shutdown / snapshots / summary` (implemented by WP-07) and
  `JobRunner.create` must NOT fire T2 for threads Finish already dispatched (`queued` + `batchRound`, CR m1-73).
- `CHANGE_INTENTS = ["change","doc_edit"]`, `note` gone from `ROUTER_RULES` (CR m1-71); `RouteInput.primary?`
  (CR m1-81), `BundleInput.numbered?` (CR m1-83); `readJobFile(job, path)` stays an internal bundle dep you supply from
  `GitSafety` (CR m1-84). Router error actions are comma-separated `error.params.actions` → `JobFailure.actions`.
  `doc_updates[].md` `[path:a-b]` tokens → `RawCite` before `doc.propose` (CR m1-86 (f)). Drop `copy_prompt` from the
  `E_DENY_GLOB` actions (CR m1-86 (g)). Rules trust hash = `sha256(Σ path ␀ text ␀)` sorted by path, identical contents
  once (CR m1-86 (c)).
- **Git hardening (CR m1-88)**: `GIT_ENV` has `GIT_NO_LAZY_FETCH: "1"`; neutralize `GIT_COMMAND_CONFIG_PATTERNS` keys
  through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` env, never `-c <key>=` (a driver named
  `a=b` evades `-c`; WP-01 verified it, see `packages/platform/src/git/reader.ts`).
- The thread half of re-anchoring: `distributeReanchor` hands you only the new CODE member; the server's own-slot step
  merges it into the stored anchor before `applyReanchor` (CR m1-6).
- SafeWriter kind `accept` is unchanged; the doc store re-stamps a proposal's cites on accept (CR m1-55, WP-04).
- Budget pointers in `bench/budgets/loop.json` may point at the existing perf / golden tests (CR m1-77).

## Out of scope

Agent mode, repair loop, promotion, external patches, GitHub PR (WP-08c); bundle/router (WP-08a).
