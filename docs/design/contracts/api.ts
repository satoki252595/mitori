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
 *  - Every `/api/*` route except `GET /health` requires auth: browser session cookie
 *    ({@link COOKIES.session}) or `authorization: Bearer <token>` (CLI/MCP/hook).
 *  - State-changing methods enforce CSRF: if `sec-fetch-site` is present it must be
 *    `same-origin`; if absent, a bearer token is mandatory. `Host` must be
 *    `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defence) ⇒ else 421.
 *  - Errors: non-2xx with {@link ApiErrorBody}; status from `ERROR_META[code].http`.
 *  - Optimistic concurrency: mutable entities carry `version`; stale writes ⇒ 409 `E_CONFLICT`.
 *  - Responses to workspace mutations carry header `x-mitori-rev` = workspace revision after
 *    the write, so the client can ignore SSE events it already applied.
 *  - Server → UI push: one SSE stream (`GET /events`). UI → server: POST/PATCH/DELETE.
 */

import type {
  Anchor,
  BillingMode,
  AuthKind,
  BlockHistoryEntry,
  BlockId,
  BlockMeta,
  Checkpoint,
  CheckpointId,
  Claim,
  Decision,
  DiagramId,
  DiagramIR,
  DiagramLayout,
  DocLang,
  DocManifest,
  DocProposal,
  Effort,
  EngineId,
  ErrorCode,
  Estimate,
  EstimateId,
  ExcludeReason,
  ExecMode,
  Fact,
  FactKind,
  FileDiff,
  Freshness,
  GenEstimate,
  GenRun,
  GenRunId,
  GenTask,
  GitOid,
  GlobalSettings,
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
  PrepId,
  ProposalId,
  ReaderLevel,
  ReadingPath,
  RepoPath,
  RepoSnapshot,
  Resolution,
  Round,
  RouteDecision,
  ScanStage,
  SectionId,
  SectionNode,
  Sha256,
  SourceLang,
  SubscriptionWindow,
  SymbolEntry,
  SymbolKey,
  Thread,
  ThreadId,
  ThreadIntent,
  ThreadTrigger,
  TrustItemId,
  TrustRecord,
  UsageRecord,
  UsageTotals,
  WorkspaceInfo,
  WorkspaceKey,
  WorkspaceOverrides,
  EffectiveSettings,
  Cursor,
} from "./core.ts";

/* ============================================================================
 * 0. Transport constants
 * ========================================================================== */

/** JSON API prefix. Bumped only on breaking changes (`FORMAT.api`). */
export const API_PREFIX = "/api/v1" as const;

/** Non-API browser routes served by the daemon. */
export const PAGE_ROUTES = {
  /** SPA shell (with inline head script restoring pane widths/theme from `mitori_ui`). */
  app: "/",
  /** Browser login: `GET /auth?n=<nonce>&to=<path>` ⇒ sets session cookie, 302 to `to`. */
  auth: "/auth",
  /** Hashed immutable assets (`cache-control: public, max-age=31536000, immutable`, br/gzip precompressed). */
  assets: "/assets/",
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
  /** De-duplicates retried creates (threads, jobs, gen runs, finish). Same key ⇒ same result for 10 min. */
  idempotencyKey: "idempotency-key",
  /** Browser fetch metadata; must be `same-origin` on state-changing requests when present. */
  secFetchSite: "sec-fetch-site",
} as const;

/** Cookies. Cookies are port-agnostic on 127.0.0.1, which keeps UI prefs across random ports. */
export const COOKIES = {
  /** HttpOnly; SameSite=Strict; Path=/ — browser session (value = HMAC(token, nonce)). */
  session: "mitori_s",
  /** Readable by JS; UI prefs (theme, pane widths, reader level) for the zero-CLS head script. */
  ui: "mitori_ui",
} as const;

/** Client kinds (header {@link HTTP_HEADERS.client}). */
export type ClientKind = "web" | "cli" | "mcp" | "hook";

/** Error response body for every non-2xx JSON response. */
export interface ApiErrorBody {
  /** Error data. */
  error: MitoriErrorData;
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
  /** Problems preventing use (e.g. `E_AGENT_CAPABILITY` when `--bare` became default). */
  problems: { code: ErrorCode; message: string }[];
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

/** Floor-plan home (S1): static diagram + overlays. Zero tokens. */
export interface MapView {
  /** IR of the container/component map. */
  diagram: DiagramIR;
  /** Server-computed layout. */
  layout: DiagramLayout;
  /** Overlay counters keyed by diagram node id. */
  overlays: {
    /** Open threads. */
    comments: Record<string, number>;
    /** Running jobs. */
    working: Record<string, number>;
    /** Git churn (commits touching, last 90 days). */
    churn: Record<string, number>;
    /** Freshness of the described section. */
    freshness: Record<string, Freshness>;
  };
  /** Module tree. */
  modules: ModuleInfo[];
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
  /** Block root: `<div class="mb" data-block="b_…" data-kind data-depth data-fresh data-lock>`. */
  block: { cls: "mb", attrs: ["data-block", "data-kind", "data-depth", "data-fresh", "data-lock"] },
  /** Claim span: `<span class="mc" data-claim="cl_…" data-verdict="…">`. */
  claim: { cls: "mc", attrs: ["data-claim", "data-verdict"] },
  /** Citation chip: `<a class="mcite" data-cite="path:start-end" data-blob href="#/code/…">`. */
  cite: { cls: "mcite", attrs: ["data-cite", "data-blob"] },
  /** Glossary term: `<abbr class="mterm" data-term="gl_…">`. */
  term: { cls: "mterm", attrs: ["data-term"] },
  /** Code block: `<pre class="mcode shiki" data-lang data-start>` (pre-highlighted). */
  code: { cls: "mcode", attrs: ["data-lang", "data-start"] },
  /** Diagram mount point: `<figure class="mdiagram" data-diagram="dg_…">` + text fallback list. */
  diagram: { cls: "mdiagram", attrs: ["data-diagram"] },
  /** Foreign Mermaid fence (repo docs only; lazy chunk): `<pre class="mmermaid">`. */
  mermaid: { cls: "mmermaid", attrs: [] },
  /** Deep-dive container: `<details class="mdeep">`. */
  deepdive: { cls: "mdeep", attrs: [] },
} as const;

/** Rendered block for the Reader (HTML is cached by `hash × lang × rendererVer`). */
export interface BlockView extends BlockMeta {
  /** Server-rendered HTML (see {@link HTML_CONTRACT}). */
  html: string;
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

/** `GET /ws/:ws/doc` — outline only (no HTML). */
export interface DocOutline {
  /** Manifest (null before the first generation; static sections still exist). */
  manifest: DocManifestSummary | null;
  /** Flat section list (tree via `children`), roots first in TOC order. */
  sections: SectionNode[];
  /** Block metadata (for minimap, counts, reader-level filtering without fetching HTML). */
  blocks: Record<BlockId, BlockMeta>;
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
  /** `doc` = the doc is wrong (lock as human-edited); `code` = make the code follow the doc (creates a doc_edit thread + job estimate). */
  apply: "doc" | "code";
}

/** Result of a doc edit. */
export interface DocEditRes {
  /** Updated block (apply=doc). */
  block?: BlockView;
  /** Created thread (apply=code). */
  thread?: ThreadSummary;
  /** Estimate for the follow-up job (apply=code). */
  estimate?: JobEstimate;
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
  /** Kind code: s=section b=block m=module f=file y=symbol t=term h=thread. */
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
  /** Href. */
  h: string;
}

/** `GET /ws/:ws/search/palette` (ETag = `rev`). ≤ 50k items. */
export interface PaletteIndex {
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

/** Thread with messages and jobs. */
export interface ThreadDetail extends Thread {
  /** Messages, oldest first. */
  messages: Message[];
  /** Jobs, oldest first. */
  jobViews: JobSummary[];
}

/** Create a thread (optimistic UI sends `idempotency-key`). */
export interface CreateThreadReq {
  /** Anchor. */
  anchor: Anchor;
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
  anchor?: Anchor;
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

/** Pull plane reply from the user's agent (`mitori reply`). Agents cannot resolve. */
export interface AgentReplyReq {
  /** `answer` = answered question; `done` = code changed in the working tree; `question` = needs human input. */
  kind: "answer" | "done" | "question";
  /** Body (verbatim). */
  body: string;
  /** Files the agent changed (verified via fs/git). */
  files?: RepoPath[];
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
  /** Threads that would be dispatched by Finish. */
  pending: ThreadId[];
  /** Blocking `mitori review` clients currently waiting. */
  waitingClients: number;
}

/** Finish (Shift+F): dispatch pending threads. */
export interface FinishReq {
  /** `push` = one batch job via the default engine; `pull` = release the waiting `mitori review`. */
  mode: "push" | "pull";
  /** Subset; default all pending. */
  threads?: ThreadId[];
}

/** Finish result. */
export interface FinishRes {
  /** Round created. */
  round: Round;
  /** Batch job (push). */
  job?: JobSummary;
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
  /** Kind (explain = question/review answer; fix = change/doc_edit). */
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
}

/** Create job = estimate id + confirmation when required. */
export interface CreateJobReq extends JobReq {
  /** Estimate being confirmed (must match the current index digest). */
  estimateId: EstimateId;
  /** Required when `estimate.requiresConfirm`. */
  confirm?: boolean;
}

/** Accept selection (hunk / block granularity). */
export interface AcceptReq {
  /** Accept everything. */
  all?: boolean;
  /** Hunks to accept (others are discarded). */
  hunks?: HunkId[];
  /** Doc proposals to accept. */
  proposals?: ProposalId[];
}

/** Accept result. */
export interface AcceptRes {
  /** Updated job. */
  job: JobSummary;
  /** Undo point. */
  checkpoint: Checkpoint;
  /** Files written to the working tree. */
  files: RepoPath[];
  /** Threads marked stale because their anchors overlapped. */
  staleThreads: ThreadId[];
  /** For `remote-readonly`: path of the exported `.patch` instead of applying. */
  patchFile?: string;
}

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
  /** Doc update for the anchored block. */
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

/** Start a generation run (always an explicit click, D3). */
export interface GenRunReq {
  /** Estimate id confirmed. */
  estimateId: EstimateId;
  /** Explicit confirmation. */
  confirm: true;
}

/** Generation task summary for the progress UI. */
export type GenTaskView = Pick<GenTask, "id" | "stage" | "target" | "state" | "priority" | "attempt" | "usage" | "blocks">;

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

/** `mitori gen --prep` result. */
export interface PrepInfo {
  /** Packet id. */
  id: PrepId;
  /** Absolute directory (`<repo>/.mitori/tmp/prep/<id>/`, gitignored, readable by the user's agent). */
  dir: string;
  /** Server-issued fingerprint; ingest without it (or with a stale one) is rejected. */
  fingerprint: Sha256;
  /** Task count. */
  tasks: number;
  /** Path of README.md (instructions by reference). */
  readme: string;
  /** Expiry (index digest change also expires it). */
  expiresAt: Iso8601;
  /** Estimate (C=1). */
  estimate: GenEstimate;
}

/** Ingest request. */
export interface IngestReq {
  /** Packet. */
  prep: PrepId;
  /** Fingerprint from {@link PrepInfo}. */
  fingerprint: Sha256;
  /** Accept partial output (remaining tasks stay pending). */
  partial: boolean;
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

/** Inbox filters (S4). */
export type InboxFilter = "working" | "review" | "failed" | "mine" | "outdated" | "proposals" | "trust";

/** Inbox row. */
export interface InboxItem {
  /** Item kind. */
  kind: "thread" | "job" | "proposal" | "trust" | "gen_run";
  /** Id. */
  id: string;
  /** Title. */
  title: string;
  /** State label (thread/job/proposal state). */
  state: string;
  /** Filters this item matches. */
  tags: InboxFilter[];
  /** Updated at. */
  updatedAt: Iso8601;
  /** Href. */
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
}

/** Deep partial helper for settings patches. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Patch global settings. */
export interface PatchSettingsReq {
  /** Expected version. */
  version: number;
  /** Partial settings (validated; unknown keys rejected). */
  patch: DeepPartial<GlobalSettings>;
}

/** Workspace settings view. */
export type WorkspaceSettingsView = EffectiveSettings;

/** Patch workspace overrides (stored in the global file). */
export interface PatchWorkspaceSettingsReq {
  /** Overrides. */
  overrides: WorkspaceOverrides;
}

/** Usage aggregation range. */
export type UsageRange = "today" | "7d" | "30d" | "all";

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

/** Export request (P3 self-contained HTML). */
export interface ExportReq {
  /** Format. */
  format: "html";
  /** Reader level baked as default (the export still contains all depths). */
  level: ReaderLevel;
  /** Language. */
  lang: DocLang;
  /** Include resolved decisions. */
  includeDecisions: boolean;
  /** Absolute output path (CLI); omitted ⇒ downloadable via `GET /ws/:ws/export/html`. */
  out?: string;
}

/** Export result. */
export interface ExportRes {
  /** Written path (when `out` given). */
  path?: string;
  /** Size in bytes. */
  bytes: number;
  /** Integrity hash. */
  sha256: Sha256;
  /** Secret-like strings redacted. */
  redactions: number;
}

/** Workspace open request (`mitori <path|url>`). */
export interface OpenWorkspaceReq {
  /** Absolute path or `https://github.com/<owner>/<repo>`. */
  target: string;
}

