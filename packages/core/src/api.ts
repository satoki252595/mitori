/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/api.ts` — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/core.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

/**
 * @file mitori — daemon HTTP API + SSE contract.
 *
 * Status: AUTHORITATIVE. Owner: lead architect (server WP implements, client/web/cli consume).
 * Runtime home: `packages/core/src/api.ts` (types + const data), re-exported as `@mitori/core/api`.
 *
 * Conventions
 *  - Base: `http://127.0.0.1:<port>` (loopback only). JSON API under {@link API_PREFIX}.
 *  - Route keys are `"<METHOD> <path>"` relative to {@link API_PREFIX}; `:name` = path param.
 *    Path params are URL-encoded (section ids contain `/`).
 *  - JSON bodies require `content-type: application/json` (non-simple request ⇒ cross-origin
 *    pages cannot send them without a CORS preflight, which the daemon never grants).
 *  - Every `/api/*` route except `GET /health` and `POST /auth/exchange` requires auth (ADR-0009 R1)
 *    [SEC-06, UXP-07]: browser = `authorization: Mitori-Session <token>` (token from `POST /auth/exchange`,
 *    kept in `localStorage` — origin includes the port, so other 127.0.0.1 ports cannot read it; NO auth
 *    cookie exists); CLI/MCP/hook = `authorization: Bearer <token>` (registry 0600, rotated per daemon start).
 *    Browser sessions live in state.sqlite (`srv_sessions`), keyed by HMAC(~/.mitori/session.key, token),
 *    survive daemon restarts, expire after 30 days idle and are revocable (`mitori doctor --rotate-session`).
 *  - State-changing methods enforce CSRF: requests carrying a session token must have
 *    `sec-fetch-site: same-origin` (when present); bearer requests must not carry `sec-fetch-site:
 *    cross-site`. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defence) ⇒ else 421.
 *    `ROUTE_META.clients` is misuse prevention, NOT a security boundary (any same-user process can read the
 *    registry); no security claim depends on it [SEC-19].
 *  - Errors: non-2xx with {@link ApiErrorBody}; status from `ERROR_META[code].http`.
 *  - Optimistic concurrency: mutable entities carry `version`; stale writes ⇒ 409 `E_CONFLICT`.
 *  - Responses to workspace mutations carry header `x-mitori-rev` = workspace revision after
 *    the write, so the client can ignore SSE events it already applied.
 *  - Server → UI push: one SSE stream (`GET /events`). UI → server: POST/PATCH/DELETE.
 */

import type {
  Anchor,
  AuthKind,
  BillingMode,
  BinaryPin,
  BlockAspect,
  BlockHistoryEntry,
  BlockId,
  BlockKind,
  BlockMeta,
  Checkpoint,
  CheckpointId,
  Claim,
  ClaimId,
  Cursor,
  Decision,
  Depth,
  DiagramIR,
  DiagramId,
  DiagramLayout,
  DocLang,
  DocManifest,
  DocProposal,
  EffectiveSettings,
  Effort,
  EngineId,
  ErrorCode,
  Estimate,
  EstimateId,
  EstimateItem,
  ExcludeReason,
  ExecMode,
  Fact,
  FactKind,
  FileDiff,
  Freshness,
  GateId,
  GenEngineId,
  GenEstimate,
  GenRun,
  GenRunId,
  GenTask,
  GitOid,
  GlobalSettings,
  GlossaryEntry,
  HunkId,
  Iso8601,
  Job,
  JobEvent,
  JobId,
  JobKind,
  JobState,
  LineNo,
  Message,
  MitoriErrorData,
  ModelId,
  ModuleId,
  ModuleInfo,
  Page,
  PatchEdit,
  PauseReason,
  PrepId,
  ProposalId,
  ReaderLevel,
  ReadingPath,
  RepoPath,
  RepoProfile,
  RepoSnapshot,
  Resolution,
  Round,
  RouteDecision,
  ScanStage,
  SectionId,
  SectionNode,
  SessionId,
  Sha256,
  SourceLang,
  SubscriptionWindow,
  SuggestionId,
  SymbolEntry,
  SymbolKey,
  TextQuote,
  Thread,
  ThreadId,
  ThreadIntent,
  ThreadState,
  ThreadTrigger,
  TrustItemId,
  TrustRecord,
  UsageRecord,
  UsageTotals,
  Verdict,
  WorkspaceInfo,
  WorkspaceKey,
  WorkspaceOverrides,
  Xxh3,
} from "./domain.ts";

/* ============================================================================
 * 0. Transport constants
 * ========================================================================== */

/** JSON API prefix. Bumped only on breaking changes (`FORMAT.api`). */
export const API_PREFIX = "/api/v1" as const;

/** Non-API browser routes served by the daemon. */
export const PAGE_ROUTES = {
  /** SPA shell (with inline head script restoring pane widths/theme from `mitori_ui`). Unauthenticated (static). */
  app: "/",
  /**
   * Browser login: `GET /auth#n=<nonce>&to=<path>` serves the shell; the SPA reads the FRAGMENT (never sent
   * to the server, never in logs/Referer), calls `POST /auth/exchange {nonce}`, stores the session token in
   * `localStorage[LOCAL_KEYS.session]`, then `history.replaceState(to)` [SEC-06].
   */
  auth: "/auth",
  /** Portable permalink `/d/<docId>/b/<block>` → resolves DocId to a local workspace and redirects [UXP-13]. */
  portable: "/d/",
  /** Hashed immutable assets (`cache-control: public, max-age=31536000, immutable`, br/gzip precompressed). */
  assets: "/assets/",
} as const;

/** Browser storage keys (per origin = per port) [SEC-06]. */
export const LOCAL_KEYS = {
  /** Session token (256-bit base64url). */
  session: "mitori.session",
} as const;

/** Request/response headers. */
export const HTTP_HEADERS = {
  /** `Bearer <token>` — token from `~/.mitori/daemon.json` (mode 0600). CLI/MCP/hook only. */
  authorization: "authorization",
  /** `<ClientKind>/<version>`, e.g. `cli/0.1.0`. Logged; used for client-restricted routes. */
  client: "x-mitori-client",
  /** Pull plane: label of the calling agent (`claude-code`, `codex`, …) → message author `agent:<label>`. */
  agent: "x-mitori-agent",
  /** Optional caller-provided request id (echoed; else server generates `rq_…`). */
  requestId: "x-mitori-request-id",
  /** Response: workspace revision after a mutation. */
  rev: "x-mitori-rev",
  /** `mitori review` long-poll: stable waiter id (one per CLI process) so 25 s re-polls do not flap the waiter count (35 s grace) [UXP-01]. */
  waiter: "x-mitori-waiter",
  /** De-duplicates retried creates (threads, jobs, gen runs, finish). Same key ⇒ same result for 10 min. */
  idempotencyKey: "idempotency-key",
  /** Browser fetch metadata; must be `same-origin` on state-changing requests when present. */
  secFetchSite: "sec-fetch-site",
} as const;

/**
 * Cookies. Only the NON-secret UI-prefs cookie remains (port-agnostic on 127.0.0.1 is fine for prefs).
 * The former `mitori_s` session cookie is removed: cookies are sent to every 127.0.0.1 port the browser
 * visits (dev servers of untrusted repos, forwarded container ports) [SEC-06].
 */
export const COOKIES = {
  /** Readable by JS; UI prefs (theme, pane widths, reader level) for the zero-CLS head script. */
  ui: "mitori_ui",
} as const;

/** Response security headers on EVERY daemon response (SRV-I-012) [SEC-17]. */
export const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'sha256-{headInline}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'self'",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
} as const;

/** Client kinds (header {@link HTTP_HEADERS.client}). */
export type ClientKind = "web" | "cli" | "mcp" | "hook";

/** Error response body for every non-2xx JSON response. */
export interface ApiErrorBody {
  /** Error data. */
  error: MitoriErrorData;
  /** Fresh estimate when an estimate drifted > ±20 % or expired (`E_CONFLICT` on job/gen create) [CONS-33]. */
  estimate?: JobEstimate | GenEstimate;
}

/** Placeholder for "no params / no query". */
export type Empty = Record<string, never>;

/** Typed route description. `body: undefined` ⇒ no request body. */
export interface Route<P, Q, B, R> {
  /** Path params. */
  params: P;
  /** Query string params (strings on the wire; numbers parsed by the server). */
  query: Q;
  /** JSON request body. */
  body: B;
  /** Response (JSON unless {@link RouteMeta.kind} says otherwise). */
  res: R;
}

/** Workspace path param. */
export interface WsParam {
  /** Workspace key. */
  ws: WorkspaceKey;
}

/** Response of a mutation that needs no payload. */
export interface Ok {
  /** Always true. */
  ok: true;
}

/* ============================================================================
 * 1. DTOs — daemon, engines, workspaces
 * ========================================================================== */

/** `GET /health` (unauthenticated; used for liveness + PID-reuse defence). */
export interface HealthRes {
  /** Always true when serving. */
  ok: true;
  /** mitori semver. */
  version: string;
  /** API major version. */
  apiVersion: 1;
  /** Daemon PID (compare with registry). */
  pid: number;
  /** Start time. */
  startedAt: Iso8601;
  /** Build flavour: e2e/eval assert `test`, release smoke asserts `release` [CR test-6]. */
  build: "release" | "test";
  /** `HMAC-SHA256(token, challenge)` hex when called with `?challenge=<32 hex>`; the CLI verifies it BEFORE sending its bearer [SEC-06]. */
  proof?: string;
}

/** Detected engine state. */
export interface EngineStatus {
  /** Engine. */
  engine: EngineId;
  /** Binary found / engine usable. */
  installed: boolean;
  /** CLI version string. */
  version?: string;
  /** Resolved binary path. */
  path?: string;
  /** Auth kind detected (claude-cli: `auth status` + per-run `apiKeySource`). */
  auth: AuthKind;
  /** Plan label (`max`, `pro`, …) when reported. */
  plan?: string;
  /** Capability flags (`init.capabilities` + flag probes such as `system-prompt-file`). */
  capabilities: string[];
  /** Billing interpretation of recent runs. */
  billing: BillingMode;
  /** Last window observation. */
  window?: SubscriptionWindow;
  /** Problems preventing use (e.g. `E_AGENT_CAPABILITY` when `--bare` became default, `E_ENGINE_BINARY_CHANGED`). */
  problems: { code: ErrorCode; message: string }[];
  /** Pinned binary (SEC-10); shown on the engine card. */
  pin?: BinaryPin;
  /** Data-handling disclosure key for this engine × plan (UXP-04). */
  dataPolicyKey?: string;
  /** Last probe time. */
  checkedAt: Iso8601;
}

/** Global agent scheduler state. */
export interface SchedulerStatus {
  /** Configured concurrency. */
  concurrency: number;
  /** Effective concurrency after 429 back-off. */
  effective: number;
  /** Running engine processes. */
  running: number;
  /** Queued requests. */
  queued: number;
  /** True while background generation yields (5h utilization above threshold). */
  yielding: boolean;
  /** Back-off end time after a rate limit. */
  backoffUntil?: Iso8601;
  /** Slots reserved for the interactive lane [PT-04]. */
  reservedInteractive: number;
  /** Pause reason per lane (null = running) [CONS-28]. */
  lanePaused: Record<"interactive" | "doc" | "background", PauseReason | null>;
  /** Warm + parked engine processes and their summed RSS (budget agent.residentProcs ≤ 2, agent.childRss ≤ 600 MB) [PT-13]. */
  resident: { procs: number; rssMb: number };
}

/** `GET /daemon`. */
export interface DaemonStatus {
  /** Version. */
  version: string;
  /** PID. */
  pid: number;
  /** Listening port. */
  port: number;
  /** Uptime. */
  uptimeSec: number;
  /** Loaded workspaces. */
  workspaces: WorkspaceKey[];
  /** Scheduler. */
  scheduler: SchedulerStatus;
  /** Engines. */
  engines: EngineStatus[];
  /** Resident set size. */
  rssMb: number;
}

