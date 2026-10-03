# WP-INT — change requests collected at the M1 integration (2026-10-03)

> **Answered in CR batch 2 (2026-10-03)** — decisions in `packages/core/CR-LEDGER.md` §5 (CR m1-1 … CR m1-121). Append new requests below this line.

Found while wiring every WP's main into the composition root (`packages/server/src/{compose.ts,wiring/}`) and running
INT-00..05 plus the binary on crit / m3e-canvas / go-small. Each has a working local workaround marked
`// CR-PENDING(WP-INT)` (or the owner's own marker). Requests other WPs already filed are referenced, not repeated.

## A. Provisional re-exports to ratify (applied in `packages/*/src/index.ts`, INDEX.md +4)

## Ratify or revert the four provisional public names
- contract: `packages/gen/src/index.ts` `createPromptRenderer`; `packages/agent/src/index.ts` `createUsageLedger`;
  `packages/doc/src/index.ts` `createHighlight`, `elkLayout`
- change: move each export into its sub-directory `index.ts` as a contract name (as proposed by WP-06 R3, WP-05 #1,
  WP-04 "worker-side halves"), or replace them with the factories those CRs propose.
- why: `GenDeps.prompts`, `ServerHandle.ledger`, the compute Worker (`HighlightReq → html`) and the doc layouter's ELK
  pool (`{ir} → DiagramLayout`) cannot be built from contract names; without them there is no daemon.
- workaround in place: the re-exports, each with a `CR-PENDING(WP-INT)` comment.
- urgency: blocks nothing now; the architect's decision makes them official or replaces them.

## B. Server contract (`packages/server/src/contract.ts`)

## `ServerDeps` lacks the daemon identity and the lock (same as WP-09's request)
- contract: `ServerDeps`
- change: `version: string; pid: number; userHome: string; port?: number; gateSandbox: EffectiveSettings["gateSandbox"]`.
- why: `startDaemon` needs all of them (health, registry, not-a-project guard, preferred port).
- workaround in place: `ServerDepsExt` read structurally in compose.ts (the CLI passes them).
- urgency: nice to have.

## The daemon lock: `LockFilePort` vs `@mitori/platform` `acquireLock`
- contract: server `DaemonLock` / platform `lock/`
- change: either `startDaemon` accepts an already-acquired lock (`{ release(): void }`), or platform exports the
  synchronous O_EXCL primitive WP-09's `LockFilePort` expects.
- why: platform has the stale-holder logic but no sync `tryCreate`; the server may not `unlink` itself (boundaries).
- workaround in place: `wiring/ports.ts holdDaemonLock` takes the platform lock first and hands `startDaemon` a port
  whose `tryCreate` is a no-op and whose `remove` goes through `SafeWriter.remove` (awaited in `ServerHandle.stop`).
- urgency: nice to have.

## What `createServer` does when the home already has a daemon
- contract: `createServer` doc comment
- change: specify `throws MitoriError("E_CONFLICT", …, { params: { pid, port } })` (what compose.ts does); the CLI then
  prints the running daemon's URL and opens the workspace there.
- urgency: nice to have (documentation).

## `distributeReanchor` cannot produce full `ClaimChecks` nor a full thread `Anchor`
- contract: `distributeReanchor(items, report)`, `assembleAnchoredItems(delta, doc, threads)`
- change: pass what the outputs need — e.g. `assembleAnchoredItems(…, threads: { id; anchor: Anchor }[])` and
  `distributeReanchor(items, report, claims: Pick<DocStore, "index">)` — or let the outputs be partial
  (`checks: Pick<ClaimChecks, "l0" | "l2">`, `code: CodeAnchor`) and say the wiring merges.
- why: `setClaimChecks` takes full checks (l1 / checkedAt are unknown to the report); `applyReanchor` replaces the whole
  anchor (`{...t, anchor: u.anchor}`), but only the code member is in the item.
- workaround in place: `wiring/index.ts` returns l1 `"vacuous"` / an empty `checkedAt` and `{primary:"code", code}`;
  `wiring/workspace.ts applyDelta` merges them with the stored claim and the thread's stored anchor inside the slot.
- also: a claim with one changed cite contributes ALL its cites (so `cites` replaces the array completely); the doc
  comment says only changed-path cites — please amend.
- urgency: nice to have (correct today through the merge).

## `ServerHandle.render` cannot be daemon-wide
- contract: `ServerHandle.render`
- change: drop it, or make it `render(ws)`: `createBlockRenderer` / `createDiagramLayouter` take the WORKSPACE DB
  (`doc_html`, `doc_layouts` caches).
- workaround in place: per-workspace instances (`WorkspaceDomain.renderer/layouter`); `ServerHandle.render` members are
  `unsupportedValue` proxies. `installer` too (WP-11's `createInstaller` is still the M0 stub).
- urgency: nice to have.

## `pools.parse(size)` cannot carry the repository's object format
- contract: `ServerDeps.pools.parse`
- change: `parse(size: number, ws: WorkspaceInfo)` (or `objectFormat` in `IndexerDeps`).
- why: `ParseWorkerInit.objectFormat` is per repository (sha1 / sha256); the pool factory has no workspace.
- workaround in place: the Worker entry defaults to `sha1` (`packages/server/src/workers/parse.ts`).
- urgency: before sha256 repositories are supported.

## The WorkspaceManager cannot update a registration
- contract: `WorkspaceManager`
- change: `update(ws, patch: Partial<Pick<WorkspaceInfo, "docDir" | "docCommitted">>): Promise<WorkspaceInfo>`.
- why: `POST /ws/:ws/init {commit:true}` must flip `docCommitted` (the doc's `.gitignore` depends on it).
- workaround in place: compose.ts `domain.init` mutates `rt.info` (the same object the manager registered; persisted on
  the next registry write) and writes `.gitattributes` through `SafeWriter` kind `repo_meta`. The AGENTS.md block is
  the installer's (WP-11).
- urgency: before M2's "commit `.mitori/`" flow is user-facing.

## C. Other packages

## Gen internals the composition root needs (WP-06 R3 / R5)
- `GenInternal.verifier` (the doc store's `ClaimStamper`) and `GenInternal.idle()` (wait for in-flight calls before the
  workspace DB closes) are read from the `createGen` result structurally; `GenDeps.fs` is passed structurally.
- gen bug found: after `control(run, "pause")`, in-flight calls still write `gen.task` rows; when the DB closed in the
  meantime the rejection was unhandled. Workaround: compose pauses, then waits (≤ 3 s) for `idle()` before closing.
- `GET /ws/:ws/gen/runs` can only list the active run: `GenOrchestrator` has no `runs(page)`.

## Indexer pieces no WP owned (WP-02 / WP-03 seam)
- module / repo skeletons, `moduleContext`, `hotBodies`, `rationaleComments` (spec §7.2–7.3, §7.8): gen's planner and
  prompts call them, neither WP-02 nor WP-03 implemented them. `packages/indexer/src/update/later.ts` has minimal
  versions (rank-ordered file skeletons folded from the bottom, no hot bodies, no rationale). Please assign an owner.
- `update()` re-runs S2 over the whole snapshot (resolve + link ≈ 24 ms on crit) — an incremental S2 is needed for
  `idx.update.1file` / `ui.staleBadge` targets on 100k-LOC repos.
- an editor-style save (write tmp + rename) arrives as `[delete tmp, add path]` then `[change path]`; the facade treats
  the `add` of an existing path as a new file (`oldBlob: null`), so the first delta does not mark the claim stale and a
  second update is needed (crit save → stale badge 80–140 ms). Owner: WP-02 (+ WP-01 watcher event kinds).

## Doc store
- `editBlock` keeps a block's `freshness: "stale"` after the human re-cites it; a re-stamped block should be `fresh`.
- `DocStore.mdLine` (WP-04's request): the server derives `BlockView.mdLine` from the written file (0 until flushed).

## Agent bridge: first-run pinning (spec §1.1 (c))
- the claude-cli engine only knows a binary from `pins.claude` or an absolute `engines.claude-cli.binary`; nothing
  resolves `claude` on SAFE_PATH at daemon start and proposes the pin, so a fresh install shows
  「claude-cli · 見つかりません」 even with Claude Code installed. Owner: WP-05 (resolution + `problems`) and WP-10a (the
  card offers "confirm pin" instead of "install").

## Platform
- `HardwareInfo.perfCores`: the server cannot spawn `sysctl` synchronously; the composition root passes `null` (parse
  pool cap 8 instead of the P-core count). Proposal: `@mitori/platform` `hardwareInfo()`.
- RSS on macOS: `ps` RSS keeps Worker pages that were freed (reusable) — crit loaded and idle shows 689 MB RSS but a
  93 MB physical footprint. Proposal for testing spec §7: measure `srv.rss.*` / `idx.rss.idle` as `phys_footprint` on
  darwin.

## Web
- `mitori:facts:painted` (UI_PERF_MARKS) is never emitted; the M1 measurement uses the MapPage `GET /facts` response.
- the shell's version came from a hard-coded `"dev"`: the CLI's version is now passed by `scripts/gen-assets.ts`
  (inline vite `define`), so the reload banner no longer shows on every start.