/** `mitori init`. */
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
  /** URL to open: `http://127.0.0.1:<port>/auth?n=<nonce>&to=<path>`. */
  url: string;
  /** Expiry (60 s, single use). */
  expiresAt: Iso8601;
}

/** Hook `touch` (PostToolUse): files an agent edited. Zero output to the agent. */
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

/** All daemon routes. Keys are relative to {@link API_PREFIX}. */
export interface ApiRoutes {
  // --- daemon / global -------------------------------------------------------
  "GET /health": Route<Empty, Empty, undefined, HealthRes>;
  "GET /daemon": Route<Empty, Empty, undefined, DaemonStatus>;
  "POST /daemon/shutdown": Route<Empty, Empty, { reason?: string; force?: boolean }, Ok>;
  "POST /auth/nonce": Route<Empty, Empty, { to?: string }, NonceRes>;
  "GET /events": Route<Empty, { ws?: WorkspaceKey }, undefined, SseEvent>;
  "GET /engines": Route<Empty, Empty, undefined, EngineStatus[]>;
  "POST /engines/:engine/probe": Route<{ engine: EngineId }, Empty, undefined, EngineStatus>;
  "GET /settings": Route<Empty, Empty, undefined, SettingsView>;
  "PATCH /settings": Route<Empty, Empty, PatchSettingsReq, SettingsView>;
  "GET /usage/summary": Route<Empty, { range: UsageRange; ws?: WorkspaceKey }, undefined, UsageSummary>;
  "GET /usage/records": Route<Empty, PageQuery & { ws?: WorkspaceKey }, undefined, Page<UsageRecord>>;
  "GET /workspaces": Route<Empty, Empty, undefined, WorkspaceSummary[]>;
  "POST /workspaces": Route<Empty, Empty, OpenWorkspaceReq, WorkspaceSummary>;
  "DELETE /workspaces/:ws": Route<WsParam, { forget?: "1" }, undefined, Ok>;

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
  "GET /ws/:ws/files/content": Route<WsParam, { path: RepoPath; start?: number; end?: number }, undefined, FileContent>;
  "GET /ws/:ws/cite": Route<WsParam, { path: RepoPath; start: number; end: number; blob: GitOid; ctx?: number }, undefined, CitePeek>;
  "GET /ws/:ws/diagrams/:dg": Route<WsParam & { dg: DiagramId }, Empty, undefined, DiagramView>;