/** Workspace lifecycle state. */
export type WorkspaceState = "loading" | "scanning" | "ready" | "error";

/** Card on the Launcher (S0) and header. */
export interface WorkspaceSummary {
  /** Identity. */
  info: WorkspaceInfo;
  /** State. */
  state: WorkspaceState;
  /** Counters. */
  counts: {
    /** Tracked files. */
    files: number;
    /** Source LOC. */
    loc: number;
    /** Modules. */
    modules: number;
    /** Open threads (not draft/resolved). */
    openThreads: number;
    /** Stale blocks. */
    staleBlocks: number;
    /** Running jobs. */
    runningJobs: number;
  };
  /** Doc state. */
  doc: {
    /** A doc exists in docDir. */
    exists: boolean;
    /** Last generation time. */
    generatedAt: Iso8601 | null;
    /** Effort of the last run. */
    effort: Effort | null;
    /** Primary language. */
    lang: DocLang | null;
    /** HEAD commits behind the doc snapshot (null when unknown). */
    commitsBehind: number | null;
  };
  /** Last error (state `error`). */
  lastError?: MitoriErrorData;
}

/** Per-language breakdown. */
export interface LanguageStat {
  /** Language. */
  lang: SourceLang;
  /** Files. */
  files: number;
  /** LOC. */
  loc: number;
}

/** Result of a static scan (S0–S4). */
export interface ScanSummaryView {
  /** Tracked files. */
  files: number;
  /** Files fed to generation. */
  included: number;
  /** Excluded per reason. */
  excluded: Partial<Record<ExcludeReason, number>>;
  /** Source LOC. */
  loc: number;
  /** Languages, largest first. */
  languages: LanguageStat[];
  /** Modules (leaf + parent). */
  modules: number;
  /** Facts per kind. */
  facts: Partial<Record<FactKind, number>>;
  /** Naive full-text token estimate (Claude tokenizer). */
  tokensNaive: number;
  /** Token estimate after filtering. */
  tokensFiltered: number;
  /** Scan wall time. */
  ms: number;
  /** Per-stage wall ms (progress UI, bench, `mitori doctor`) [CR idx-13 ≡ CR test-5, merged]. */
  stageMs?: Partial<Record<ScanStage, number>>;
  /** Honest "could not read" counters [CR idx-13]. */
  notes?: { parseErrors: number; degraded: number; timeouts: number };
}

/** Scan state. */
export interface ScanStatus {
  /** State. */
  state: "idle" | "running" | "done" | "failed";
  /** Current stage. */
  stage?: ScanStage;
  /** Units done in the stage. */
  done: number;
  /** Units total in the stage. */
  total: number;
  /** Started at. */
  startedAt?: Iso8601;
  /** Finished at. */
  finishedAt?: Iso8601;
  /** Summary when done. */
  summary?: ScanSummaryView;
  /** Error when failed. */
  error?: MitoriErrorData;
}

/** `GET /ws/:ws`. */
export interface WorkspaceStatus extends WorkspaceSummary {
  /** Current snapshot. */
  snapshot: RepoSnapshot | null;
  /** Scan state. */
  scan: ScanStatus;
  /** Active generation run. */
  gen: GenRun | null;
  /** Pending trust requests. */
  trustPending: number;
  /** i18n keys of settings notices (ignored repo keys etc.). */
  notices: string[];
  /** Workspace revision (SSE `rev` baseline). */
  rev: number;
  /** Browser tabs with a live SSE stream for this workspace; the CLI opens a new tab only when 0 [UXP-01]. */
  connectedTabs: number;
  /** Generation engine actually usable now (defaultGenEngine or its fallback) [CONS-28]. */
  genEngine: GenEngineId | null;
  /**
   * Static repository profile for the S1 hero / header (remote, toolchain, license, HEAD date + tag, README
   * excerpt, LOC tiles) = `Indexer.profile()`; absent until the first scan finished [CR m1-26].
   */
  profile?: RepoProfile;
}

/** Git state shown in the header. */
export interface GitStatusView {
  /** Branch. */
  branch: string | null;
  /** HEAD. */
  head: GitOid | null;
  /** Dirty files. */
  dirty: number;
  /** Checkpoints available for undo. */
  checkpoints: number;
  /** Workspace kind restrictions (`remote-readonly` ⇒ accept exports a patch). */
  readonly: boolean;
}

/* ============================================================================
 * 2. DTOs — map, graph, code
 * ========================================================================== */

/**
 * S1 home: static map + overlays. Zero tokens. MVP renders the ELK `container` diagram
 * (`fallback: "container"`); the floor plan (`diagram.kind === "floorplan"`) is WP-18 behind
 * `ui.map.floorplan` and is used only when its quality gate passes [CONS-10, SC-03].
 */
export interface MapView {
  /** IR of the map (`container` in MVP; `floorplan` when enabled and the gate passed). */
  diagram: DiagramIR;
  /** Server-computed layout. */
  layout: DiagramLayout;
  /** Present when a floor plan was requested but the quality gate failed (or the flag is off). */
  fallback?: "container";
  /** Floor-plan quality metrics (gate: labelFit ≥ 0.70, doorRatio ≥ 0.45, rooms ≤ 40, layoutMs ≤ 30 [仮]). */
  quality?: { labelFit: number; doorRatio: number; rooms: number; layoutMs: number };
  /** Overlay counters keyed by diagram node id. */
  overlays: {
    /** Open threads. */
    comments: Record<string, number>;
    /** Running jobs. */
    working: Record<string, number>;
    /** Git churn (commits touching, last 90 days). ALWAYS empty on shallow / remote-readonly workspaces (`churnUnavailable`). */
    churn: Record<string, number>;
    /** True when churn cannot be computed (shallow clone). */
    churnUnavailable?: boolean;
    /** Freshness of the described section. */
    freshness: Record<string, Freshness>;
  };
  /** Module tree, with up to 5 top files per module for Z3 furniture [JUDGEMENT §9]. */
  modules: (ModuleInfo & { topFiles?: { path: RepoPath; loc: number; symbols: string[] }[] })[];
  /** Blocks of the "5 分で分かる" pane (L0/L1), possibly empty before generation. */
  quick: BlockId[];
}

/** `GET /ws/:ws/graph`. */
export interface GraphView {
  /** Level. */
  level: "module" | "file";
  /** IR. */
  diagram: DiagramIR;
  /** Layout. */
  layout: DiagramLayout;
}

/** `GET /ws/:ws/diagrams/:dg`. */
export interface DiagramView {
  /** IR. */
  diagram: DiagramIR;
  /** Layout. */
  layout: DiagramLayout;
}

/** Compact file-tree node (`GET /ws/:ws/files/tree`). */
export interface FileTreeNode {
  /** Basename (root: repo name). */
  n: string;
  /** Children (directories only). */
  c?: FileTreeNode[];
  /** File language (files only). */
  l?: SourceLang;
  /** LOC (files only). */
  loc?: number;
  /** Exclusion reason (files only). */
  x?: ExcludeReason;
  /** Module (files only). */
  m?: ModuleId;
}

/** Raw file content for CodeMirror (`GET /ws/:ws/files/content`). */
export interface FileContent {
  /** Path. */
  path: RepoPath;
  /** Blob served. */
  blob: GitOid;
  /** Language. */
  lang: SourceLang;
  /** Text of the requested range (whole file when no range; capped at 2MB). */
  text: string;
  /** First line number of `text`. */
  startLine: LineNo;
  /** Total lines of the file. */
  totalLines: number;
  /** Symbols in the range (gutter / outline). */
  symbols: SymbolEntry[];
  /** Doc blocks citing ranges in this file (gutter backlinks). */
  backlinks: { block: BlockId; section: SectionId; start: LineNo; end: LineNo }[];
  /**
   * Server-rendered Shiki (css-variables theme) HTML of `text`, one `span[data-line]` per line; present with
   * `?html=1` (code mode, S3 — the client never highlights) [CR ux-R6]. Tokenized from the per-blob full-file
   * cache (grammar-state checkpoints every 100 lines) so multi-line constructs are correct [PT-16].
   */
  html?: string;
}

/** Hover peek for a citation chip (`GET /ws/:ws/cite`). */
export interface CitePeek {
  /** Path. */
  path: RepoPath;
  /** Cited start. */
  start: LineNo;
  /** Cited end. */
  end: LineNo;
  /** Blob cited. */
  blob: GitOid;
  /** Current blob of the file. */
  currentBlob: GitOid;
  /** True when the cited snippet no longer matches. */
  stale: boolean;
  /** Pre-highlighted HTML (Shiki, server-side) of `firstLine..lastLine`. */
  html: string;
  /** First line in `html` (start − ctx). */
  firstLine: LineNo;
  /** Last line in `html`. */
  lastLine: LineNo;
  /** Enclosing symbol. */
  symbol?: SymbolKey;
  /** Language. */
  lang: SourceLang;
}

/* ============================================================================
 * 3. DTOs — doc
 * ========================================================================== */

/**
 * HTML fragment contract between `@mitori/doc` (renderer) and `@mitori/web` (event delegation).
 * Server-rendered block HTML uses ONLY these class names / data attributes for interactive
 * parts; the client never parses Markdown. Raw HTML from Markdown is disabled.
 */
export const HTML_CONTRACT = {
  /**
   * Block root: `<div class="mb" data-block="b_…" data-kind data-depth data-fresh data-lock data-ln>`
   * (`data-ln` = Markdown line of the block in its doc file) [CR ux-R15]. Client chrome injected inside `.mb`
   * must carry `data-mx` (excluded from ANCHOR_TEXT_RULES).
   */
  block: { cls: "mb", attrs: ["data-block", "data-kind", "data-depth", "data-fresh", "data-lock", "data-ln"] },
  /** Claim span: `<span class="mc" data-claim="cl_…" data-verdict="…">`. */
  claim: { cls: "mc", attrs: ["data-claim", "data-verdict"] },
  /**
   * Citation chip: `<a class="mcite" data-cite="path:start-end" data-blob href="/w/<ws>/code/<path>#L<a>-L<b>">`
   * containing `<span class="cs">login.go:40</span><span class="cl">internal/auth/login.go:40-78</span>`
   * (short/long label by reader level). `href` is built with core `HREFS.code` [CR ux-R15, CONS-23].
   * External links (non-repo) in rendered HTML get `rel="noopener noreferrer"`; external images render as
   * links, never `<img>` [SEC-11, SEC-17].
   */
  cite: { cls: "mcite", attrs: ["data-cite", "data-blob"] },
  /** Glossary term: `<abbr class="mterm" data-term="gl_…" data-first>` (`data-first` on the first use in the doc). */
  term: { cls: "mterm", attrs: ["data-term", "data-first"] },
  /** Code block: `<pre class="mcode shiki" data-lang data-start>` (pre-highlighted, Shiki css-variables theme). */
  code: { cls: "mcode", attrs: ["data-lang", "data-start"] },
  /** Diagram mount point: `<figure class="mdiagram" data-diagram="dg_…" data-w data-h>` + text fallback list. */
  diagram: { cls: "mdiagram", attrs: ["data-diagram", "data-w", "data-h"] },
  /** Foreign Mermaid fence (repo docs only; lazy chunk): `<pre class="mmermaid">`. */
  mermaid: { cls: "mmermaid", attrs: [] },
  /** Deep-dive container: `<details class="mdeep">`. */
  deepdive: { cls: "mdeep", attrs: [] },
} as const;

/**
 * Rendered block for the Reader [PT-07]: the BODY html is cached by `semanticHash × lang × rendererVer ×
 * glossaryDigest(terms used in the block)` with claim placeholders; cite chips (label, href, `data-cite`)
 * and `data-verdict` are spliced from the CURRENT claims at serve time (≤ 0.05 ms per claim), so moved
 * cites and verdict changes are never served stale.
 */
