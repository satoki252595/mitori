/**
 * @file mitori — server contract: daemon lifecycle, composition root, workspace runtime, write queues,
 * SSE hub, domain-event wiring, settings resolver, trust, sessions, inbox aggregation, route ownership,
 * and the platform ports only the server consumes (watcher, SAFE_PATH).
 *
 * Status: AUTHORITATIVE (owner: lead architect; added in revision R1 for CONS-02 / SC-05).
 * Prose spec: `docs/design/specs/server.md` (section numbers "§n" below). Package: `@mitori/server`
 * (+ `@mitori/client` for the client half, + `@mitori/platform` for the ports at the end).
 *
 * Rules: the server holds NO domain logic. It authenticates, routes (`ROUTE_META` + {@link ROUTE_OWNERS}),
 * serializes writes ({@link WorkspaceRuntime.write}, {@link StateRuntime.stateWrite}), stamps and fans out
 * events ({@link SseHub}), and wires domain events between packages that may not import each other
 * ({@link DOMAIN_WIRING}; gen ⟂ loop).
 */

import type {
  AnchorHealth,
  Cancel,
  ClaimChecks,
  ClaimId,
  Cite,
  Clock,
  DocId,
  EffectiveSettings,
  EventSink,
  Glob,
  GlobalSettings,
  Hasher,
  Iso8601,
  JobId,
  Logger,
  Metrics,
  Migration,
  PackageName,
  Random,
  RepoPath,
  RepoSettings,
  SafeWriter,
  SecretScanner,
  SessionId,
  Sha256,
  SqlDb,
  ThreadId,
  TrustItemId,
  TrustRecord,
  TrustState,
  WorkspaceInfo,
  WorkspaceKey,
  WorkspaceOverrides,
  WriteQueue,
  FsReader,
  GitReader,
  WorkerPool,
} from "./core.ts";
import type {
  ClientKind,
  InboxFilter,
  InboxItem,
  RouteKey,
  SseEvent,
  SseEventPayload,
  SuggestionView,
  WorkspaceState,
  WorkspaceSummary,
} from "./api.ts";
import type { FsChange, IndexDelta, Indexer, ParseBatchRequest, ParseBatchResponse } from "./indexer.ts";
import type { BlockRenderer, DiagramLayouter, DocStore, GenOrchestrator, HtmlExporter, IncrementalOutcome } from "./gen.ts";
import type {
  AgentScheduler,
  AnchorEngine,
  AnchoredItem,
  Engine,
  GitSafety,
  Installer,
  JobRunner,
  LoopDomainEvent,
  ReanchorReport,
  ReviewEngine,
  Spawner,
  ThreadReanchorUpdate,
  UsageLedger,
} from "./loop.ts";

/* ============================================================================
 * 1. Daemon lifecycle (§1)
 * ========================================================================== */

/** Lifecycle constants. [仮] values are re-measured in M1 (server spec §1.6). */
export const DAEMON = {
  /** Exit when every workspace is idle this long (no SSE client, job, waiter, run). Raised from 30 min [UXP-07]. */
  idleExitMs: 4 * 3600_000,
  /** Unload a workspace after this long without clients/jobs/waiters/runs. */
  workspaceUnloadMs: 30 * 60_000,
  /** Shutdown drain: SIGINT engines, wait for results. */
  drainMs: 10_000,
  /** `GET /health` liveness timeout used by the CLI. */
  healthTimeoutMs: 1500,
  /** Lock file stale after the PID is gone AND health fails this many times. */
  lockStaleProbes: 2,
  /** SSE heartbeat. */
  heartbeatMs: 15_000,
  /** Global replay ring (replayable events across all workspaces). */
  ringBufferEvents: 4096,
  /** Browser session idle expiry (sliding). */
  sessionIdleDays: 30,
  /** Login nonce lifetime (single use). */
  nonceTtlMs: 60_000,
  /** Trust decisions from sessions younger than this are rejected (`E_FORBIDDEN`) [SEC-19]. */
  trustMinSessionAgeMs: 60_000,
  /** A `mitori review` waiter counts until this long after its last poll [UXP-01]. */
  waiterGraceMs: 35_000,
  /** Idempotency-key retention. */
  idempotencyTtlMs: 600_000,
  /** Default request read timeout. */
  readTimeoutMs: 15_000,
} as const;