  // --- doc ---------------------------------------------------------------------
  "GET /ws/:ws/doc": Route<WsParam, Empty, undefined, DocOutline>;
  "GET /ws/:ws/doc/sections/:section": Route<WsParam & { section: SectionId }, { lang?: DocLang }, undefined, SectionView>;
  "GET /ws/:ws/doc/text": Route<WsParam, { ref: string; depth?: number }, undefined, string>;
  "GET /ws/:ws/doc/blocks/:block": Route<WsParam & { block: BlockId }, { lang?: DocLang }, undefined, BlockView>;
  "POST /ws/:ws/doc/blocks/:block/edit": Route<WsParam & { block: BlockId }, Empty, DocEditReq, DocEditRes>;
  "POST /ws/:ws/doc/blocks/:block/verify": Route<WsParam & { block: BlockId }, Empty, { verified: boolean }, BlockView>;
  "GET /ws/:ws/doc/blocks/:block/history": Route<WsParam & { block: BlockId }, Empty, undefined, BlockHistoryEntry[]>;
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
  "POST /ws/:ws/threads/:th/reanchor": Route<WsParam & { th: ThreadId }, Empty, { anchor: Anchor; version: number }, ThreadDetail>;
  "POST /ws/:ws/threads/:th/promote": Route<WsParam & { th: ThreadId }, Empty, { to: "decision" | "doc"; title?: string }, { decision?: Decision; proposal?: DocProposalView }>;
  "GET /ws/:ws/threads/:th/bundle": Route<WsParam & { th: ThreadId }, { budget?: number; lines?: "1" }, undefined, string>;
  "POST /ws/:ws/threads/:th/reply": Route<WsParam & { th: ThreadId }, Empty, AgentReplyReq, ThreadSummary>;
  "POST /ws/:ws/threads/:th/propose-resolution": Route<WsParam & { th: ThreadId }, Empty, ProposeResolutionReq, Ok>;