export interface BlockView extends BlockMeta {
  /** Server-rendered HTML (see {@link HTML_CONTRACT}). */
  html: string;
  /** 1-based Markdown line of the block in its doc file (GitHub permalink, `data-ln`) [CR ux-R2]. */
  mdLine: number;
  /** Cached variants (`easy` = やさしく rewrite; stretch) [CR ux-R2]. */
  variants?: { easy?: { tokens: number; cached: boolean } };
  /** Language of `html` (may be a cached translation). */
  htmlLang: DocLang;
  /** Claims of the block (verdict badges, cite chips hover). */
  claimViews: Claim[];
  /** Thread counters for the block margin. */
  threads: {
    /** Open threads. */
    open: number;
    /** All non-draft threads. */
    total: number;
  };
  /** Pending doc proposals targeting this block. */
  proposals: ProposalId[];
}

/** Manifest summary for the outline header. */
export type DocManifestSummary = Pick<DocManifest, "docId" | "title" | "primaryLang" | "effort" | "coverage" | "usageTotals" | "generatedAt" | "models">;

/**
 * Compact per-block outline tuple (≈ 40 B instead of ≈ 0.5 KB BlockMeta) [PT-15]:
 * `[id, section, depth, kind, worstVerdict | null, ord, freshness]`. The client keeps full BlockMeta
 * incrementally from `doc.block.upsert`; `doc.outline` only invalidates the section tree.
 */
export type OutlineBlock = [BlockId, SectionId, Depth, BlockKind, Verdict | null, number, Freshness];

/** `GET /ws/:ws/doc` — outline only (no HTML). */
export interface DocOutline {
  /** Manifest (never null: the skeleton manifest exists from the first static apply) [CONS-11]. */
  manifest: DocManifestSummary;
  /** Flat section list (tree via `children`), roots first in TOC order. */
  sections: SectionNode[];
  /** Compact block tuples in reading order (minimap, counts, reader-level filtering) [PT-15]. */
  blocks: OutlineBlock[];
  /** Reading paths. */
  readingPaths: ReadingPath[];
  /** Glossary size. */
  glossaryCount: number;
  /** Counters. */
  counts: {
    /** Blocks. */
    blocks: number;
    /** Claims. */
    claims: number;
    /** Stale blocks. */
    stale: number;
    /** Verified claims. */
    verified: number;
    /** Open threads. */
    openThreads: number;
    /** Pending proposals. */
    proposals: number;
  };
  /** Outline revision (SSE `doc.outline` invalidates). */
  outlineRev: number;
}

/** `GET /ws/:ws/doc/sections/:section`. */
export interface SectionView {
  /** Section. */
  section: SectionNode;
  /** All blocks (reader level is applied client-side). */
  blocks: BlockView[];
  /** Breadcrumbs from root. */
  breadcrumbs: { id: SectionId; title: string }[];
  /** Previous section in reading order. */
  prev?: SectionId;
  /** Next section in reading order. */
  next?: SectionId;
  /** §3 flow overlay on the map: steps between map node ids (`MapView.diagram`) [CR ux-R4]. */
  mapFlow?: { from: string; to: string; step: number }[];
  /** Glossary entries of terms used in this section (term cards without another fetch) [CR ux-R16]. */
  terms?: GlossaryEntry[];
}

/** `GET /ws/:ws/doc/blocks/:block?md=marker|file` — the block's Markdown source for the doc_edit editor [CONS-17, CR ux-R2]. */
export interface BlockSourceView extends BlockView {
  /** Markdown source (id comment stripped). */
  md: string;
  /** `file` = cite links as in the doc file (editor default); `marker` = `[[n]]` + claims (LLM form). */
  mdForm: "file" | "marker";
}

/** Proposal + rendered preview. */
export interface DocProposalView extends DocProposal {
  /** Rendered HTML of the proposed text. */
  html: string;
  /** Word-level diff HTML against the base (suggestion-mode look). */
  diffHtml: string;
}

/** Doc-edit two-way choice (D-items: `doc_edit`). */
export interface DocEditReq {
  /** Block hash the edit started from (3-way base). */
  baseHash: string;
  /** New Markdown. */
  md: string;
  /**
   * Form of `md` (required) [CONS-17]: `file` = with cite links, parsed by gen §10.3 and re-stamped through the
   * ClaimStamper (CONS-06); claims whose links were removed are reported in `DocEditRes.dropped` BEFORE saving
   * when `confirmDrop` is not set (UXP-20).
   */
  mdForm: "file" | "marker";
  /** `doc` = the doc is wrong (lock as human-edited); `code` = make the code follow the doc (creates a doc_edit thread + job estimate). */
  apply: "doc" | "code";
  /** Save even though claims would be dropped (second step of the 「出典が外れます」 dialog) [UXP-20]. */
  confirmDrop?: boolean;
  /** Past block revision used as the old text (external-edit "make code follow"; P3) [CR ux-R20]. */
  fromRev?: number;
}

/** Result of a doc edit. */
export interface DocEditRes {
  /** Updated block (apply=doc). */
  block?: BlockView;
  /** Created thread (apply=code). */
  thread?: ThreadSummary;
  /** Estimate for the follow-up job (apply=code). */
  estimate?: JobEstimate;
  /** L0–L1 results of the re-stamped claims (apply=doc) [CONS-06]. */
  checks?: CheckError[];
  /** Claims that the edit would drop (nothing saved when non-empty and `confirmDrop` unset) [UXP-20]. */
  dropped?: { claim: ClaimId; label: string }[];
}

/** Result of on-demand block operations (simplify/translate). */
export interface BlockOpRes {
  /** Served from cache (no tokens). */
  cached: boolean;
  /** Proposal when ready immediately (cache) — otherwise arrives via SSE. */
  proposal?: DocProposalView;
  /** On-demand generation run started (cache miss); progress via `gen.task`. */
  run?: GenRunId;
  /** Estimate shown before the job (≈0.5k tokens for simplify). */
  estimate?: Estimate;
}

/* ============================================================================
 * 4. DTOs — search
 * ========================================================================== */

/** Searchable item kinds. */
export type SearchKind = "section" | "block" | "module" | "file" | "symbol" | "term" | "thread" | "fact";

/** Server-side full-text hit (`GET /ws/:ws/search`, FTS5 trigram; 1–2 chars ⇒ LIKE). */
export interface SearchHit {
  /** Kind. */
  kind: SearchKind;
  /** Id (block id, path, symbol key, …). */
  id: string;
  /** Label. */
  label: string;
  /** Secondary text (path, section title). */
  sub?: string;
  /** Snippet with `<mark>` around matches (escaped HTML). */
  snippet?: string;
  /** Score (higher = better). */
  score: number;
  /** In-app href (permalink). */
  href: string;
}

/** Compact palette item for the client-side ⌘K worker (short keys keep the payload small). */
export interface PaletteItem {
  /** Kind code: s=section b=block m=module f=file y=symbol t=term h=thread (group: {@link PALETTE_KIND_GROUP}). */
  k: "s" | "b" | "m" | "f" | "y" | "t" | "h";
  /** Id. */
  i: string;
  /** Label. */
  l: string;
  /** Sub label. */
  s?: string;
  /** Yomi (hiragana). */
  y?: string;
  /** Romaji. */
  r?: string;
  /** Href (built with core `HREFS`; never a hash route) [CONS-23]. */
  h: string;
  /** Aliases: romaji variants and English names (matched with the raw query form only) [CR ux-R1, UXP-12]. */
  al?: string[];
  /** Glossary id this item was matched through (「持ち越し」経由 label) [CR ux-R1]. */
  via?: string;
}

/** Palette kind code → UI group (`ui.ts PALETTE_GROUP_ORDER`); `b` and `f` fold into section / symbol groups [CONS-34]. */
export const PALETTE_KIND_GROUP = {
  s: "section",
  b: "section",
  m: "room",
  f: "symbol",
  y: "symbol",
  t: "term",
  h: "thread",
} as const satisfies Record<PaletteItem["k"], "term" | "section" | "room" | "symbol" | "thread">;

/**
 * `GET /ws/:ws/search/palette`. ≤ 50k items. ETag = digest of the palette's SOURCES (symbol/file part of the
 * index digest, section set, glossary rev, thread id set) — NOT the workspace rev, so generation writes do
 * not invalidate it; SSE `palette.changed` names the changed sources [PT-15].
 */
export interface PaletteIndex {
  /** Source digest (ETag). */
  digest: Xxh3;
  /** Revision. */
  rev: number;
  /** Items. */
  items: PaletteItem[];
}

/* ============================================================================
 * 5. DTOs — threads, review rounds
 * ========================================================================== */

/** Thread list item. */
export interface ThreadSummary extends Thread {
  /** First 120 chars of the latest message. */
  preview: string;
  /** Message count. */
  messages: number;
  /** State of the latest job. */
  jobState?: JobState;
}

/** A message with server-rendered body HTML (markdown-it `html:false`; the client never parses Markdown) [CR ux-R23]. */
export interface MessageView extends Message {
  /** Rendered body. */
  html: string;
}

/** Thread with messages and jobs. */
export interface ThreadDetail extends Thread {
  /** Messages, oldest first. */
  messages: MessageView[];
  /** Jobs, oldest first. */
  jobViews: JobSummary[];
}

/**
 * Anchor as sent by clients [CONS-16, CR ux-R10]: server-stamped fields (code `blob?`/`snippet`/`symbol`,
 * doc `blockHash`/`claim`) are omitted; the server always (re)computes them with
 * `AnchorEngine.codeAnchor/docAnchor` and returns the full {@link Anchor}.
 */
export interface AnchorInput {
  /** Which member the user selected. */
  primary: "doc" | "code" | "diagram";
  /** Doc member: block + selection offsets in the block's ANCHOR_TEXT_RULES text. */
  doc?: { block: BlockId; selStart: number; selEnd: number; quote?: TextQuote };
  /** Code member: range (+ blob the client saw, used to detect drift; optional char range). */
  code?: { path: RepoPath; start: LineNo; end: LineNo; blob?: GitOid; charRange?: { start: number; end: number } };
  /** Diagram member. */
  diagram?: { diagram: DiagramId; node?: string; edge?: string; pos?: { x: number; y: number } };
}

/**
 * Create a thread (optimistic UI sends `idempotency-key`). Drafts are created LAZILY by the client on the first
 * input or chip change; an empty Composer closed with default chips creates nothing [UXP-22].
 */
export interface CreateThreadReq {
  /** Anchor. */
  anchor: AnchorInput;
  /** Intent. */
  intent: ThreadIntent;
  /** First message body (verbatim). */
  body: string;
  /** Keep as draft (autosave) instead of submitting. */
  draft: boolean;
}

/** Patch a thread (drafts: body/anchor/intent; others: intent only). */
export interface PatchThreadReq {
  /** Expected version. */
  version: number;
  /** New intent. */
  intent?: ThreadIntent;
  /** New first-message body (draft only). */
  body?: string;
  /** New anchor (draft only; use `/reanchor` otherwise). */
  anchor?: AnchorInput;
  /** A human acknowledges a stale thread without re-anchoring [CR loop-5]. */
  dismissStale?: true;
  /** `note` threads: send to the AI on Finish (default false) [UXP-02]. */
  sendToAi?: boolean;
}

/** Fire a state transition (resolve, reopen, cancel, submit, …). */
export interface TransitionReq {
  /** Trigger. */
  on: ThreadTrigger;
  /** Expected version. */
  version: number;
  /** Resolution for `resolve`. */
  resolution?: Resolution;
  /** Optional message to append with the transition. */
  message?: string;
}

/**
 * Pull plane reply from the user's agent (`mitori reply`). Agents cannot resolve. `--body-file` is read by the
 * CLI only from a regular file under the repo or `<docDir>/tmp`, never matching DEFAULT_DENY_GLOBS, and the
 * body is secret-scanned server-side (hits ⇒ `E_SECRET_DETECTED`) [SEC-04].
 */