/** What the CLI does when its version differs from the running daemon (§1.4). Pure decision table. */
export type VersionAction =
  /** Same version, or busy daemon with the same apiVersion: use it (warn on version difference). */
  | "use"
  /** Daemon idle (no job, waiter, run): `POST /daemon/shutdown` then start ours; open tabs show a reload banner. */
  | "restart"
  /** apiVersion differs and the daemon is busy ⇒ `E_VERSION_MISMATCH`. */
  | "error";

/** Version decision. Pure. */
export declare function decideVersionAction(cli: { version: string; apiVersion: number }, daemon: { version: string; apiVersion: number; idle: boolean }): VersionAction;

/** Daemon health/lock state written to `~/.mitori/daemon.lock` (O_EXCL; content = pid + startedAt). */
export interface DaemonLock {
  /** PID. */
  pid: number;
  /** Start time. */
  startedAt: Iso8601;
  /** Port. */
  port: number;
}

/* ============================================================================
 * 2. Platform ports only the server consumes (§2)
 * ========================================================================== */

/**
 * Watcher batching (indexer CR-10 applied): leading edge after 5 ms, then coalesce until at most 30 ms after the
 * first event of the batch — so save → stale badge fits the 50 ms budget. Linux backend per O3 (WP-01).
 */
export const WATCH_BATCH = { leadingMs: 5, maxWaitMs: 30 } as const;

/** Paths the doc watcher ignores inside docDir (the session engine writes there) [CONS-20]. */
export const DOC_WATCH_IGNORE = ["cache/**", "tmp/**"] as const satisfies readonly Glob[];

/** Recursive filesystem watcher (macOS/Windows: `fs.watch` recursive; Linux: O3 decision). */
export interface FsWatcher {
  /** Watch `root`; `cb` receives batched, repo-relative changes (+ `{kind:"git"}` for index/HEAD/refs). Returns stop. */
  watch(root: string, opts: { ignore: readonly Glob[]; gitDir: string | null }, cb: (batch: FsChange[]) => void): () => void;
}

/**
 * SAFE_PATH (§2.3) [SEC-10]: from the daemon's start env, drop empty/relative PATH entries, entries under any
 * registered workspace root or the cwd the CLI was started in, `node_modules/.bin`, `.venv/bin`; the daemon then
 * `chdir`s to `~/.mitori/run/empty`. Pure.
 */
export declare function resolveSafePath(path: string, opts: { workspaceRoots: readonly string[]; startCwd: string }): string;

/* ============================================================================
 * 3. Runtimes: state (global) and workspace (§3)
 * ========================================================================== */

/** Global runtime: `~/.mitori/state.sqlite` and its single writer [CONS-03]. */
export interface StateRuntime {
  /** State DB (`use_*`, `srv_workspaces`, `srv_trust`, `srv_sessions`, `srv_ports`, `srv_idempotency_global`). */
  db: SqlDb;
  /** The ONE writer of state.sqlite (ledger, calibration, trust, sessions, workspace registry). */
  stateWrite: WriteQueue;
}

/** Per-workspace runtime assembled by the composition root. */
export interface WorkspaceRuntime {
  /** Identity. */
  info: WorkspaceInfo;
  /** Lifecycle. */
  state: WorkspaceState;
  /** Workspace DB (`index.sqlite`, WAL). */
  db: SqlDb;
  /** Single writer of this workspace: IMMEDIATE tx, then events are stamped with the next `rev` and published. */
  write: WriteQueue;
  /** Workspace revision (advances once per committed write that emitted events). */
  rev(): number;
  /** Domain services. */
  indexer: Indexer;
  /** Doc store. */
  doc: DocStore;
  /** Generation. */
  gen: GenOrchestrator;
  /** Review / jobs / git / gates. */
  loop: { review: ReviewEngine; jobs: JobRunner; git: GitSafety };
  /** Effective settings (re-resolved on config change). */
  settings(): EffectiveSettings;
  /** Workspace event sink (server stamps ws/rev/seq). */
  events: EventSink<SseEventPayload>;
}