  // --- review rounds (batch / Pull) ----------------------------------------------
  "GET /ws/:ws/review": Route<WsParam, Empty, undefined, ReviewStatus>;
  "POST /ws/:ws/review/finish": Route<WsParam, Empty, FinishReq, FinishRes>;
  "GET /ws/:ws/review/wait": Route<WsParam, { round?: number; timeoutMs?: number }, undefined, ReviewWaitRes>;
  "POST /ws/:ws/review/rounds/:n/complete": Route<WsParam & { n: string }, Empty, undefined, Round>;

  // --- jobs ----------------------------------------------------------------------
  "POST /ws/:ws/jobs/estimate": Route<WsParam, Empty, JobReq, JobEstimate>;
  "POST /ws/:ws/jobs": Route<WsParam, Empty, CreateJobReq, JobSummary>;
  "GET /ws/:ws/jobs": Route<WsParam, PageQuery & { state?: JobState; thread?: ThreadId }, undefined, Page<JobSummary>>;
  "GET /ws/:ws/jobs/:job": Route<WsParam & { job: JobId }, Empty, undefined, JobDetail>;
  "GET /ws/:ws/jobs/:job/events": Route<WsParam & { job: JobId }, { after?: number }, undefined, JobEvent[]>;
  "GET /ws/:ws/jobs/:job/diff": Route<WsParam & { job: JobId }, Empty, undefined, FileDiff[]>;
  "GET /ws/:ws/jobs/:job/prompt": Route<WsParam & { job: JobId }, { target: CopyPromptReq["target"] }, undefined, string>;
  "POST /ws/:ws/jobs/:job/cancel": Route<WsParam & { job: JobId }, Empty, undefined, JobSummary>;
  "POST /ws/:ws/jobs/:job/accept": Route<WsParam & { job: JobId }, Empty, AcceptReq, AcceptRes>;
  "POST /ws/:ws/jobs/:job/reject": Route<WsParam & { job: JobId }, Empty, { reason?: string }, JobSummary>;
  "POST /ws/:ws/jobs/:job/revise": Route<WsParam & { job: JobId }, Empty, { message: string }, JobSummary>;
  "POST /ws/:ws/jobs/:job/retry": Route<WsParam & { job: JobId }, Empty, { engine?: EngineId }, JobSummary>;
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
  "POST /ws/:ws/gen/prep": Route<WsParam, Empty, GenEstimateReq, PrepInfo>;
  "POST /ws/:ws/gen/ingest": Route<WsParam, Empty, IngestReq, IngestReport>;