export interface AgentReplyReq {
  /** `answer` = answered question; `done` = code changed in the working tree; `question` = needs human input. */
  kind: "answer" | "done" | "question";
  /** Body (verbatim). */
  body: string;
  /** Files the agent changed (verified via fs/git; must be RepoPaths inside the workspace). */
  files?: RepoPath[];
  /** Proposed new Markdown for the thread's anchored doc block (becomes a DocProposal `agent_reply`) [CR loop-4]. */
  docUpdate?: string | null;
}

/** Agent proposes a resolution; a human confirms in the UI. */
export interface ProposeResolutionReq {
  /** Proposed resolution. */
  resolution: Resolution | "needs_human";
  /** Note. */
  note?: string;
}

/** `GET /ws/:ws/review` — current round. */
export interface ReviewStatus {
  /** Current/last round. */
  round: Round | null;
  /** Threads that would be dispatched by Finish (notes only when `sendToAi`; empty-body drafts never) [UXP-02, UXP-22]. */
  pending: ThreadId[];
  /** `note` threads NOT sent (Finish dialog group 「人向けのメモ{n}件（送らない）」) [UXP-02]. */
  heldNotes: ThreadId[];
  /** Blocking `mitori review` clients currently waiting (distinct `x-mitori-waiter`, 35 s grace) [UXP-01]. */
  waitingClients: number;
  /** Agent labels of the waiters (`claude-code`, `codex`, …) for the PullBar [UXP-01]. */
  waitingAgents: string[];
}

/** One partition of a batch review dispatch (loop `planBatch` output projected for the UI) [CONS-08]. */
export interface ReviewPartitionView {
  /** Threads in this job. */
  threads: ThreadId[];
  /** Job kind (from {@link INTENT_JOB_KIND}; mixed rounds produce several partitions). */
  kind: JobKind;
  /** Estimate for this partition. */
  estimate: JobEstimate;
}

/** `POST /ws/:ws/review/estimate` — batch estimate shown in the Finish dialog [CONS-08]. */
export interface ReviewEstimate {
  /** Estimate id to confirm in {@link FinishReq}. */
  estimateId: EstimateId;
  /** Partitions (one job each). */
  partitions: ReviewPartitionView[];
  /** Sum of partition input+output tokens. */
  batchTokens: number;
  /** Tokens if every thread were sent separately. */
  separateTokens: number;
  /** API-equivalent USD of the batch. */
  apiUsd: number;
  /** Confirmation required (sum > limits.confirmAboveTokens, or any partition requires it). */
  requiresConfirm: boolean;
}

/** Finish (Shift+F, named 「まとめて送る」 everywhere): dispatch pending threads. */
export interface FinishReq {
  /**
   * `push` = batch job(s) via the default engine; `pull` = release the waiting `mitori review` (if nobody waits
   * the round stays `dispatched` and the CLI picks it up later — never silently switched to push) [UXP-10].
   */
  mode: "push" | "pull";
  /** Subset; default all pending. */
  threads?: ThreadId[];
  /** Batch estimate being confirmed (push; required when the estimate requiresConfirm) [CONS-08]. */
  estimateId?: EstimateId;
  /** Explicit confirmation. */
  confirm?: boolean;
}

/** Finish result. */
export interface FinishRes {
  /** Round created. */
  round: Round;
  /** Jobs created (push; one per partition) [CONS-08]. */
  jobs: JobSummary[];
  /** Batch savings vs individual jobs ("まとめると ≈23k tok 節約"). */
  savedTokens?: number;
}

/** Long-poll result for `mitori review` (`GET /ws/:ws/review/wait`). */
export interface ReviewWaitRes {
  /** `ready` = Finish pressed; `timeout` = re-poll; `shutdown` = daemon stopping (approved=false). */
  status: "ready" | "timeout" | "shutdown";
  /** Round released. */
  round?: Round;
  /** `mitori.review/1` stdout text (≤ 50 tokens overhead per thread + verbatim bodies). */
  stdout?: string;
  /** stderr line value: approved when the round has zero open threads. */
  approved: boolean;
  /** Command the agent runs next (`mitori review --round <n+1>`). */
  next: string;
}

/* ============================================================================
 * 6. DTOs — jobs, checkpoints
 * ========================================================================== */

/** Job list item / detail head. */
export type JobSummary = Job;

/** `GET /ws/:ws/jobs/:job`. */
export interface JobDetail extends Job {
  /** Code diff (when ready/accepted). */
  diff: FileDiff[];
  /** Doc proposals produced. */
  proposalViews: DocProposalView[];
  /** Last ≤ 200 normalized events. */
  events: JobEvent[];
  /** Bundle size actually sent. */
  bundleTokens: number;
}

/** Context adjustment from Composer chips. */
export interface ContextAdjust {
  /** Estimate item keys to drop (non-removable keys are rejected). */
  remove?: string[];
  /** Extra code ranges (`@` mention). */
  add?: { path: RepoPath; start: LineNo; end: LineNo }[];
}

/** Request to estimate/create a job. */
export interface JobReq {
  /** Kind; MUST equal `INTENT_JOB_KIND[intent]` of every thread (mixed intents ⇒ use `POST /review/estimate`) [CONS-34]. */
  kind: JobKind;
  /** Threads served. */
  threads: ThreadId[];
  /** Engine override (default from settings). */
  engine?: EngineId;
  /** Model override (full id). */
  model?: ModelId;
  /** Mode override (router still validates). */
  mode?: ExecMode;
  /** Context chips adjustment. */
  context?: ContextAdjust;
  /** Bundle budget override (≤ `limits.bundleMaxTokens`). */
  budgetTokens?: number;
}

/** Estimate response (bundle is built ≤ 100 ms p95). */
export interface JobEstimate {
  /** Router decision. */
  route: RouteDecision;
  /** Estimate (items double as context chips). */
  estimate: Estimate;
  /** Bundle info. */
  bundle: {
    /** Tokens. */
    tokens: number;
    /** Sections dropped to fit the budget (`OMITTED:` line). */
    omitted: string[];
  };
  /** Suggested (candidate) context chips not yet included [CR ux-R9]. */
  candidates?: EstimateItem[];
  /** Seconds band of past jobs with the same intent × mode [CR ux-R9]. */
  history?: { p25: number; p75: number; n: number };
}

/** Create job = estimate id + confirmation when required. */
export interface CreateJobReq extends JobReq {
  /** Estimate being confirmed (must match the current index digest). */
  estimateId: EstimateId;
  /** Required when `estimate.requiresConfirm`. */
  confirm?: boolean;
}

/**
 * Accept selection [CONS-18]. Hunks in neither list stay `pending` (job `partially_accepted`; acceptable
 * later). Rejected hunks can never be applied later for this job. Sensitive jobs (`Job.sensitive`) reject
 * `accept: "all"` with `E_PRECONDITION` — every file needs an explicit decision [SEC-12].
 */
export interface AcceptReq {
  /** Hunks to accept now, or `all` remaining pending hunks. */
  accept: HunkId[] | "all";
  /** Hunks to reject explicitly. */
  reject?: HunkId[];
  /** Doc proposals to accept. */
  proposals?: ProposalId[];
  /** The user saw a failed/unverified gate verdict for this exact tree and still accepts [UXP-05]. */
  acceptUnverified?: boolean;
}

/** Accept result: working-tree accept (checkpoint) or remote-readonly accept (`.patch`) [CONS-18]. */
export type AcceptRes =
  | {
      /** Discriminator. */
      kind: "applied";
      /** Updated job. */
      job: JobSummary;
      /** Undo point. */
      checkpoint: Checkpoint;
      /** Files written to the working tree. */
      files: RepoPath[];
      /** Threads marked stale because their anchors overlapped. */
      staleThreads: ThreadId[];
      /** Commit when `review.autoCommit` (code + same-action doc files when docCommitted) [CONS-36]. */
      commit?: GitOid;
    }
  | {
      /** Discriminator. */
      kind: "patch";
      /** Updated job. */
      job: JobSummary;
      /** Absolute path of the exported `.patch` (`~/.mitori/repos/<ws>/patches/<job>.patch`). */
      patchFile: string;
      /** Files the patch touches. */
      files: RepoPath[];
    };

/** Undo result. */
export interface UndoRes {
  /** Checkpoint undone. */
  checkpoint: Checkpoint;
  /** Files restored. */
  restored: RepoPath[];
  /** Files that diverged since accept and were left untouched (use `force`). */
  diverged: RepoPath[];
}

/** Copy-as-prompt (works with no engine at all). */
export interface CopyPromptReq {
  /** Anchor. */
  anchor: Anchor;
  /** User's ask (verbatim). */
  ask: string;
  /** Intent. */
  intent: ThreadIntent;
  /** Target agent formatting. */
  target: "claude-code" | "codex" | "generic";
}

/** Copy-as-prompt result. */
export interface CopyPromptRes {
  /** Prompt text. */
  text: string;
  /** Estimated tokens. */
  tokens: number;
}

/** MCP `submit_patch` / external patch (applied in a worktree, never the user's tree). */
export interface ExternalPatchReq {
  /** Thread. */
  thread: ThreadId;
  /** Line-range edits. */
  edits: PatchEdit[];
  /** Doc update for the anchored block (the MCP shim sends `null` when the tool argument is omitted) [CONS-34]. */
  docUpdate: string | null;
}

/** External patch result (≤ 20 lines when rendered as text for MCP). */
export interface ExternalPatchRes {
  /** Job created (kind `external_patch`). */
  job: JobSummary;
  /** Edits applied cleanly. */
  applied: boolean;
  /** Structured problems (range mismatch, scope, gates). */
  problems: CheckError[];
}

/* ============================================================================
 * 7. DTOs — generation, session engine
 * ========================================================================== */

/** Generation estimate request. */
export interface GenEstimateReq {
  /** Effort. */
  effort: Effort;
  /** Engine (default from settings). */
  engine?: EngineId;
  /** Scope (sections/modules); empty = effort default. */
  scope?: SectionId[];
  /** Concurrency override (≤ maxConcurrency). */
  concurrency?: number;
}

/**
 * Start a generation run (always an explicit human click, D3). From the CLI, `mitori gen` shows the estimate
 * and requires an interactive TTY confirmation; it refuses (`E_TTY_REQUIRED`, exit 2, prints the web URL) when
 * stdin/stdout is not a TTY or CLAUDECODE / CODEX_* is set [CONS-21, SEC-04].
 */
export interface GenRunReq {
  /** Estimate id confirmed. */
  estimateId: EstimateId;
  /** Explicit confirmation. */
  confirm: true;
  /** Do not dispatch before this time (start after the 5h window resets) [CR gen-C10]. */
  notBefore?: Iso8601;
}

/** Generation task summary for the progress UI (includes `error`, e.g. the refusal category) [CR gen-C9]. */
export type GenTaskView = Pick<GenTask, "id" | "stage" | "target" | "state" | "priority" | "attempt" | "usage" | "blocks" | "error">;

/** A regeneration / doc-sync suggestion (S9, post-accept `doc.sync`); never runs automatically (D12) [CONS-09]. */
export interface SuggestionView {
  /** Id. */
  id: SuggestionId;
  /** Section. */
  section: SectionId;
  /** Why. */
  reason: "iface_changed" | "stale_ratio" | "facts_changed" | "new_symbols" | "job_accepted" | "round_completed";
  /** Regenerate the section or patch stale blocks (`sync` = gen `syncBlocks`). */
  kind: "regen" | "sync";
  /** Blocks targeted (sync). */
  blocks: BlockId[];
  /** Files that caused it. */
  files: RepoPath[];
  /** Estimate of running it. */
  estimate: GenEstimate;
  /** Created at. */
  createdAt: Iso8601;
}