/** Workspace manager (§3.2): lazy load (DB open → migrations → warm scan → watcher), unload when idle. */
export interface WorkspaceManager {
  /** Open by path or GitHub URL (`E_WS_NOT_PROJECT` guard unless `force`; registers in `srv_workspaces`). */
  open(target: string, opts: { force: boolean }): Promise<WorkspaceRuntime>;
  /** Loaded or loadable runtime (lazy). */
  get(ws: WorkspaceKey): Promise<WorkspaceRuntime>;
  /** Registered workspace for a repo toplevel, WITHOUT opening it (touch hook path) [SEC-21, UXP-32]. */
  registered(toplevel: string): WorkspaceKey | null;
  /** Summaries (Launcher). */
  list(): WorkspaceSummary[];
  /** Unload (keeps registration). */
  unload(ws: WorkspaceKey): Promise<void>;
  /** Forget (unregister; keeps `~/.mitori/repos/<ws>` unless `purge`). */
  forget(ws: WorkspaceKey, purge: boolean): Promise<void>;
}

/** Migration application order per DB (forward-only; recorded in `srv_migrations`) (§3.4). */
export const MIGRATION_ORDER = {
  workspace: ["@mitori/server", "@mitori/indexer", "@mitori/doc", "@mitori/gen", "@mitori/loop"],
  state: ["@mitori/server", "@mitori/agent"],
} as const satisfies Record<Migration["db"], readonly PackageName[]>;

/* ============================================================================
 * 4. Domain wiring (§4) — the only place packages that cannot import each other meet
 * ========================================================================== */

/** Server-level domain events (sources: indexer delta, loop domain events, doc/gen/settings/trust). */
export type ServerDomainEvent =
  | { type: "index.delta"; ws: WorkspaceKey; delta: IndexDelta }
  | (LoopDomainEvent & { ws: WorkspaceKey })
  | { type: "doc.external_edit"; ws: WorkspaceKey; files: string[] }
  | { type: "gen.incremental"; ws: WorkspaceKey; outcome: IncrementalOutcome }
  | { type: "settings.changed"; scope: "global" | "workspace"; ws: WorkspaceKey | null }
  | { type: "trust.decided"; ws: WorkspaceKey; record: TrustRecord };

/** One wiring step. `queue: "inside"` = runs inside the workspace write slot of the triggering write; `"own"` = its own slot; `"outside"` = no slot (pure/compute; results applied in a later `"own"` slot). */
export interface WiringStep {
  /** Callee (`<runtime member>.<method>`). */
  call: string;
  /** Write-queue placement. */
  queue: "inside" | "own" | "outside";
  /** SSE payload types this step may emit. */
  emits: readonly SseEventPayload["type"][];
}

/**
 * The wiring table (§4.2), executed in order per event. Ordering invariants:
 * (W1) re-anchoring of claims AND threads happens in ONE `AnchorEngine.reanchor` call per delta, before any stale
 *      marking; (W2) `doc.setClaimChecks` and `review.applyReanchor` for the same delta run in the SAME slot, so no
 *      reader sees claims moved but threads not; (W3) gen suggestions are computed outside the queue and published
 *      in their own slot; (W4) the accept lock (job_locks) is taken BEFORE entering the write slot and released
 *      after it (never awaited inside a slot).
 */