  // --- inbox, hooks, checks, export ------------------------------------------------
  "GET /ws/:ws/inbox": Route<WsParam, PageQuery & { filter?: InboxFilter }, undefined, Page<InboxItem>>;
  "POST /ws/:ws/touch": Route<WsParam, Empty, TouchReq, { staleBlocks: number }>;
  "GET /ws/:ws/digest": Route<WsParam, { maxTokens?: number }, undefined, string>;
  "POST /ws/:ws/check": Route<WsParam, Empty, CheckReq, CheckReport>;
  "POST /ws/:ws/export": Route<WsParam, Empty, ExportReq, ExportRes>;
  "GET /ws/:ws/export/html": Route<WsParam, { level?: ReaderLevel; lang?: DocLang }, undefined, string>;
}

/** Route key union. */
export type RouteKey = keyof ApiRoutes;

/** Per-route transport/security metadata. */
export interface RouteMeta {
  /** `none` only for `/health`. Everything else: cookie or bearer. */
  auth: "none" | "required";
  /** Response kind. `longpoll` holds ≤ `timeoutMs` (default 25 s) then returns `timeout`. */
  kind: "json" | "text" | "sse" | "longpoll" | "download";
  /**
   * Allowed caller kinds; omitted = any authenticated caller. `web` = browser session cookie;
   * `cli` / `mcp` / `hook` = bearer token with a matching {@link HTTP_HEADERS.client} header.
   */
  clients?: readonly ClientKind[];
  /** Mutations go through the workspace single-writer queue. */
  mutates: boolean;
  /** Body size limit in bytes (default 1 MiB). */
  maxBody?: number;
}