/** `GET /ws/:ws/gen/runs/:run`. */
export interface GenRunDetail {
  /** Run. */
  run: GenRun;
  /** Tasks. */
  tasks: GenTaskView[];
}

/** Run control. */
export interface GenControlReq {
  /** Action. */
  action: "pause" | "resume" | "cancel";
}

/** `POST /ws/:ws/gen/prep` body: estimate request + continuation of a multi-phase packet [CONS-19]. */
export type PrepReq = GenEstimateReq & {
  /** Previous packet whose phase is complete (`mitori gen --prep --continue <pr_id>`). */
  continueFrom?: PrepId;
  /** Tasks per subagent batch (default 6, ≤ 100k input tokens per batch) [PT-10]. */
  batchSize?: number;
};

/** `mitori gen --prep` result. */
export interface PrepInfo {
  /** Packet id. */
  id: PrepId;
  /** Phase number of this packet (1-based; later phases need earlier outputs) [CR gen-C7]. */
  phase: number;
  /**
   * Absolute directory `<docDir>/tmp/prep/<id>/` (docDir self-ignores `tmp/`; the doc watcher ignores
   * `cache/` and `tmp/`; for shadow workspaces docDir is under `~/.mitori/repos/<ws>/doc/`) [CONS-19, CONS-20].
   */
  dir: string;
  /** Server-issued fingerprint; ingest without it (or with a stale one) is rejected. */
  fingerprint: Sha256;
  /** Task count. */
  tasks: number;
  /** Path of README.md (instructions by reference). */
  readme: string;
  /**
   * Expiry: 24 h after prep. A task whose inputs changed since prep is refused at ingest (drift) and prepared again
   * by `prep --continue` (gen spec §8.4.3-3, AC-23); an unrelated index change does not expire the packet [CR m1-16].
   */
  expiresAt: Iso8601;
  /** Estimate (C=1). */
  estimate: GenEstimate;
}

/** Ingest request (the server reads `<dir>/out/*.ndjson` from disk; the body is small) [CONS-19]. */
export interface IngestReq {
  /** Packet. */
  prep: PrepId;
  /** Fingerprint from {@link PrepInfo}. */
  fingerprint: Sha256;
  /** Accept partial output (remaining tasks stay pending). */
  partial: boolean;
  /** Model the session agent ran (`--model`, full id; default: `models.genModule`) — stamped into BlockGenInfo [CR gen-C7]. */
  model?: ModelId;
}

/** Structured validation error (≤ 20 per response; m3e's boolean-validation lesson). */
export interface CheckError {
  /** Location: `<file>:<line>` or JSON pointer. */
  at: string;
  /** What was expected. */
  expected: string;
  /** What was found (truncated). */
  actual: string;
  /** Error code. */
  code: ErrorCode;
}

/** Ingest report (also printed by the CLI). */
export interface IngestReport {
  /** True when every task's output validated. */
  ok: boolean;
  /** Packet. */
  prep: PrepId;
  /** Accepted counts. */
  accepted: {
    /** Tasks. */
    tasks: number;
    /** Blocks. */
    blocks: number;
    /** Claims. */
    claims: number;
  };
  /** Rejected lines (agent fixes and re-ingests). */
  errors: CheckError[];
  /** Tasks with no output yet. */
  missing: string[];
  /** Coverage after ingest. */
  coveragePct: number;
  /** Next phase to prepare (`NEXT: mitori gen --prep --continue <prep>`), null when the run is complete [CR gen-C7]. */
  next?: { prep: PrepId; phase: number } | null;
}

/** `POST /ws/:ws/check`. */
export interface CheckReq {
  /** What to validate. */
  kind: "gen-output" | "repo-config" | "doc";
  /** File to validate (repo-relative or absolute inside `.mitori/tmp`). */
  path?: string;
  /** Inline content instead of a file. */
  content?: string;
}

/** Check result. */
export interface CheckReport {
  /** Valid. */
  ok: boolean;
  /** Errors (≤ 20). */
  errors: CheckError[];
}

/* ============================================================================
 * 8. DTOs — inbox, trust, settings, usage, export
 * ========================================================================== */

/**
 * Inbox filters — ONE vocabulary for API and UI (`ui.ts InboxView` is a subset) [CONS-34, CR ux-R5].
 * `uncommitted` = applied but not yet committed [UXP-19].
 */
export type InboxFilter = "all" | "mine" | "working" | "review" | "failed" | "outdated" | "draft" | "resolved" | "proposals" | "trust" | "suggestions" | "uncommitted";

/** Inbox row (renders from one fetch; aggregation rules in server spec §7) [CR ux-R5]. */
export interface InboxItem {
  /** Item kind. */
  kind: "thread" | "job" | "proposal" | "trust" | "gen_run" | "suggestion";
  /** Id. */
  id: string;
  /** Title. */
  title: string;
  /** State label (thread/job/proposal state). */
  state: string;
  /** Display state (`outdated` derived from anchor health). */
  displayState?: ThreadState | JobState | "outdated";
  /** Filters this item matches. */
  tags: InboxFilter[];
  /** Thread intent. */
  intent?: ThreadIntent;
  /** Where it is anchored. */
  anchor?: { section?: SectionId; path?: RepoPath; line?: LineNo };
  /** Cost (actual, or estimated when `estimated`). */
  cost?: { usd: number; tokens: number; estimated: boolean };
  /** Related thread. */
  thread?: ThreadId;
  /** Related job. */
  job?: JobId;
  /** Updated at. */
  updatedAt: Iso8601;
  /** Href (core `HREFS`). */
  href: string;
}

/** Trust prompt (gates, repo prompts, rules). */
export interface TrustRequest {
  /** Id. */
  id: TrustItemId;
  /** Item kind. */
  item: TrustRecord["item"];
  /** Content hash. */
  hash: Sha256;
  /** Human-readable preview of what will execute / be injected. */
  preview: string;
  /** Status. */
  status: "pending" | "trusted" | "denied";
}

/** Global settings view. */
export interface SettingsView {
  /** Settings. */
  settings: GlobalSettings;
  /** Absolute path of the config file. */
  path: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
  /**
   * Why the last human edit of `config.json` was not applied (`E_CFG_INVALID` …); the last good settings stay in
   * effect. Absent when the file is valid [CR m1-121].
   */
  lastError?: MitoriErrorData;
}

/** Deep partial helper for settings patches. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Patch global settings (web only). Any path in core `EXEC_SETTING_KEYS` ⇒ `E_FORBIDDEN_KEY` [SEC-06]. */
export interface PatchSettingsReq {
  /** Expected version. */
  version: number;
  /** Partial settings (validated; unknown keys rejected). */
  patch: DeepPartial<GlobalSettings>;
}

/** `PATCH /settings/exec` (cli only; `mitori config set` after an interactive TTY confirmation) [SEC-06]. */
export interface PatchExecSettingReq {
  /** Dotted path under an EXEC_SETTING_KEYS entry (e.g. `engines.claude-cli.binary`). */
  path: string;
  /** New JSON value. */
  value: unknown;
  /** Always true (the CLI asked a human on a TTY). */
  confirm: true;
}

/** Workspace settings view. */
export type WorkspaceSettingsView = EffectiveSettings;

/** Patch workspace overrides (stored in the global file). */
export interface PatchWorkspaceSettingsReq {
  /** Overrides. */
  overrides: WorkspaceOverrides;
}

/**
 * Usage aggregation range. `month` = the calendar month to date in the daemon's time zone (anthropic-api
 * `monthlyCapUsd`, gen spec §8.3) [CR m1-22].
 */
export type UsageRange = "today" | "7d" | "30d" | "month" | "all";

/** `GET /usage/summary`. */
export interface UsageSummary {
  /** Range. */
  range: UsageRange;
  /** Totals. */
  totals: UsageTotals;
  /** Per day (local time zone of the daemon). */
  byDay: { day: string; totals: UsageTotals }[];
  /** Per engine. */
  byEngine: Partial<Record<EngineId, UsageTotals>>;
  /** Per model. */
  byModel: Record<string, UsageTotals>;
  /** Latest subscription window observation. */
  window?: SubscriptionWindow;
  /** Estimator accuracy (± percent) after calibration. */
  estimateAccuracyPct: number;
}

/**
 * Export request (P3 self-contained HTML). The daemon never writes the export: it returns the HTML and the
 * CLI writes `--out` itself (the daemon never writes outside its SafeWriter roots) [CONS-07, SEC-01].
 */
export interface ExportReq {
  /** Format. */
  format: "html";
  /** Reader level baked as default (the export still contains all depths). */
  level: ReaderLevel;
  /** Language. */
  lang: DocLang;
  /** Include resolved decisions. */
  includeDecisions: boolean;
  /** Include ±3-line code excerpts for cite peeks (false ⇒ cites show path:line only) [UXP-18]. */
  excerpts: boolean;
}

/** Export result. */
export interface ExportRes {
  /** The HTML document (escaped JSON payload + meta CSP; see gen spec §10.10 R1) [SEC-11]. */
  html: string;
  /** Size in bytes. */
  bytes: number;
  /** Integrity hash. */
  sha256: Sha256;
  /** Secret-like strings redacted. */
  redactions: number;
  /** Code excerpts embedded (`excerpts: true`): count and distinct files (shown in the export dialog) [UXP-18]. */
  codeExcerpts: { count: number; files: number };
}

/**
 * Workspace open request (`mitori <path|url>`). Paths that are `$HOME`, `/`, `/Users`, Desktop/Documents/Downloads,
 * under `~/Library`, or contain no project marker at depth 1 ⇒ `E_WS_NOT_PROJECT` unless `force` [UXP-23].
 * GitHub targets: owner `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`, repo `^[A-Za-z0-9._-]{1,100}$` (not `.`/`..`) [SEC-14].
 */
export interface OpenWorkspaceReq {
  /** Absolute path or `https://github.com/<owner>/<repo>`. */
  target: string;
  /** Override the not-a-project guard. */
  force?: boolean;
}

/**
 * `mitori init`: mints `docId` + skeleton manifest; initializes only an empty or mitori-owned docDir (never
 * the repo root); `commit: true` from the CLI requires a TTY confirmation [SEC-02, SEC-04, CONS-11].
 */
export interface InitReq {
  /** Doc directory (default `.mitori`). */
  docDir?: string;
  /** Primary language. */
  lang: DocLang;
  /** Opt in to committing the doc (writes `.gitattributes` `linguist-generated` + `.mitori/.gitignore`). */
  commit: boolean;
  /** Write the AGENTS.md managed block (≤ 80 tokens). */
  agentsBlock: boolean;
}

/** Browser login nonce (CLI only). */
export interface NonceRes {
  /** URL to open: `http://127.0.0.1:<port>/auth#n=<nonce>&to=<path>` (fragment, never sent to the server) [SEC-06]. */
  url: string;
  /** Expiry (60 s, single use). */
  expiresAt: Iso8601;
}

/** `POST /auth/exchange` (unauthenticated; the nonce is the credential) [SEC-06]. */
export interface AuthExchangeReq {
  /** Nonce from the URL fragment. */
  nonce: string;
}

/** Session issued to the browser (stored in `localStorage[LOCAL_KEYS.session]`). */
export interface AuthExchangeRes {
  /** 256-bit session token (base64url); sent as `authorization: Mitori-Session <token>`. */
  token: string;
  /** Session id (revocation, logs). */
  session: SessionId;
  /** Idle expiry (30 days, sliding). */
  expiresAt: Iso8601;
}

/** One integration's install state (`GET /integrations`) [CONS-22, CR ux-R17]. */
export interface IntegrationStatusView {
  /** Target. */
  target: "claude-code" | "codex" | "agents-md";
  /** Scope. */
  scope: "project" | "user";
  /** Files and their freshness (sha256 vs template). */
  files: { path: string; state: "current" | "outdated" | "modified" | "missing" }[];
  /** MCP registered. */
  mcp: boolean;
}