export const DOMAIN_WIRING = {
  "index.delta": [
    { call: "server.assembleAnchoredItems", queue: "outside", emits: [] },
    { call: "anchors.reanchor", queue: "outside", emits: [] },
    { call: "server.distributeReanchor → doc.setClaimChecks + review.applyReanchor + doc.setFreshness", queue: "own", emits: ["doc.claims", "doc.freshness", "thread.upsert"] },
    { call: "indexer.unpinBlobs / pinBlobs (old vs new anchor blobs)", queue: "own", emits: [] },
    { call: "gen.onIndexDelta", queue: "outside", emits: [] },
    { call: "server.publishSuggestions", queue: "own", emits: ["gen.suggestions"] },
    { call: "server.paletteDigest", queue: "outside", emits: ["palette.changed"] },
  ],
  "job.accepted": [
    { call: "doc.flush({force}) when docCommitted && autoCommit (CONS-36)", queue: "inside", emits: ["doc.saved"] },
    { call: "review.markStale(hunks, ownThreads)", queue: "own", emits: ["thread.upsert"] },
    { call: "gen.syncBlocks(staleDocTargets, {kind:'job'}, {confirm:false})", queue: "outside", emits: [] },
    { call: "server.publishSuggestions", queue: "own", emits: ["gen.suggestions"] },
  ],
  "round.completed": [
    { call: "indexer.update(files) then the index.delta chain", queue: "outside", emits: [] },
    { call: "gen.syncBlocks(blocksOf(doneThreads), {kind:'round'}, {confirm:false})", queue: "outside", emits: [] },
    { call: "server.publishSuggestions", queue: "own", emits: ["gen.suggestions"] },
  ],
  "checkpoint.undone": [
    { call: "doc.undoAccept(proposals)", queue: "own", emits: ["doc.block.upsert"] },
    { call: "indexer.update(files) then the index.delta chain", queue: "outside", emits: [] },
  ],
  "files.touched": [
    { call: "doc.setFreshness(blocksCiting(paths), 'stale')", queue: "own", emits: ["doc.freshness"] },
  ],
  "doc.external_edit": [
    { call: "doc.load()", queue: "own", emits: ["doc.outline", "doc.block.upsert", "notice"] },
  ],
  "gen.incremental": [
    { call: "server.publishSuggestions", queue: "own", emits: ["gen.suggestions"] },
  ],
  "settings.changed": [
    { call: "server.resolveSettings + indexer.scan({reason:'settings'}) when include/exclude changed", queue: "outside", emits: ["settings.updated"] },
  ],
  "trust.decided": [
    { call: "loop.jobs (gates pending trust re-evaluated)", queue: "own", emits: ["job.upsert"] },
  ],
} as const satisfies Record<ServerDomainEvent["type"], readonly WiringStep[]>;

/**
 * Build the re-anchoring input for one delta (§4.3): every claim cite whose path is in `delta.changed`/`renames`
 * (`kind: "cite"`, in claim-id then cite-index order) followed by every non-resolved thread whose code member's
 * path changed (`kind: "thread"`, thread-id order). Doc-primary threads contribute their code member only when it
 * was captured explicitly; otherwise they follow their claim. Pure given the stores.
 */
export declare function assembleAnchoredItems(delta: IndexDelta, doc: Pick<DocStore, "index">, threads: readonly { id: ThreadId; code?: Cite | null }[]): AnchoredItem[];

/** Distribute a report back (same order as the items) [§4.3]. Pure. */
export declare function distributeReanchor(
  items: readonly AnchoredItem[],
  report: ReanchorReport,
): {
  /** Claim updates for `DocStore.setClaimChecks` (moved cites re-rendered; overlapped ⇒ verdict `stale`). */
  claims: { id: ClaimId; cites: Cite[]; checks: ClaimChecks; stale: boolean }[];
  /** Thread updates for `ReviewEngine.applyReanchor`. */
  threads: ThreadReanchorUpdate[];
  /** Counts by health (metrics, `mitori doctor`). */
  counts: Record<AnchorHealth, number>;
};

/* ============================================================================
 * 5. SSE hub (§5) [CONS-04, PT-01]
 * ========================================================================== */

/** One connected SSE stream. */
export interface SseConnection {
  /** Workspace filter (null = global events only). */
  ws: WorkspaceKey | null;
  /** Session (browser) or client kind. */
  client: ClientKind;
  /** Send a stamped event (already coalesced). */
  send(e: SseEvent): void;
  /** Send a comment line (`: hb`). */
  comment(text: string): void;
  /** Closed. */
  closed: boolean;
}