/** Exhaustive route metadata (CI fails if a route lacks an entry). */
export const ROUTE_META = {
  "GET /health": { auth: "none", kind: "json", mutates: false },
  "GET /daemon": { auth: "required", kind: "json", mutates: false },
  "POST /daemon/shutdown": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /auth/nonce": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "GET /events": { auth: "required", kind: "sse", mutates: false },
  "GET /engines": { auth: "required", kind: "json", mutates: false },
  "POST /engines/:engine/probe": { auth: "required", kind: "json", mutates: true },
  "GET /settings": { auth: "required", kind: "json", mutates: false },
  "PATCH /settings": { auth: "required", kind: "json", mutates: true },
  "GET /usage/summary": { auth: "required", kind: "json", mutates: false },
  "GET /usage/records": { auth: "required", kind: "json", mutates: false },
  "GET /workspaces": { auth: "required", kind: "json", mutates: false },
  "POST /workspaces": { auth: "required", kind: "json", mutates: true },
  "DELETE /workspaces/:ws": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/init": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/scan": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/scan": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/settings": { auth: "required", kind: "json", mutates: false },
  "PATCH /ws/:ws/settings": { auth: "required", kind: "json", mutates: true },
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
  "GET /ws/:ws/doc/text": { auth: "required", kind: "text", mutates: false },
  "GET /ws/:ws/doc/blocks/:block": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/blocks/:block/edit": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/doc/blocks/:block/verify": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/doc/blocks/:block/history": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/doc/blocks/:block/simplify": { auth: "required", kind: "json", mutates: true },
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
  "POST /ws/:ws/threads/:th/transition": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/threads/:th/reanchor": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/threads/:th/promote": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/threads/:th/bundle": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/threads/:th/reply": { auth: "required", kind: "json", clients: ["cli", "mcp"], mutates: true },
  "POST /ws/:ws/threads/:th/propose-resolution": { auth: "required", kind: "json", clients: ["cli", "mcp"], mutates: true },
  "GET /ws/:ws/review": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/review/finish": { auth: "required", kind: "json", clients: ["web"], mutates: true },
  "GET /ws/:ws/review/wait": { auth: "required", kind: "longpoll", clients: ["cli"], mutates: false },
  "POST /ws/:ws/review/rounds/:n/complete": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /ws/:ws/jobs/estimate": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/jobs": { auth: "required", kind: "json", mutates: true },
  "GET /ws/:ws/jobs": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/events": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/diff": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/jobs/:job/prompt": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/jobs/:job/cancel": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/jobs/:job/accept": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/jobs/:job/reject": { auth: "required", kind: "json", clients: ["web", "cli"], mutates: true },
  "POST /ws/:ws/jobs/:job/revise": { auth: "required", kind: "json", mutates: true },
  "POST /ws/:ws/jobs/:job/retry": { auth: "required", kind: "json", mutates: true },
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
  "POST /ws/:ws/gen/prep": { auth: "required", kind: "json", clients: ["cli"], mutates: true },
  "POST /ws/:ws/gen/ingest": { auth: "required", kind: "json", clients: ["cli"], mutates: true, maxBody: 16 * 1024 * 1024 },
  "GET /ws/:ws/inbox": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/touch": { auth: "required", kind: "json", clients: ["hook", "cli"], mutates: true },
  "GET /ws/:ws/digest": { auth: "required", kind: "text", mutates: false },
  "POST /ws/:ws/check": { auth: "required", kind: "json", mutates: false },
  "POST /ws/:ws/export": { auth: "required", kind: "json", mutates: false },
  "GET /ws/:ws/export/html": { auth: "required", kind: "download", mutates: false },
} as const satisfies Record<RouteKey, RouteMeta>;