/** `POST /integrations/:target/install` body (from the CLI `mitori install`, TTY-confirmed when `force`) [CONS-22]. */
export interface InstallReq {
  /** Scope. */
  scope: "project" | "user";
  /** Workspace for project scope. */
  ws?: WorkspaceKey;
  /** Register the MCP server too (opt-in). */
  mcp: boolean;
  /** Overwrite modified files. */
  force: boolean;
}

/**
 * Hook `touch` (PostToolUse): files an agent edited. Zero output to the agent. The daemon answers immediately
 * (`registered: false`, no scan, never opens a workspace) for repos that are not registered [SEC-21, UXP-32].
 */
export interface TouchReq {
  /** Paths (absolute or repo-relative). */
  paths: string[];
  /** Origin. */
  source: "claude-hook" | "codex-hook" | "cli";
}

/** Cursor + limit query. */
export interface PageQuery {
  /** Cursor. */
  cursor?: Cursor;
  /** Page size (default 50, max 200). */
  limit?: number;
}

/* ============================================================================
 * 9. Route table
 * ========================================================================== */

/** All daemon routes. Keys are relative to {@link API_PREFIX}. Handler ownership: server spec §8. */
export interface ApiRoutes {
  // --- daemon / global -------------------------------------------------------
  "GET /health": Route<Empty, { challenge?: string }, undefined, HealthRes>;
  "GET /daemon": Route<Empty, Empty, undefined, DaemonStatus>;
  "POST /daemon/shutdown": Route<Empty, Empty, { reason?: string; force?: boolean }, Ok>;
  "POST /auth/nonce": Route<Empty, Empty, { to?: string }, NonceRes>;
  "POST /auth/exchange": Route<Empty, Empty, AuthExchangeReq, AuthExchangeRes>;
  "POST /auth/logout": Route<Empty, Empty, undefined, Ok>;
  "GET /events": Route<Empty, { ws?: WorkspaceKey; last?: number }, undefined, SseEvent>;
  "GET /engines": Route<Empty, Empty, undefined, EngineStatus[]>;
  "POST /engines/:engine/probe": Route<{ engine: EngineId }, Empty, undefined, EngineStatus>;
  "POST /engines/:engine/repin": Route<{ engine: EngineId }, Empty, { sha256: Sha256 }, EngineStatus>;
  "GET /settings": Route<Empty, Empty, undefined, SettingsView>;
  "PATCH /settings": Route<Empty, Empty, PatchSettingsReq, SettingsView>;
  "PATCH /settings/exec": Route<Empty, Empty, PatchExecSettingReq, SettingsView>;
  "GET /usage/summary": Route<Empty, { range: UsageRange; ws?: WorkspaceKey }, undefined, UsageSummary>;
  "GET /usage/records": Route<Empty, PageQuery & { ws?: WorkspaceKey }, undefined, Page<UsageRecord>>;
  "GET /workspaces": Route<Empty, Empty, undefined, WorkspaceSummary[]>;
  "POST /workspaces": Route<Empty, Empty, OpenWorkspaceReq, WorkspaceSummary>;
  "DELETE /workspaces/:ws": Route<WsParam, { forget?: "1" }, undefined, Ok>;
  "GET /integrations": Route<Empty, { ws?: WorkspaceKey }, undefined, IntegrationStatusView[]>;
  "POST /integrations/:target/install": Route<{ target: IntegrationStatusView["target"] }, Empty, InstallReq, IntegrationStatusView>;

  // --- workspace status, scan, settings, trust, git --------------------------
  "GET /ws/:ws": Route<WsParam, Empty, undefined, WorkspaceStatus>;
  "POST /ws/:ws/init": Route<WsParam, Empty, InitReq, WorkspaceStatus>;
  "GET /ws/:ws/scan": Route<WsParam, Empty, undefined, ScanStatus>;
  "POST /ws/:ws/scan": Route<WsParam, Empty, { force?: boolean }, ScanStatus>;
  "GET /ws/:ws/settings": Route<WsParam, Empty, undefined, WorkspaceSettingsView>;
  "PATCH /ws/:ws/settings": Route<WsParam, Empty, PatchWorkspaceSettingsReq, WorkspaceSettingsView>;
  "GET /ws/:ws/trust": Route<WsParam, Empty, undefined, TrustRequest[]>;
  "POST /ws/:ws/trust/:tr": Route<WsParam & { tr: TrustItemId }, Empty, { decision: "trusted" | "denied" }, TrustRecord>;
  "GET /ws/:ws/git": Route<WsParam, Empty, undefined, GitStatusView>;

  // --- map, graph, code, facts ------------------------------------------------
  "GET /ws/:ws/map": Route<WsParam, Empty, undefined, MapView>;
  "GET /ws/:ws/graph": Route<WsParam, { level: "module" | "file"; focus?: string }, undefined, GraphView>;
  "GET /ws/:ws/modules": Route<WsParam, Empty, undefined, ModuleInfo[]>;
  "GET /ws/:ws/facts": Route<WsParam, { kind?: FactKind }, undefined, Fact[]>;
  "GET /ws/:ws/symbols": Route<WsParam, { q?: string; path?: RepoPath; limit?: number }, undefined, SymbolEntry[]>;
  "GET /ws/:ws/files/tree": Route<WsParam, Empty, undefined, FileTreeNode>;
  "GET /ws/:ws/files/content": Route<WsParam, { path: RepoPath; start?: number; end?: number; html?: "1" }, undefined, FileContent>;
  "GET /ws/:ws/cite": Route<WsParam, { path: RepoPath; start: number; end: number; blob: GitOid; ctx?: number }, undefined, CitePeek>;
  "GET /ws/:ws/diagrams/:dg": Route<WsParam & { dg: DiagramId }, Empty, undefined, DiagramView>;

  // --- doc ---------------------------------------------------------------------
  "GET /ws/:ws/doc": Route<WsParam, Empty, undefined, DocOutline>;
  "GET /ws/:ws/doc/sections/:section": Route<WsParam & { section: SectionId }, { lang?: DocLang }, undefined, SectionView>;
  "POST /ws/:ws/doc/sections/:section/translate": Route<WsParam & { section: SectionId }, Empty, { lang: DocLang; confirm?: boolean }, BlockOpRes>;
  "GET /ws/:ws/doc/text": Route<WsParam, { ref: string; depth?: number }, undefined, string>;
  "GET /ws/:ws/doc/blocks/:block": Route<WsParam & { block: BlockId }, { lang?: DocLang; md?: "marker" | "file" }, undefined, BlockView | BlockSourceView>;
  "POST /ws/:ws/doc/blocks/:block/edit": Route<WsParam & { block: BlockId }, Empty, DocEditReq, DocEditRes>;
  "POST /ws/:ws/doc/blocks/:block/revert": Route<WsParam & { block: BlockId }, Empty, { rev: number; baseHash: Xxh3 }, BlockView>;
  "POST /ws/:ws/doc/blocks/:block/verify": Route<WsParam & { block: BlockId }, Empty, { verified: boolean; claims?: ClaimId[] }, BlockView>;
  "GET /ws/:ws/doc/blocks/:block/history": Route<WsParam & { block: BlockId }, Empty, undefined, BlockHistoryEntry[]>;
  "POST /ws/:ws/doc/blocks/:block/expand": Route<WsParam & { block: BlockId }, Empty, { confirm: boolean }, BlockOpRes>;
  "POST /ws/:ws/doc/blocks/:block/simplify": Route<WsParam & { block: BlockId }, Empty, { confirm?: boolean }, BlockOpRes>;
  "POST /ws/:ws/doc/blocks/:block/translate": Route<WsParam & { block: BlockId }, Empty, { lang: DocLang; confirm?: boolean }, BlockOpRes>;
  "GET /ws/:ws/doc/proposals": Route<WsParam, { state?: DocProposal["state"]; block?: BlockId }, undefined, DocProposalView[]>;
  "POST /ws/:ws/doc/proposals/:pp/accept": Route<WsParam & { pp: ProposalId }, Empty, { md?: string }, BlockView>;
  "POST /ws/:ws/doc/proposals/:pp/reject": Route<WsParam & { pp: ProposalId }, Empty, undefined, Ok>;
  "GET /ws/:ws/decisions": Route<WsParam, Empty, undefined, Decision[]>;

  // --- search --------------------------------------------------------------------
  "GET /ws/:ws/search": Route<WsParam, { q: string; kinds?: string; limit?: number }, undefined, SearchHit[]>;
  "GET /ws/:ws/search/palette": Route<WsParam, Empty, undefined, PaletteIndex>;

  // --- threads -------------------------------------------------------------------
  "GET /ws/:ws/threads": Route<WsParam, PageQuery & { state?: string; intent?: ThreadIntent; block?: BlockId; path?: RepoPath }, undefined, Page<ThreadSummary>>;
  "POST /ws/:ws/threads": Route<WsParam, Empty, CreateThreadReq, ThreadDetail>;
  "GET /ws/:ws/threads/:th": Route<WsParam & { th: ThreadId }, Empty, undefined, ThreadDetail>;
  "PATCH /ws/:ws/threads/:th": Route<WsParam & { th: ThreadId }, Empty, PatchThreadReq, ThreadDetail>;
  "DELETE /ws/:ws/threads/:th": Route<WsParam & { th: ThreadId }, Empty, undefined, Ok>;
  "POST /ws/:ws/threads/:th/messages": Route<WsParam & { th: ThreadId }, Empty, { body: string; version: number }, ThreadDetail>;
  "POST /ws/:ws/threads/:th/transition": Route<WsParam & { th: ThreadId }, Empty, TransitionReq, ThreadDetail>;
  "POST /ws/:ws/threads/:th/reanchor": Route<WsParam & { th: ThreadId }, Empty, { anchor: AnchorInput; version: number }, ThreadDetail>;
  "POST /ws/:ws/threads/:th/promote": Route<WsParam & { th: ThreadId }, Empty, { to: "decision" | "doc"; title?: string }, { decision?: Decision; proposal?: DocProposalView }>;
  "GET /ws/:ws/threads/:th/bundle": Route<WsParam & { th: ThreadId }, { budget?: number; lines?: "1"; mode?: "pull" | "copy" }, undefined, string>;
  "POST /ws/:ws/threads/:th/reply": Route<WsParam & { th: ThreadId }, Empty, AgentReplyReq, ThreadSummary>;
  "POST /ws/:ws/threads/:th/propose-resolution": Route<WsParam & { th: ThreadId }, Empty, ProposeResolutionReq, Ok>;

  // --- review rounds (batch / Pull) ----------------------------------------------
  "GET /ws/:ws/review": Route<WsParam, Empty, undefined, ReviewStatus>;
  "POST /ws/:ws/review/estimate": Route<WsParam, Empty, { threads?: ThreadId[] }, ReviewEstimate>;
  "POST /ws/:ws/review/finish": Route<WsParam, Empty, FinishReq, FinishRes>;
  "GET /ws/:ws/review/wait": Route<WsParam, { round?: number; timeoutMs?: number }, undefined, ReviewWaitRes>;
  "POST /ws/:ws/review/rounds/:n/complete": Route<WsParam & { n: string }, Empty, undefined, Round>;
  "POST /ws/:ws/review/rounds/:n/withdraw": Route<WsParam & { n: string }, Empty, undefined, Round>;