/** SSE hub: stamps `seq` (daemon-global), `ws`, `rev`, `at`; coalesces per `SSE_EVENT_META.coalesce`; replays. */
export interface SseHub {
  /** Publish a payload. `rev` is the workspace rev after the write (null for global). Never throws. */
  publish(payload: SseEventPayload, ws: WorkspaceKey | null, rev: number | null): void;
  /** Attach a connection, replaying from `last` (seq) or sending `resync` (gap, other boot). */
  attach(conn: SseConnection, last: number | null, boot: string | null): void;
  /** Current seq. */
  seq(): number;
  /** Random id of this daemon start (`hello.boot`). */
  readonly boot: string;
}

/* ============================================================================
 * 6. Settings resolver (§6) [CONS-25, SEC-06, SEC-22]
 * ========================================================================== */

/** Built-in defaults of the global settings (the WP-00 golden; budgets in bench/budgets/*.json mirror the limits). */
export declare const DEFAULT_GLOBAL_SETTINGS: GlobalSettings;

/**
 * Resolve effective settings: defaults ← global ← workspace override ← repo (only keys whose SETTING_SCOPES row
 * includes `repo`; others go to `ignoredRepoKeys` + `notice.settings.ignoredRepoKeys`). `denyGlobs` =
 * DEFAULT_DENY_GLOBS ∪ global.security.denyGlobs ∪ repo.denyGlobs ∪ `<docDir>/**`; gates/rules need trust. Pure.
 */
export declare function resolveSettings(input: {
  global: GlobalSettings;
  overrides: WorkspaceOverrides;
  repoRaw: unknown;
  info: WorkspaceInfo;
  trust: (item: TrustRecord["item"], hash: Sha256) => TrustState;
  sandbox: EffectiveSettings["gateSandbox"];
}): EffectiveSettings & { repoParsed: RepoSettings };

/** Validate a `PATCH /settings` patch: any path under EXEC_SETTING_KEYS ⇒ `E_FORBIDDEN_KEY` (decreases of `limits.*` allowed). Pure. */
export declare function checkSettingsPatch(patch: unknown, current: GlobalSettings): { ok: true } | { ok: false; paths: string[] };

/* ============================================================================
 * 7. Trust, sessions, inbox (§7)
 * ========================================================================== */

/** Trust service (state.sqlite `srv_trust`; writes via stateWrite). */
export interface TrustService {
  /** Current state for an item + hash. */
  state(ws: WorkspaceKey, item: TrustRecord["item"], hash: Sha256): TrustState;
  /** Register content seen (emits `trust.request` once per hash). Remote-readonly gates start `denied`. */
  request(ws: WorkspaceKey, item: TrustRecord["item"], hash: Sha256, preview: string): TrustItemId;
  /** Human decision (web session ≥ DAEMON.trustMinSessionAgeMs old) [SEC-19]. */
  decide(id: TrustItemId, decision: "trusted" | "denied", session: SessionId): Promise<TrustRecord>;
}

/** Browser session service (ADR-0009 R1) [SEC-06, UXP-07]. */
export interface SessionService {
  /** Exchange a nonce (single use, 60 s) for a session token. */
  exchange(nonce: string): Promise<{ token: string; session: SessionId; expiresAt: Iso8601 }>;
  /** Verify `Mitori-Session <token>` (constant-time over HMAC(session.key, token)); slides expiry. */
  verify(token: string): { session: SessionId; createdAt: Iso8601 } | null;
  /** Revoke one or all (`mitori doctor --rotate-session` rotates `~/.mitori/session.key`). */
  revoke(session: SessionId | "all"): Promise<void>;
}

/** Authenticated caller context attached to every request. */
export interface AuthContext {
  /** Declared client kind (misuse prevention only). */
  client: ClientKind;
  /** Browser session. */
  session?: SessionId;
  /** Bearer used. */
  bearer: boolean;
  /** Pull-plane agent label (`x-mitori-agent`). */
  agent?: string;
  /** Long-poll waiter id (`x-mitori-waiter`). */
  waiter?: string;
}

/** Inbox sources merged by the server (§7.3). */
export interface InboxSources {
  /** Loop rows (threads, jobs). */
  loop: InboxItem[];
  /** Doc proposals. */
  proposals: InboxItem[];
  /** Pending trust requests. */
  trust: InboxItem[];
  /** Active / failed gen runs. */
  genRuns: InboxItem[];
  /** Suggestions. */
  suggestions: SuggestionView[];
}