/* ============================================================================
 * 10. SSE events (server → UI). Wire format:
 *     `id: <rev>\n` + `data: <json SseEvent>\n\n`  (no `event:` line; dispatch on `type`).
 *     Heartbeat: comment line `: hb` every 15 s. First bytes `:\n\n` (Safari flush).
 *     Reconnect: `Last-Event-ID` ⇒ replay from the per-workspace ring buffer (1,000 events)
 *     or a `resync` event when the gap is too large.
 * ========================================================================== */

/** Envelope stamped by the server on every event. */
export interface SseEnvelope {
  /** Workspace (null for global events). */
  ws: WorkspaceKey | null;
  /** Monotonic revision (per workspace; global events use the daemon counter). */
  rev: number;
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
      /** Replay started from this rev (null = fresh). */
      resumedFrom: number | null;
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
      /** The still-open last block while generating (plain text + cursor, throttled 10 Hz). */
      type: "doc.block.partial";
      /** Section being generated. */
      section: SectionId;
      /** Text so far of the open block. */
      text: string;
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
      /** Message. */
      message: Message;
    }
  | {
      /** Round changed. */
      type: "review.round";
      /** Round. */
      round: Round;
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

/** Per-event delivery metadata (exhaustive). */
export interface SseEventMeta {
  /** Kept in the replay ring buffer (ephemeral progress is not replayed). */
  replay: boolean;
  /** Coalescing window; latest value wins. */
  throttleMs?: number;
  /** Global or per-workspace. */
  scope: "global" | "workspace";
}

/** Exhaustive SSE metadata. */
export const SSE_EVENT_META = {
  hello: { replay: false, scope: "global" },
  resync: { replay: false, scope: "global" },
  "server.shutdown": { replay: false, scope: "global" },
  notice: { replay: true, scope: "global" },
  "engines.updated": { replay: true, scope: "global" },
  "scheduler.updated": { replay: false, throttleMs: 250, scope: "global" },
  "usage.updated": { replay: false, throttleMs: 1000, scope: "global" },
  "workspace.updated": { replay: true, throttleMs: 250, scope: "global" },
  "settings.updated": { replay: true, scope: "global" },
  "trust.request": { replay: true, scope: "workspace" },
  "scan.progress": { replay: false, throttleMs: 100, scope: "workspace" },
  "scan.done": { replay: true, scope: "workspace" },
  "scan.failed": { replay: true, scope: "workspace" },
  "index.changed": { replay: true, scope: "workspace" },
  "map.updated": { replay: true, throttleMs: 250, scope: "workspace" },
  "doc.outline": { replay: true, throttleMs: 100, scope: "workspace" },
  "doc.block.upsert": { replay: true, scope: "workspace" },
  "doc.block.partial": { replay: false, throttleMs: 100, scope: "workspace" },
  "doc.block.removed": { replay: true, scope: "workspace" },
  "doc.freshness": { replay: true, scope: "workspace" },
  "doc.claims": { replay: true, scope: "workspace" },
  "doc.proposal.upsert": { replay: true, scope: "workspace" },
  "doc.proposal.removed": { replay: true, scope: "workspace" },
  "doc.saved": { replay: true, throttleMs: 500, scope: "workspace" },
  "gen.run": { replay: true, throttleMs: 250, scope: "workspace" },
  "gen.task": { replay: true, throttleMs: 100, scope: "workspace" },
  "thread.upsert": { replay: true, scope: "workspace" },
  "thread.removed": { replay: true, scope: "workspace" },
  "thread.message": { replay: true, scope: "workspace" },
  "review.round": { replay: true, scope: "workspace" },
  "job.upsert": { replay: true, scope: "workspace" },
  "job.event": { replay: false, throttleMs: 100, scope: "workspace" },
  "checkpoint.upsert": { replay: true, scope: "workspace" },
} as const satisfies Record<SseEventType, SseEventMeta>;

/* ============================================================================
 * 11. CLI ↔ daemon registry (`~/.mitori/daemon.json`, mode 0600)
 * ========================================================================== */

/** Daemon registry file used by the CLI, MCP shim and hooks to find + authenticate. */
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