  // --- jobs ----------------------------------------------------------------------
  "POST /ws/:ws/jobs/estimate": Route<WsParam, Empty, JobReq, JobEstimate>;
  "POST /ws/:ws/jobs": Route<WsParam, Empty, CreateJobReq, JobSummary>;
  "GET /ws/:ws/jobs": Route<WsParam, PageQuery & { state?: JobState; thread?: ThreadId }, undefined, Page<JobSummary>>;
  "GET /ws/:ws/jobs/:job": Route<WsParam & { job: JobId }, Empty, undefined, JobDetail>;
  "GET /ws/:ws/jobs/:job/events": Route<WsParam & { job: JobId }, { after?: number }, undefined, JobEvent[]>;
  "GET /ws/:ws/jobs/:job/diff": Route<WsParam & { job: JobId }, { html?: "1" }, undefined, FileDiff[]>;
  "GET /ws/:ws/jobs/:job/prompt": Route<WsParam & { job: JobId }, { target: CopyPromptReq["target"] }, undefined, string>;
  "POST /ws/:ws/jobs/:job/cancel": Route<WsParam & { job: JobId }, Empty, undefined, JobSummary>;
  "POST /ws/:ws/jobs/:job/gates/run": Route<WsParam & { job: JobId }, Empty, { gates?: GateId[] }, JobSummary>;
  "POST /ws/:ws/jobs/:job/accept": Route<WsParam & { job: JobId }, Empty, AcceptReq, AcceptRes>;
  "POST /ws/:ws/jobs/:job/reject": Route<WsParam & { job: JobId }, Empty, { reason?: string }, JobSummary>;
  "POST /ws/:ws/jobs/:job/revise": Route<WsParam & { job: JobId }, Empty, { message: string }, JobSummary>;
  "POST /ws/:ws/jobs/:job/retry": Route<WsParam & { job: JobId }, Empty, { engine?: EngineId }, JobSummary>;
  "POST /ws/:ws/jobs/:job/commit": Route<WsParam & { job: JobId }, Empty, { message?: string }, { commit: GitOid }>;
  "POST /ws/:ws/jobs/:job/pr": Route<WsParam & { job: JobId }, Empty, { title: string; body: string; draft: boolean }, { url: string }>;
  "POST /ws/:ws/prompt": Route<WsParam, Empty, CopyPromptReq, CopyPromptRes>;
  "POST /ws/:ws/patches": Route<WsParam, Empty, ExternalPatchReq, ExternalPatchRes>;
  "GET /ws/:ws/checkpoints": Route<WsParam, Empty, undefined, Checkpoint[]>;
  "POST /ws/:ws/checkpoints/:ck/undo": Route<WsParam & { ck: CheckpointId }, Empty, { force?: boolean }, UndoRes>;

  // --- generation ----------------------------------------------------------------
  "POST /ws/:ws/gen/estimate": Route<WsParam, Empty, GenEstimateReq, GenEstimate>;
  "POST /ws/:ws/gen/runs": Route<WsParam, Empty, GenRunReq, GenRun>;
  "GET /ws/:ws/gen/runs": Route<WsParam, PageQuery, undefined, Page<GenRun>>;
  "GET /ws/:ws/gen/runs/:run": Route<WsParam & { run: GenRunId }, Empty, undefined, GenRunDetail>;
  "POST /ws/:ws/gen/runs/:run/control": Route<WsParam & { run: GenRunId }, Empty, GenControlReq, GenRun>;
  "POST /ws/:ws/gen/prioritize": Route<WsParam, Empty, { section: SectionId }, Ok>;
  "GET /ws/:ws/gen/suggestions": Route<WsParam, Empty, undefined, SuggestionView[]>;
  "POST /ws/:ws/gen/suggestions/:sg/run": Route<WsParam & { sg: SuggestionId }, Empty, { confirm?: boolean }, GenRun>;
  "POST /ws/:ws/gen/prep": Route<WsParam, Empty, PrepReq, PrepInfo>;
  "POST /ws/:ws/gen/ingest": Route<WsParam, Empty, IngestReq, IngestReport>;

  // --- inbox, hooks, checks, export ------------------------------------------------
  "GET /ws/:ws/inbox": Route<WsParam, PageQuery & { filter?: InboxFilter }, undefined, Page<InboxItem>>;
  "POST /ws/:ws/touch": Route<WsParam, Empty, TouchReq, { staleBlocks: number; registered: boolean }>;
  "GET /ws/:ws/digest": Route<WsParam, { maxTokens?: number }, undefined, string>;
  "POST /ws/:ws/check": Route<WsParam, Empty, CheckReq, CheckReport>;
  "POST /ws/:ws/export": Route<WsParam, Empty, ExportReq, ExportRes>;
  "GET /ws/:ws/export/html": Route<WsParam, { level?: ReaderLevel; lang?: DocLang; excerpts?: "0" | "1" }, undefined, string>;
}

/** Route key union. */
export type RouteKey = keyof ApiRoutes;

/** Per-route transport/security metadata. */
export interface RouteMeta {
  /** `none` for `/health`; `nonce` for `/auth/exchange` (the body nonce is the credential); else session token or bearer. */
  auth: "none" | "nonce" | "required";
  /** Response kind. `longpoll` holds ≤ `timeoutMs` (default 25 s) then returns `timeout`. */
  kind: "json" | "text" | "sse" | "longpoll" | "download";
  /**
   * Allowed caller kinds; omitted = any authenticated caller. `web` = browser session token;
   * `cli` / `mcp` / `hook` = bearer token with a matching {@link HTTP_HEADERS.client} header.
   * Misuse prevention only — not a security boundary [SEC-19].
   */
  clients?: readonly ClientKind[];
  /** Mutations go through the workspace single-writer queue (global routes: the daemon `stateWrite` queue). */
  mutates: boolean;
  /** Body size limit in bytes (default 1 MiB). */
  maxBody?: number;
  /** Not required for MVP (M3); the server answers 501 until its WP lands (MILESTONES §5). */
  stretch?: true;
}

/** Exhaustive route metadata (CI fails if a route lacks an entry). */
export const ROUTE_META = {
  "GET /health": { auth: "none", kind: "json", mutates: false },
  "GET /daemon": { auth: "required", kind: "json", mutates: false },
  "POST /daemon/shutdown": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /auth/nonce": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /auth/exchange": { auth: "nonce", kind: "json", clients: ["web"], mutates: true },
  "POST /auth/logout": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /events": { auth: "required", kind: "sse", mutates: false },
  "GET /engines": { auth: "required", kind: "json", mutates: false },
  "POST /engines/:engine/probe": { auth: "required", kind: "json", mutates: true },
  "POST /engines/:engine/repin": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /settings": { auth: "required", kind: "json", mutates: false },
  "PATCH /settings": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "PATCH /settings/exec": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "GET /usage/summary": { auth: "required", kind: "json", mutates: false },
  "GET /usage/records": { auth: "required", kind: "json", mutates: false },
  "GET /workspaces": { auth: "required", kind: "json", mutates: false },
  "POST /workspaces": { auth: "required", kind: "json", mutates: true },
  "DELETE /workspaces/:ws": { auth: "required", kind: "json", mutates: true },
  "GET /integrations": { auth: "required", kind: "json", mutates: false },
  "POST /integrations/:target/install": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "GET /ws/:ws": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/init": { auth: "required", kind: "json", clients: ["cli", "web"], mutates: true },
  "GET /ws/:ws/scan": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/scan": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/settings": { auth: "required", kind: "json", mutates: false },
  "PATCH /ws/:ws/settings": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/trust": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/trust/:tr": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/git": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/map": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/graph": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/modules": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/facts": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/symbols": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/files/tree": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/files/content": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/cite": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/diagrams/:dg": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/doc": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/doc/sections/:section": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/sections/:section/translate": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/doc/text": { auth: "required", kind: "text", mutates: false },
  "GET /ws/:ws/doc/blocks/:block": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/blocks/:block/edit": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/doc/blocks/:block/revert": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/doc/blocks/:block/verify": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/doc/blocks/:block/history": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/blocks/:block/expand": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/doc/blocks/:block/simplify": { auth: "required", kind: "json", mutates: true, stretch: true },
  "POST /ws/:ws/doc/blocks/:block/translate": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/doc/proposals": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/proposals/:pp/accept": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/doc/proposals/:pp/reject": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "GET /ws/:ws/decisions": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/search": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/search/palette": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/threads": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/threads": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/threads/:th": { auth: "required", kind: "json", mutates: false },
  "PATCH /ws/:ws/threads/:th": { auth: "required", kind: "json", mutates: true },
  "DELETE /ws/:ws/threads/:th": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/threads/:th/messages": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/threads/:th/transition": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/threads/:th/reanchor": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/threads/:th/promote": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/threads/:th/bundle": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/threads/:th/reply": { auth: "required", kind: "json", clients: ["cli", "mcp"], mutates: true },
  "POST /ws/:ws/threads/:th/propose-resolution": { auth: "required", kind: "json", clients: ["cli", "mcp"], mutates: true },
  "GET /ws/:ws/review": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/review/estimate": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/review/finish": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/review/wait": { auth: "required", kind: "longpoll", clients: ["cli"], mutates: false },
  "POST /ws/:ws/review/rounds/:n/complete": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /ws/:ws/review/rounds/:n/withdraw": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/jobs/estimate": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/jobs": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/jobs": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/events": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/diff": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/prompt": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/jobs/:job/cancel": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/jobs/:job/gates/run": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/jobs/:job/accept": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/jobs/:job/reject": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/jobs/:job/revise": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/jobs/:job/retry": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/jobs/:job/commit": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/jobs/:job/pr": { auth: "required", kind: "json", clients: ["web"], mutates: true, stretch: true },
  "POST /ws/:ws/prompt": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/patches": { auth: "required", kind: "json", clients: ["mcp", "cli"], mutates: true },
  "GET /ws/:ws/checkpoints": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/checkpoints/:ck/undo": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/gen/estimate": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/gen/runs": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "GET /ws/:ws/gen/runs": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/gen/runs/:run": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/gen/runs/:run/control": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/gen/prioritize": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/gen/suggestions": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/gen/suggestions/:sg/run": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "POST /ws/:ws/gen/prep": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /ws/:ws/gen/ingest": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "GET /ws/:ws/inbox": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/touch": { auth: "required", kind: "json", clients: ["hook", "cli"], mutates: true },
  "GET /ws/:ws/digest": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/check": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/export": { auth: "required", kind: "json", clients: ["cli", "web"], mutates: false },
  "GET /ws/:ws/export/html": { auth: "required", kind: "download", mutates: false },
} as const satisfies Record<RouteKey, RouteMeta>;

/* ============================================================================
 * 10. SSE events (server → UI). Wire format (ADR-0009 R1) [CONS-04]:
 *     `id: <seq>\n` + `data: <json SseEvent>\n\n`  (no `event:` line; dispatch on `type`).
 *     `seq` = ONE daemon-global monotonic counter for every event (global and workspace).
 *     Heartbeat: comment line `: hb` every 15 s. First bytes `:\n\n` (Safari flush).
 *     Transport: `fetch()` streaming (the session token travels in the `authorization` header, which
 *     EventSource cannot send); the client resumes with `?last=<seq>` (same meaning as Last-Event-ID) [SEC-06].
 *     Reconnect: replay from ONE global ring buffer of the last 4,096 replayable events (filtered by `ws`)
 *     or a `resync` event when `last` is older than the buffer or from another daemon start (`hello.boot`).
 * ========================================================================== */

/** Envelope stamped by the server on every event. */
export interface SseEnvelope {
  /** Daemon-global monotonic sequence (the SSE `id`); dedupe/ordering key for global events. */
  seq: number;
  /** Workspace (null for global events). */
  ws: WorkspaceKey | null;
  /** Workspace revision after the write (workspace events only; null for global) — compare with `x-mitori-rev`. */
  rev: number | null;
  /** Server time. */
  at: Iso8601;
}