/** Merge + filter + sort (`updatedAt` desc, then kind order thread < job < proposal < trust < gen_run < suggestion, then id). Pure. */
export declare function buildInbox(sources: InboxSources, filter: InboxFilter | null): InboxItem[];

/* ============================================================================
 * 8. Route ownership (§8) — which runtime member implements each route (handler = thin adapter)
 * ========================================================================== */

/** Owner of a route handler. */
export type RouteOwner = "server" | "indexer" | "doc" | "gen" | "loop" | "agent";

/** Exhaustive ownership table (CI: every RouteKey has an owner and a handler). */
export const ROUTE_OWNERS = {
  "GET /health": "server",
  "GET /daemon": "server",
  "POST /daemon/shutdown": "server",
  "POST /auth/nonce": "server",
  "POST /auth/exchange": "server",
  "POST /auth/logout": "server",
  "GET /events": "server",
  "GET /engines": "agent",
  "POST /engines/:engine/probe": "agent",
  "POST /engines/:engine/repin": "agent",
  "GET /settings": "server",
  "PATCH /settings": "server",
  "PATCH /settings/exec": "server",
  "GET /usage/summary": "agent",
  "GET /usage/records": "agent",
  "GET /workspaces": "server",
  "POST /workspaces": "server",
  "DELETE /workspaces/:ws": "server",
  "GET /integrations": "loop",
  "POST /integrations/:target/install": "loop",
  "GET /ws/:ws": "server",
  "POST /ws/:ws/init": "server",
  "GET /ws/:ws/scan": "indexer",
  "POST /ws/:ws/scan": "indexer",
  "GET /ws/:ws/settings": "server",
  "PATCH /ws/:ws/settings": "server",
  "GET /ws/:ws/trust": "server",
  "POST /ws/:ws/trust/:tr": "server",
  "GET /ws/:ws/git": "server",
  "GET /ws/:ws/map": "doc",
  "GET /ws/:ws/graph": "indexer",
  "GET /ws/:ws/modules": "indexer",
  "GET /ws/:ws/facts": "indexer",
  "GET /ws/:ws/symbols": "indexer",
  "GET /ws/:ws/files/tree": "indexer",
  "GET /ws/:ws/files/content": "indexer",
  "GET /ws/:ws/cite": "indexer",
  "GET /ws/:ws/diagrams/:dg": "doc",
  "GET /ws/:ws/doc": "doc",
  "GET /ws/:ws/doc/sections/:section": "doc",
  "POST /ws/:ws/doc/sections/:section/translate": "doc",
  "GET /ws/:ws/doc/text": "doc",
  "GET /ws/:ws/doc/blocks/:block": "doc",
  "POST /ws/:ws/doc/blocks/:block/edit": "doc",
  "POST /ws/:ws/doc/blocks/:block/revert": "doc",
  "POST /ws/:ws/doc/blocks/:block/verify": "doc",
  "GET /ws/:ws/doc/blocks/:block/history": "doc",
  "POST /ws/:ws/doc/blocks/:block/expand": "doc",
  "POST /ws/:ws/doc/blocks/:block/simplify": "doc",
  "POST /ws/:ws/doc/blocks/:block/translate": "doc",
  "GET /ws/:ws/doc/proposals": "doc",
  "POST /ws/:ws/doc/proposals/:pp/accept": "doc",
  "POST /ws/:ws/doc/proposals/:pp/reject": "doc",
  "GET /ws/:ws/decisions": "doc",
  "GET /ws/:ws/search": "indexer",
  "GET /ws/:ws/search/palette": "indexer",
  "GET /ws/:ws/threads": "loop",
  "POST /ws/:ws/threads": "loop",
  "GET /ws/:ws/threads/:th": "loop",
  "PATCH /ws/:ws/threads/:th": "loop",
  "DELETE /ws/:ws/threads/:th": "loop",
  "POST /ws/:ws/threads/:th/messages": "loop",
  "POST /ws/:ws/threads/:th/transition": "loop",
  "POST /ws/:ws/threads/:th/reanchor": "loop",
  "POST /ws/:ws/threads/:th/promote": "loop",
  "GET /ws/:ws/threads/:th/bundle": "loop",
  "POST /ws/:ws/threads/:th/reply": "loop",
  "POST /ws/:ws/threads/:th/propose-resolution": "loop",
  "GET /ws/:ws/review": "loop",
  "POST /ws/:ws/review/estimate": "loop",
  "POST /ws/:ws/review/finish": "loop",
  "GET /ws/:ws/review/wait": "loop",
  "POST /ws/:ws/review/rounds/:n/complete": "loop",
  "POST /ws/:ws/review/rounds/:n/withdraw": "loop",
  "POST /ws/:ws/jobs/estimate": "loop",
  "POST /ws/:ws/jobs": "loop",
  "GET /ws/:ws/jobs": "loop",
  "GET /ws/:ws/jobs/:job": "loop",
  "GET /ws/:ws/jobs/:job/events": "loop",
  "GET /ws/:ws/jobs/:job/diff": "loop",
  "GET /ws/:ws/jobs/:job/prompt": "loop",
  "POST /ws/:ws/jobs/:job/cancel": "loop",
  "POST /ws/:ws/jobs/:job/gates/run": "loop",
  "POST /ws/:ws/jobs/:job/accept": "loop",
  "POST /ws/:ws/jobs/:job/reject": "loop",
  "POST /ws/:ws/jobs/:job/revise": "loop",
  "POST /ws/:ws/jobs/:job/retry": "loop",
  "POST /ws/:ws/jobs/:job/commit": "loop",
  "POST /ws/:ws/jobs/:job/pr": "loop",
  "POST /ws/:ws/prompt": "loop",
  "POST /ws/:ws/patches": "loop",
  "GET /ws/:ws/checkpoints": "loop",
  "POST /ws/:ws/checkpoints/:ck/undo": "loop",
  "POST /ws/:ws/gen/estimate": "gen",
  "POST /ws/:ws/gen/runs": "gen",
  "GET /ws/:ws/gen/runs": "gen",
  "GET /ws/:ws/gen/runs/:run": "gen",
  "POST /ws/:ws/gen/runs/:run/control": "gen",
  "POST /ws/:ws/gen/prioritize": "gen",
  "GET /ws/:ws/gen/suggestions": "gen",
  "POST /ws/:ws/gen/suggestions/:sg/run": "gen",
  "POST /ws/:ws/gen/prep": "gen",
  "POST /ws/:ws/gen/ingest": "gen",
  "GET /ws/:ws/inbox": "server",
  "POST /ws/:ws/touch": "loop",
  "GET /ws/:ws/digest": "indexer",
  "POST /ws/:ws/check": "gen",
  "POST /ws/:ws/export": "doc",
  "GET /ws/:ws/export/html": "doc",
} as const satisfies Record<RouteKey, RouteOwner>;