/** Event payloads emitted by domain packages (server adds {@link SseEnvelope}). */
export type SseEventPayload =
  // --- connection / daemon -----------------------------------------------------
  | {
      /** First event after connect. */
      type: "hello";
      /** Daemon version. */
      version: string;
      /** API version. */
      apiVersion: 1;
      /** Replay started from this seq (null = fresh). */
      resumedFrom: number | null;
      /** Random id of this daemon start; a different boot ⇒ the client treats `last` as stale. */
      boot: string;
    }
  | {
      /** Client must refetch state (gap too large or daemon restarted). */
      type: "resync";
      /** Why. */
      reason: "gap" | "restart";
    }
  | {
      /** Daemon is stopping (`mitori review` returns approved=false). */
      type: "server.shutdown";
      /** Reason. */
      reason: string;
    }
  | {
      /** User-facing notice (toast). */
      type: "notice";
      /** Severity. */
      level: "info" | "warn" | "error";
      /** i18n key. */
      key: string;
      /** Params. */
      params?: Record<string, string | number | boolean>;
    }
  | {
      /** Engine detection changed. */
      type: "engines.updated";
      /** Engines. */
      engines: EngineStatus[];
    }
  | {
      /** Scheduler changed (yield, backoff). */
      type: "scheduler.updated";
      /** Status. */
      scheduler: SchedulerStatus;
    }
  | {
      /** Usage ticker (status bar "今日 182k tok · 5h枠 23%"). */
      type: "usage.updated";
      /** Today totals. */
      today: UsageTotals;
      /** Latest window. */
      window?: SubscriptionWindow;
    }
  | {
      /** Workspace card/header changed. */
      type: "workspace.updated";
      /** Summary. */
      summary: WorkspaceSummary;
    }
  | {
      /** Settings changed. */
      type: "settings.updated";
      /** Scope. */
      scope: "global" | "workspace";
    }
  | {
      /** A trust decision is needed. */
      type: "trust.request";
      /** Request. */
      request: TrustRequest;
    }
  // --- scan / index ---------------------------------------------------------------
  | {
      /** Static scan progress (throttled 10 Hz). */
      type: "scan.progress";
      /** Stage. */
      stage: ScanStage;
      /** Done units. */
      done: number;
      /** Total units. */
      total: number;
    }
  | {
      /** Scan finished. */
      type: "scan.done";
      /** Summary. */
      summary: ScanSummaryView;
    }
  | {
      /** Scan failed. */
      type: "scan.failed";
      /** Error. */
      error: MitoriErrorData;
    }
  | {
      /** Incremental index update after file changes. */
      type: "index.changed";
      /** Changed paths. */
      paths: RepoPath[];
      /** Modules whose interface digest changed. */
      ifaceChanged: ModuleId[];
    }
  | {
      /** Map/graph changed (refetch). */
      type: "map.updated";
    }
  // --- doc ------------------------------------------------------------------------------
  | {
      /** Outline changed (sections added/removed/reordered) — refetch `GET /doc`. */
      type: "doc.outline";
      /** New outline revision. */
      outlineRev: number;
    }
  | {
      /** Block created/updated (generation streaming commits blocks one by one). */
      type: "doc.block.upsert";
      /** Rendered block. */
      block: BlockView;
    }
  | {
      /** The still-open last block while generating (plain text + cursor, coalesced per section at 10 Hz). */
      type: "doc.block.partial";
      /** Section being generated. */
      section: SectionId;
      /** Text so far of the open block. */
      text: string;
      /** Kind of the open block (height reservation, CLS 0) [CR gen-C12, ux-R13]. */
      kind?: BlockKind;
      /** Aspect of the open block. */
      aspect?: BlockAspect;
    }
  | {
      /** Block removed. */
      type: "doc.block.removed";
      /** Block. */
      block: BlockId;
      /** Section. */
      section: SectionId;
    }
  | {
      /** Freshness changed (save → stale badge ≤ 50 ms). */
      type: "doc.freshness";
      /** Blocks. */
      blocks: BlockId[];
      /** New freshness. */
      freshness: Freshness;
      /** Changed files that caused it. */
      paths: RepoPath[];
    }
  | {
      /** Claim verdicts changed (verification). */
      type: "doc.claims";
      /** Updated claims. */
      claims: Pick<Claim, "id" | "block" | "verdict" | "checks">[];
    }
  | {
      /** Proposal created/updated. */
      type: "doc.proposal.upsert";
      /** Proposal. */
      proposal: DocProposalView;
    }
  | {
      /** Proposal resolved/removed. */
      type: "doc.proposal.removed";
      /** Id. */
      id: ProposalId;
    }
  | {
      /** Doc files written to docDir. */
      type: "doc.saved";
      /** Docdir-relative files. */
      files: string[];
    }
  // --- generation ----------------------------------------------------------------------
  | {
      /** Run changed. */
      type: "gen.run";
      /** Run. */
      run: GenRun;
    }
  | {
      /** Task changed. */
      type: "gen.task";
      /** Task. */
      task: GenTaskView;
    }
  | {
      /** Regeneration / doc-sync suggestions changed (full current list) [CONS-09]. */
      type: "gen.suggestions";
      /** Suggestions. */
      suggestions: SuggestionView[];
    }
  | {
      /** Palette sources changed; refetch `GET /search/palette` (If-None-Match digest) [PT-15]. */
      type: "palette.changed";
      /** Which sources changed. */
      sources: ("symbols" | "files" | "sections" | "terms" | "threads")[];
    }
  // --- review / jobs -----------------------------------------------------------------
  | {
      /** Thread created/updated. */
      type: "thread.upsert";
      /** Thread. */
      thread: ThreadSummary;
    }
  | {
      /** Draft thread deleted. */
      type: "thread.removed";
      /** Id. */
      id: ThreadId;
    }
  | {
      /** Message appended. */
      type: "thread.message";
      /** Message (with rendered html). */
      message: MessageView;
    }
  | {
      /** Round changed. */
      type: "review.round";
      /** Round. */
      round: Round;
    }
  | {
      /** `mitori review` waiters changed (PullBar; no new tab is opened when a tab is connected) [UXP-01]. */
      type: "review.waiting";
      /** Round the waiters are waiting for. */
      round: number;
      /** Distinct waiters. */
      clients: number;
      /** Agent labels. */
      agents: string[];
    }
  | {
      /** Job created/updated. */
      type: "job.upsert";
      /** Job. */
      job: JobSummary;
    }
  | {
      /** Normalized job event (text deltas throttled 10 Hz). */
      type: "job.event";
      /** Job. */
      job: JobId;
      /** Event. */
      event: JobEvent;
    }
  | {
      /** Checkpoint created/undone. */
      type: "checkpoint.upsert";
      /** Checkpoint. */
      checkpoint: Checkpoint;
    };

/** Full SSE event. */
export type SseEvent = SseEventPayload & SseEnvelope;

/** Event type union. */
export type SseEventType = SseEventPayload["type"];

/**
 * Coalescing rule [PT-01]. Events of the same type are merged within `windowMs` ONLY when their `key` is equal:
 * `type` (one stream), `entity` (per entity id: job/task/section/summary key — see `entityKey`), with
 * `merge`: `latest` (last payload wins), `concat-text` (job.event `t:"text"` deltas concatenated in order;
 * every non-text job event is never coalesced and flushes the pending text first), `union` (doc.saved files).
 */
export interface SseCoalesce {
  /** Window in ms. */
  windowMs: number;
  /** Merge key. */
  key: "type" | "entity";
  /** Merge operation. */
  merge: "latest" | "concat-text" | "union";
  /** Payload field naming the entity when `key === "entity"` (dot path). */
  entityKey?: string;
}

/** Per-event delivery metadata (exhaustive). */
export interface SseEventMeta {
  /** Kept in the replay ring buffer (ephemeral progress is not replayed). */
  replay: boolean;
  /** Coalescing; omitted = every event delivered. */
  coalesce?: SseCoalesce;
  /** Global or per-workspace. */
  scope: "global" | "workspace";
}

/** Exhaustive SSE metadata. A fuzz test (3 jobs × 200 deltas at 1 ms) must rebuild byte-identical text [PT-01]. */
export const SSE_EVENT_META = {
  hello: { replay: false, scope: "global" },
  resync: { replay: false, scope: "global" },
  "server.shutdown": { replay: false, scope: "global" },
  notice: { replay: true, scope: "global" },
  "engines.updated": { replay: true, scope: "global" },
  "scheduler.updated": { replay: false, coalesce: { windowMs: 250, key: "type", merge: "latest" }, scope: "global" },
  "usage.updated": { replay: false, coalesce: { windowMs: 1000, key: "type", merge: "latest" }, scope: "global" },
  "workspace.updated": { replay: true, coalesce: { windowMs: 250, key: "entity", merge: "latest", entityKey: "summary.info.key" }, scope: "global" },
  "settings.updated": { replay: true, scope: "global" },
  "trust.request": { replay: true, scope: "workspace" },
  "scan.progress": { replay: false, coalesce: { windowMs: 100, key: "type", merge: "latest" }, scope: "workspace" },
  "scan.done": { replay: true, scope: "workspace" },
  "scan.failed": { replay: true, scope: "workspace" },
  "index.changed": { replay: true, scope: "workspace" },
  "map.updated": { replay: true, coalesce: { windowMs: 250, key: "type", merge: "latest" }, scope: "workspace" },
  "doc.outline": { replay: true, coalesce: { windowMs: 100, key: "type", merge: "latest" }, scope: "workspace" },
  "doc.block.upsert": { replay: true, scope: "workspace" },
  "doc.block.partial": { replay: false, coalesce: { windowMs: 100, key: "entity", merge: "latest", entityKey: "section" }, scope: "workspace" },
  "doc.block.removed": { replay: true, scope: "workspace" },
  "doc.freshness": { replay: true, scope: "workspace" },
  "doc.claims": { replay: true, scope: "workspace" },
  "doc.proposal.upsert": { replay: true, scope: "workspace" },
  "doc.proposal.removed": { replay: true, scope: "workspace" },
  "doc.saved": { replay: true, coalesce: { windowMs: 500, key: "type", merge: "union" }, scope: "workspace" },
  "gen.run": { replay: true, coalesce: { windowMs: 250, key: "entity", merge: "latest", entityKey: "run.id" }, scope: "workspace" },
  "gen.task": { replay: true, coalesce: { windowMs: 100, key: "entity", merge: "latest", entityKey: "task.id" }, scope: "workspace" },
  "gen.suggestions": { replay: true, coalesce: { windowMs: 500, key: "type", merge: "latest" }, scope: "workspace" },
  "palette.changed": { replay: false, coalesce: { windowMs: 1000, key: "type", merge: "union" }, scope: "workspace" },
  "thread.upsert": { replay: true, scope: "workspace" },
  "thread.removed": { replay: true, scope: "workspace" },
  "thread.message": { replay: true, scope: "workspace" },
  "review.round": { replay: true, scope: "workspace" },
  "review.waiting": { replay: true, coalesce: { windowMs: 500, key: "type", merge: "latest" }, scope: "workspace" },
  "job.upsert": { replay: true, scope: "workspace" },
  "job.event": { replay: false, coalesce: { windowMs: 100, key: "entity", merge: "concat-text", entityKey: "job" }, scope: "workspace" },
  "checkpoint.upsert": { replay: true, scope: "workspace" },
} as const satisfies Record<SseEventType, SseEventMeta>;

/* ============================================================================
 * 11. CLI ↔ daemon registry (`~/.mitori/daemon.json`, mode 0600)
 * ========================================================================== */

/**
 * Daemon registry file used by the CLI, MCP shim and hooks to find + authenticate. Before sending the token
 * the CLI calls `GET /health?challenge=<random>` and verifies `proof` = HMAC(token, challenge) [SEC-06].
 * Browser sessions do NOT depend on this token (they survive restarts) [UXP-07].
 */
export interface DaemonRegistry {
  /** PID. */
  pid: number;
  /** Port on 127.0.0.1. */
  port: number;
  /** 256-bit random bearer token (base64url). Rotated on every daemon start. */
  token: string;
  /** mitori version (CLI with a different version asks the daemon to restart when idle). */
  version: string;
  /** API version. */
  apiVersion: 1;
  /** Start time. */
  startedAt: Iso8601;
}