/* ============================================================================
 * 9. HTTP gate order and status mapping (§9)
 * ========================================================================== */

/** Request pipeline order; the first failing check decides the status. */
export const HTTP_PIPELINE = [
  { check: "host", fail: 421, code: "E_BAD_HOST" },
  { check: "route-exists", fail: 404, code: "E_NOT_FOUND" },
  { check: "auth", fail: 401, code: "E_AUTH_REQUIRED" },
  { check: "csrf", fail: 403, code: "E_CSRF" },
  { check: "client-kind", fail: 403, code: "E_FORBIDDEN" },
  { check: "content-type", fail: 415, code: "E_INVALID_INPUT" },
  { check: "body-size", fail: 413, code: "E_PAYLOAD_TOO_LARGE" },
  { check: "idempotency", fail: 409, code: "E_CONFLICT" },
  { check: "workspace", fail: 404, code: "E_WS_NOT_FOUND" },
] as const;

/* ============================================================================
 * 10. Composition root (§10)
 * ========================================================================== */

/** Everything `createServer` needs (production: platform adapters; tests: fakes from `@mitori/<pkg>/testing`). */
export interface ServerDeps {
  /** `~/.mitori` (or `MITORI_HOME`). */
  home: string;
  /** Build flavour (HealthRes.build). */
  build: "release" | "test";
  /** Clock. */
  clock: Clock;
  /** Random. */
  random: Random;
  /** Hasher. */
  hasher: Hasher;
  /** Logger. */
  log: Logger;
  /** Metrics. */
  metrics: Metrics;
  /** Open a SQLite DB (WAL). */
  openDb(path: string): SqlDb;
  /** Spawner (argv only). */
  spawner: Spawner;
  /** Filesystem reader. */
  fs: FsReader;
  /** The only writer. */
  safeWrite: SafeWriter;
  /** Watcher. */
  watcher: FsWatcher;
  /** Git reader factory (normal / shadow / side). */
  git(info: WorkspaceInfo): GitReader;
  /** Worker pools: parse (indexer), ELK, compute (Shiki/diff). */
  pools: {
    parse(size: number): WorkerPool<ParseBatchRequest, ParseBatchResponse>;
    elk: WorkerPool<{ ir: unknown; kind: "layered" | "floorplan"; prev: unknown }, unknown>;
    compute: WorkerPool<unknown, unknown>;
  };
  /** Secret scanner (core). */
  secrets: SecretScanner;
  /** Embedded web assets (path → bytes, precompressed variants). */
  assets: ReadonlyMap<string, { raw: Uint8Array; br?: Uint8Array; gz?: Uint8Array; immutable: boolean }>;
  /** Viewer bundle for exports. */
  viewerAssets: { js: string; css: string; jsSha256: Sha256 };
  /** SAFE_PATH env for every child. */
  safePath: string;
  /** Daemon start env (scrubbed per child). */
  env: Readonly<Record<string, string | undefined>>;
  /** mitori's own realpath (hooks/MCP templates). */
  mitoriBin: string;
}

/** A running server. */
export interface ServerHandle {
  /** Port. */
  port: number;
  /** State runtime. */
  state: StateRuntime;
  /** Workspaces. */
  workspaces: WorkspaceManager;
  /** Scheduler (shared). */
  scheduler: AgentScheduler;
  /** Ledger. */
  ledger: UsageLedger;
  /** Engines. */
  engines: Record<string, Engine | null>;
  /** Anchor engine (shared, pure). */
  anchors: AnchorEngine;
  /** Installer (global). */
  installer: Installer;
  /** SSE hub. */
  hub: SseHub;
  /** Doc rendering services shared by workspaces. */
  render: { renderer: BlockRenderer; layouter: DiagramLayouter; exporter(ws: WorkspaceKey): HtmlExporter };
  /** Graceful stop (drain scheduler, `server.shutdown`, waiters approved=false). */
  stop(reason: string, signal?: Cancel): Promise<void>;
}

/** The composition root (`packages/server/src/compose.ts`). The ONLY place where implementations meet. */
export declare function createServer(deps: ServerDeps): Promise<ServerHandle>;

/* ============================================================================
 * 11. `GET /ws/:ws/doc/text` format (§11) [CONS-17]
 * ========================================================================== */

/**
 * Plain-text doc export for agents/MCP (`ref` = section id, block id, or `*` = whole doc in reading order;
 * `depth` = max Depth index 0–3 included). Output: FILE-form Markdown of the selected blocks, each preceded by
 * `<!-- b_xxxxxxxx §<section> L<depth> -->`, wrapped in the UNTRUSTED_FENCE when served to MCP. ≤ 400k chars.
 */
export const DOC_TEXT = { maxChars: 400_000, separator: "\n\n" } as const;

/** Doc id → workspace resolution for portable permalinks `/d/<docId>/b/<block>` [UXP-13]. */
export declare function resolveDocId(doc: DocId, registry: readonly { key: WorkspaceKey; docId?: DocId }[]): WorkspaceKey | null;

/** Jobs whose accept is blocked by a path lock (accept lock order, W4). */
export interface AcceptLockView {
  /** Path. */
  path: RepoPath;
  /** Holding job. */
  job: JobId;
}
