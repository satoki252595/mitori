/**
 * @file mitori — shared domain contracts ("core").
 *
 * Status: AUTHORITATIVE. Owner: lead architect. Any change needs architect review
 * (and an ADR when it changes a persisted format or a cross-package boundary).
 *
 * Runtime home: `packages/core/src/domain/` re-exported from `@mitori/core`.
 * Rules for this file (and for `@mitori/core`):
 *  - types + `as const` data + pure helpers only; zero runtime dependencies;
 *  - isomorphic: must run unchanged in Bun, Node >= 22, the browser and Cloudflare Workers;
 *  - no `Bun.*`, no `node:*`, no DOM types;
 *  - every persisted shape carries an explicit schema version (see {@link FORMAT}).
 *
 * Section map:
 *   0 utility types · 1 formats/versions · 2 ids · 3 languages · 4 engines/models/effort
 *   5 pricing + token estimation data · 6 workspace/repo/index · 7 doc model · 8 diagrams
 *   9 anchors · 10 review (threads, state machine) · 11 jobs + normalized agent events
 *   12 output contracts (patch/1 …) · 13 diffs/checkpoints · 14 generation runs
 *   15 usage/estimate · 16 settings/trust · 17 errors · 18 ports · 19 package graph
 */

/* ============================================================================
 * 0. Utility types
 * ========================================================================== */

/** Nominal typing helper. Use sparingly (only where mixing values is a real bug risk). */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** ISO-8601 UTC timestamp with milliseconds, e.g. `"2026-10-03T10:00:00.000Z"`. */
export type Iso8601 = string;

/** Milliseconds since the Unix epoch. */
export type UnixMs = number;

/** 1-based line number (inclusive ranges everywhere: `start..end`). */
export type LineNo = number;

/**
 * Repo-relative POSIX path: no leading `./`, no `..` segments, no trailing `/`,
 * case preserved, NFC-normalized. Example: `"internal/auth/login.go"`.
 * Validated at every trust boundary (HTTP, CLI, agent output).
 */
export type RepoPath = string;

/** Glob in picomatch syntax, repo-relative (e.g. `"**\/*.pem"`). */
export type Glob = string;

/** Git object id: 40-hex (SHA-1 repos) or 64-hex (SHA-256 repos). */
export type GitOid = string;

/** 64-bit xxHash3 as 16 lowercase hex chars. Content addressing / cache keys / snippet hashes. */
export type Xxh3 = string;

/** SHA-256 as 64 lowercase hex chars. Used for trust hashes, fingerprints, share integrity. */
export type Sha256 = string;

/** Opaque pagination cursor issued by the server. */
export type Cursor = Brand<string, "Cursor">;

/** One page of results. */
export interface Page<T> {
  /** Items in this page, in the requested order. */
  items: T[];
  /** Cursor for the next page, `null` when exhausted. */
  next: Cursor | null;
  /** Total count when cheap to compute; omitted otherwise. */
  total?: number;
}

/** Explicit success/failure value used by validators and parsers at package boundaries. */
export type Result<T, E = MitoriErrorData> =
  | {
      /** Discriminator: success. */
      ok: true;
      /** The produced value. */
      value: T;
    }
  | {
      /** Discriminator: failure. */
      ok: false;
      /** Structured error (never a bare string). */
      error: E;
    };

/* ============================================================================
 * 1. Persisted formats & versions
 * ========================================================================== */

/**
 * Every persisted / wire format and its current version. Readers accept the current
 * version and up to two older ones via explicit migrators; newer versions are rejected
 * with `E_FORMAT_TOO_NEW` (never silently reinterpreted).
 */
export const FORMAT = {
  /** `<docDir>/mitori.json` ({@link DocManifest}). */
  docManifest: 1,
  /** `<docDir>/doc.index.json` ({@link DocIndex}). */
  docIndex: 1,
  /** Block-ID comment syntax in Markdown (`<!-- b_xxxxxxxx -->`). */
  blockIdSyntax: 1,
  /** `<docDir>/config.json` ({@link RepoSettings}). */
  repoSettings: 1,
  /** `~/.mitori/config.json` ({@link GlobalSettings}). */
  globalSettings: 1,
  /** Daemon HTTP API major version (`/api/v1`). */
  api: 1,
  /** Review bundle (tagged line-oriented text). */
  bundle: "mitori.bundle/1",
  /** Session-engine work packet written by `mitori gen --prep`. */
  prep: "mitori.prep/1",
  /** NDJSON generation line protocol. */
  genLine: "gen.block/1",
  /** `mitori review` stdout contract. */
  reviewOutput: "mitori.review/1",
  /** Self-contained HTML export payload. */
  export: "mitori.export/1",
  /** Encrypted share snapshot (Cloudflare, later). */
  snapshot: "mitori.snapshot/1",
} as const;

/** Output contract ids the router/agent bridge can request from an engine. */
export type OutputContractId =
  | "answer/1"
  | "findings/1"
  | "patch/1"
  | "agent/1"
  | "docpatch/1"
  | "gen.block/1";

/**
 * Prompt template version: `<promptId>@<integer>`; bump the integer on ANY byte change
 * of the template (cache keys and doc manifests record it). Example: `"gen.module@3"`.
 */
export type PromptVersion = `${string}@${number}`;

/** Extractor version for a language plugin: `<lang>@<grammarVer>+<queryHash8>`. */
export type ExtractorVersion = string;

/* ============================================================================
 * 2. Identifiers
 * ========================================================================== */

/**
 * ID alphabet: Crockford base32, lowercase, without i/l/o/u. Random bodies use
 * `crypto.getRandomValues`; deterministic bodies use base32(xxh3(seed)).
 */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz" as const;

/** Prefix and body length of every id kind. Body length 8 = 40 bits. */
export const ID_SPEC = {
  block: { prefix: "b_", len: 8 },
  claim: { prefix: "cl_", len: 8 },
  thread: { prefix: "th_", len: 8 },
  message: { prefix: "m_", len: 10 },
  job: { prefix: "j_", len: 10 },
  genRun: { prefix: "gr_", len: 8 },
  genTask: { prefix: "gt_", len: 10 },
  prep: { prefix: "pr_", len: 8 },
  proposal: { prefix: "pp_", len: 8 },
  checkpoint: { prefix: "ck_", len: 8 },
  decision: { prefix: "dc_", len: 8 },
  diagram: { prefix: "dg_", len: 8 },
  module: { prefix: "md_", len: 8 },
  estimate: { prefix: "es_", len: 10 },
  usage: { prefix: "us_", len: 12 },
  request: { prefix: "rq_", len: 10 },
  trust: { prefix: "tr_", len: 8 },
  glossary: { prefix: "gl_", len: 8 },
  workspace: { prefix: "ws_", len: 12 },
  doc: { prefix: "doc_", len: 12 },
} as const;

/** Document block id, e.g. `b_k3f9a2cq`. Unique within a doc; checked on every write. */
export type BlockId = `b_${string}`;
/** Claim id (a cited assertion inside a block). */
export type ClaimId = `cl_${string}`;
/** Review thread id. */
export type ThreadId = `th_${string}`;
/** Thread message id. */
export type MessageId = `m_${string}`;
/** Job id (one agent execution, or a doc operation). */
export type JobId = `j_${string}`;
/** Generation run id. */
export type GenRunId = `gr_${string}`;
/** Generation task id. */
export type GenTaskId = `gt_${string}`;
/** Session-engine prep packet id. */
export type PrepId = `pr_${string}`;
/** Doc change proposal id. */
export type ProposalId = `pp_${string}`;
/** Accept checkpoint id (undo target). */
export type CheckpointId = `ck_${string}`;
/** Promoted decision id. */
export type DecisionId = `dc_${string}`;
/** Diagram id. */
export type DiagramId = `dg_${string}`;
/** Structural module id (stable across rescans via member-overlap matching). */
export type ModuleId = `md_${string}`;
/** Estimate id (an estimate can be referenced when confirming a run). */
export type EstimateId = `es_${string}`;
/** Usage ledger record id. */
export type UsageRecordId = `us_${string}`;
/** Request id (logs, error bodies). */
export type RequestId = `rq_${string}`;
/** Trust request/record id. */
export type TrustItemId = `tr_${string}`;
/** Glossary entry id. */
export type GlossaryId = `gl_${string}`;
/** Workspace key: `ws_` + base32(sha256(realpath(root) or remote URL))[:12]. */
export type WorkspaceKey = `ws_${string}`;
/** Stable document identity stored in the manifest (survives repo moves). */
export type DocId = `doc_${string}`;
/** Symbol key: `<RepoPath>#<qualified name>`, e.g. `internal/auth/login.go#Login`. */
export type SymbolKey = `${string}#${string}`;
/** Hunk id inside a diff: `<RepoPath>:<oldStart>` (0 for added files). */
export type HunkId = `${string}:${number}`;
/** Gate id, e.g. `fmt:gofmt`, `typecheck:tsc`, `test:related`. */
export type GateId = `${string}:${string}`;

/* ============================================================================
 * 3. Languages
 * ========================================================================== */

/** UI language. */
export type UiLang = "ja" | "en";

/** Language a doc block is written in. Generation is eager in the primary language only (D5). */
export type DocLang = "ja" | "en";

/** Source languages with a tree-sitter plugin. `generic` = line-based fallback. */
export type SourceLang =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "php"
  | "generic";

/** Languages that must work in MVP (D8). Java/C#/PHP are next; others use `generic`. */
export const MVP_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "rust",
  "generic",
] as const satisfies readonly SourceLang[];

/** Classification of a tracked file by the S0 inventory filter. */
export type FileClass =
  | "source"
  | "test"
  | "docs"
  | "config"
  | "vendored"
  | "generated"
  | "minified"
  | "lockfile"
  | "data_large"
  | "binary"
  | "secret"
  | "oversize"
  | "ignored";

/** Classes that are fed (as text or skeleton) to generation. Everything else is excluded or named only. */
export const INCLUDED_CLASSES = [
  "source",
  "test",
  "docs",
  "config",
] as const satisfies readonly FileClass[];

/* ============================================================================
 * 4. Engines, models, effort
 * ========================================================================== */

/**
 * Execution engines (D3).
 * - `claude-cli`: lean `claude -p` spawned by mitori with the user's subscription (default).
 * - `session`: in-session Pull — the user's interactive agent runs `mitori gen --prep/--ingest`
 *   or `mitori review`; mitori never spawns anything.
 * - `anthropic-api`: Messages API with the user's API key (opt-in; caching breakpoints, Batch,
 *   count_tokens, structured outputs).
 * - `codex-cli`: `codex exec` adapter (after MVP).
 * - `generic`: global-config `cmd` reading the prompt on stdin, reply on stdout (no usage data).
 */
export type EngineId = "claude-cli" | "session" | "anthropic-api" | "codex-cli" | "generic";

/** Full Claude model ids only — aliases (`sonnet`, `opus`) are forbidden everywhere. */
export type ClaudeModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-4-5";

/** Any model reference. Non-Claude models are namespaced by engine. */
export type ModelId = ClaudeModelId | `codex:${string}` | `generic:${string}`;

/** Reasoning effort passed to the engine (`--effort` / `output_config.effort`). */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Generation effort tiers (D13 default `standard`). Scope formulas live in gen. */
export type Effort = "overview" | "standard" | "complete";

/** Execution mode chosen by the deterministic router. */
export type ExecMode = "answer" | "patch" | "agent";

/** Tool profile granted to a spawned agent. `none` for answer/patch; `read_edit` for agent. Bash is never granted. */
export type ToolProfile = "none" | "read_edit";

/** How the engine authenticates; checked on every run (`init.apiKeySource` for claude-cli). */
export type AuthKind = "subscription" | "api-key" | "none" | "unknown";

/** Billing interpretation of the last observed run (subscription windows vs metered overage/credits). */
export type BillingMode = "subscription-window" | "overage" | "metered-api" | "unknown";

/* ============================================================================
 * 5. Pricing & token estimation (data)
 * ========================================================================== */

/** Tokenizer families. Sonnet/Opus 5.x use `claude-v5` (+25–34% tokens vs `claude-v4`). */
export type TokenizerId = "claude-v5" | "claude-v4" | "o200k";

/** Per-model list price in USD per million tokens. */
export interface ModelPrice {
  /** Uncached input. */
  inPerMTok: number;
  /** Cache write, 5-minute TTL (1.25× input). */
  cacheWrite5mPerMTok: number;
  /** Cache write, 1-hour TTL (2× input). claude-cli system prompts are auto-cached at 1h. */
  cacheWrite1hPerMTok: number;
  /** Cache read. */
  cacheReadPerMTok: number;
  /** Output (thinking tokens are billed as output). */
  outPerMTok: number;
  /** Multiplier applied to all token classes for Message Batches (stacks with cache discounts). */
  batchMultiplier: number;
  /** Minimum cacheable prefix in tokens; shorter prefixes silently do not cache. */
  minCachePrefixTokens: number;
  /** Tokenizer family for estimation. */
  tokenizer: TokenizerId;
  /** Output tokens/second used for wall-time estimates (calibrated at runtime). */
  outTokPerSec: number;
}

/** Version stamp recorded with every computed `apiUsd`. Bump when {@link PRICING} changes. */
export const PRICING_VERSION = "2026-09-25" as const;

/** List prices (Anthropic first-party API). Source: claude-api skill cache 2026-09-25. */
export const PRICING = {
  "claude-opus-5-5": {
    inPerMTok: 4,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 8,
    cacheReadPerMTok: 0.2,
    outPerMTok: 20,
    batchMultiplier: 0.5,
    minCachePrefixTokens: 512,
    tokenizer: "claude-v5",
    outTokPerSec: 70,
  },
  "claude-sonnet-5-5": {
    inPerMTok: 2,
    cacheWrite5mPerMTok: 2.5,
    cacheWrite1hPerMTok: 4,
    cacheReadPerMTok: 0.2,
    outPerMTok: 10,
    batchMultiplier: 0.5,
    minCachePrefixTokens: 512,
    tokenizer: "claude-v5",
    outTokPerSec: 125,
  },
  "claude-haiku-4-5": {
    inPerMTok: 1,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2,
    cacheReadPerMTok: 0.1,
    outPerMTok: 5,
    batchMultiplier: 0.5,
    minCachePrefixTokens: 4096,
    tokenizer: "claude-v4",
    outTokPerSec: 150,
  },
} as const satisfies Record<ClaudeModelId, ModelPrice>;

/** Text kinds with distinct chars/token ratios. */
export type TextKind = "code" | "markdown_en" | "markdown_ja" | "minified" | "lock" | "json" | "css";

/**
 * Initial chars-per-token coefficients (research 04 §2.1, measured on this project's corpus).
 * Runtime estimators start here and are corrected by an EMA over observed `usage`
 * (key: tokenizer × kind × intent). `chars/4` is forbidden (1.95× under-estimate on code).
 */
export const CHARS_PER_TOKEN = {
  "claude-v5": { code: 2.3, markdown_en: 2.87, markdown_ja: 1.25, minified: 1.69, lock: 1.27, json: 2.0, css: 2.2 },
  "claude-v4": { code: 3.05, markdown_en: 3.84, markdown_ja: 1.33, minified: 2.11, lock: 1.38, json: 2.6, css: 2.59 },
  o200k: { code: 3.7, markdown_en: 4.0, markdown_ja: 1.38, minified: 3.0, lock: 2.0, json: 3.2, css: 3.5 },
} as const satisfies Record<TokenizerId, Record<TextKind, number>>;

/** Cost colour bands shown on estimate chips (UX 07 §3.4). */
export type TokenBand = "lt10k" | "10k_50k" | "50k_200k" | "gt200k";

/* ============================================================================
 * 6. Workspace, repository, index
 * ========================================================================== */

/**
 * Workspace kind.
 * - `git`: a normal git working tree.
 * - `shadow`: non-git directory indexed through `GIT_DIR=~/.mitori/repos/<k>/shadow.git`.
 * - `remote-readonly`: GitHub URL shallow-cloned via `gh`; fixes are exported as patch/PR.
 */
export type WorkspaceKind = "git" | "shadow" | "remote-readonly";

/** Identity and location of an opened workspace. */
export interface WorkspaceInfo {
  /** Stable key derived from realpath (or remote URL). */
  key: WorkspaceKey;
  /** Absolute realpath of the working tree root. */
  root: string;
  /** Workspace kind. */
  kind: WorkspaceKind;
  /** Display name (directory name or `owner/repo`). */
  name: string;
  /** Doc directory: repo-relative for `git`, absolute for `shadow` when not inside the tree. */
  docDir: string;
  /** Whether `<docDir>` is intended to be committed (set by `mitori init`). */
  docCommitted: boolean;
  /** Remote origin for `remote-readonly`. */
  remote?: {
    /** Hosting provider. */
    provider: "github";
    /** Owner/org. */
    owner: string;
    /** Repository name. */
    repo: string;
    /** Canonical https URL. */
    url: string;
  };
  /** Doc identity from the manifest, when a doc exists. */
  docId?: DocId;
  /** Last time this workspace was opened in the UI. */
  lastOpenedAt?: Iso8601;
}

/** Point-in-time identity of the indexed working tree. */
export interface RepoSnapshot {
  /** HEAD commit (null for unborn branches / shadow repos without commits). */
  commit: GitOid | null;
  /** Tree id of the (possibly dirty) indexed state, computed via a temporary index. */
  tree: GitOid | null;
  /** Current branch name, `null` when detached. */
  branch: string | null;
  /** True when the working tree has uncommitted or untracked changes. */
  dirty: boolean;
  /** xxh3 over sorted `(path, blob)` of included files — the Merkle root mitori uses. */
  indexDigest: Xxh3;
  /** When the snapshot was taken. */
  takenAt: Iso8601;
}

/** Why a file was excluded from generation input. */
export type ExcludeReason =
  | "vendored"
  | "generated"
  | "minified"
  | "lockfile"
  | "data_large"
  | "binary"
  | "secret"
  | "oversize"
  | "gitignored"
  | "user_exclude"
  | "deny_glob";

/** One tracked file after S0 inventory. */
export interface FileEntry {
  /** Repo-relative path. */
  path: RepoPath;
  /** Git blob id (from `git ls-files -s` or hashed for dirty files). */
  blob: GitOid;
  /** Size in bytes. */
  size: number;
  /** Detected source language (`generic` when no plugin applies). */
  lang: SourceLang;
  /** Inventory class. */
  class: FileClass;
  /** Present when the file is excluded from generation input. */
  excluded?: ExcludeReason;
  /** Physical line count. */
  lines: number;
  /** Non-blank, non-comment line count (best effort). */
  loc: number;
  /** Estimated tokens of the full text for the default tokenizer. */
  tokensEst: number;
  /** Owning leaf module, when clustered. */
  module?: ModuleId;
}

/** Symbol kinds extracted by tags queries (superset across languages). */
export type SymbolKind =
  | "module"
  | "namespace"
  | "class"
  | "struct"
  | "interface"
  | "trait"
  | "impl"
  | "enum"
  | "type"
  | "function"
  | "method"
  | "constructor"
  | "field"
  | "const"
  | "var"
  | "macro"
  | "test";

/** One symbol definition. */
export interface SymbolEntry {
  /** Stable key `<path>#<qualname>`. */
  key: SymbolKey;
  /** Defining file. */
  path: RepoPath;
  /** Blob the symbol was extracted from. */
  blob: GitOid;
  /** Kind. */
  kind: SymbolKind;
  /** Simple name. */
  name: string;
  /** Qualified name within the file (e.g. `Server.handleLogin`). */
  qualname: string;
  /** First line (inclusive). */
  start: LineNo;
  /** Last line (inclusive). */
  end: LineNo;
  /** One-line signature as written (truncated to 200 chars). */
  signature: string;
  /** xxh3 of the normalized signature (interface digest input). */
  sigHash: Xxh3;
  /** xxh3 of the normalized body (body-only change detection). */
  bodyHash: Xxh3;
  /** Exported / public visibility. */
  exported: boolean;
  /** Enclosing symbol key, if nested. */
  parent?: SymbolKey;
}

/** A structural module (leaf or parent) produced by S3 clustering. */
export interface ModuleInfo {
  /** Stable id (matched to the previous scan by member overlap ≥ 0.5). */
  id: ModuleId;
  /** URL/file slug, e.g. `internal-session`. Unique per workspace. */
  slug: string;
  /** Provisional name (`<dominant dir> + <representative symbol>`); LLM may later rename in the doc. */
  name: string;
  /** Parent module id (depth ≤ 3). */
  parent?: ModuleId;
  /** Child module ids (empty for leaves). */
  children: ModuleId[];
  /** Member files (leaf modules only; parents aggregate children). */
  paths: RepoPath[];
  /** Source LOC of members. */
  loc: number;
  /** PageRank-derived importance in [0,1]. */
  rank: number;
  /** xxh3 of sorted members (membership change detection). */
  membersDigest: Xxh3;
  /** xxh3 of exported sigHashes + inter-module edges (early-cutoff key). */
  ifaceDigest: Xxh3;
  /** True when the community crosses directory boundaries (rendered as a cross-cutting chapter). */
  crossCutting: boolean;
  /** Topological order index (bottom-up generation order after SCC condensation). */
  topoOrder: number;
}

/** Edge kinds in the structural graph. */
export type GraphEdgeKind = "import" | "ref" | "same_dir" | "call";

/** Static fact categories detected without LLM (S2). Each becomes a deterministic doc table. */
export type FactKind =
  | "entry"
  | "route"
  | "cli"
  | "env"
  | "schema"
  | "test"
  | "script"
  | "dependency"
  | "existing_doc"
  | "todo";

/** Common fields of every fact. */
export interface FactBase {
  /** Fact category. */
  kind: FactKind;
  /** Detector that produced it, e.g. `route.hono@1`. */
  detector: string;
  /** Source location. */
  path: RepoPath;
  /** Line (1-based) of the defining statement. */
  line: LineNo;
  /** Blob at detection time (staleness). */
  blob: GitOid;
}

/** An HTTP route. */
export interface RouteFact extends FactBase {
  /** Discriminator. */
  kind: "route";
  /** HTTP method or `ANY`. */
  method: string;
  /** Route pattern as written. */
  pattern: string;
  /** Handler symbol, when resolvable. */
  handler?: SymbolKey;
  /** Framework, e.g. `net/http`, `hono`, `fastapi`, `next-app`. */
  framework: string;
}

/** A CLI command / subcommand / flag set. */
export interface CliFact extends FactBase {
  /** Discriminator. */
  kind: "cli";
  /** Command path, e.g. `mitori gen`. */
  command: string;
  /** Flags as written (`--effort`). */
  flags: string[];
  /** Framework, e.g. `cobra`, `click`, `commander`, `argparse`. */
  framework: string;
}

/** An environment variable read by the code. Values are NEVER captured. */
export interface EnvFact extends FactBase {
  /** Discriminator. */
  kind: "env";
  /** Variable name. */
  name: string;
  /** Default literal if visible in code (secrets-scanned; omitted when suspicious). */
  hasDefault: boolean;
}

/** A program entry point. */
export interface EntryFact extends FactBase {
  /** Discriminator. */
  kind: "entry";
  /** Entry flavour. */
  entry: "main" | "bin" | "script" | "dockerfile" | "procfile" | "worker" | "lambda" | "test_main";
  /** Human label, e.g. `cmd/crit`. */
  label: string;
}

/** Schema / data-model source (migration, ORM model, SQL). */
export interface SchemaFact extends FactBase {
  /** Discriminator. */
  kind: "schema";
  /** Entity/table name. */
  entity: string;
  /** Source technology, e.g. `sql`, `prisma`, `drizzle`, `gorm`, `sqlalchemy`, `d1`. */
  source: string;
  /** Field names (types omitted to stay small). */
  fields: string[];
}

/** A test case name (behaviour spec signal). */
export interface TestFact extends FactBase {
  /** Discriminator. */
  kind: "test";
  /** Test name as written. */
  name: string;
  /** Symbol under test when obvious from naming. */
  subject?: SymbolKey;
}

/** A runnable script (package.json scripts, Makefile targets, flake apps, justfile). */
export interface ScriptFact extends FactBase {
  /** Discriminator. */
  kind: "script";
  /** Script name. */
  name: string;
  /** Command line as written (display only; never executed without trust). */
  command: string;
  /** Inferred purpose. */
  purpose: "build" | "run" | "test" | "lint" | "format" | "typecheck" | "other";
}

/** A declared dependency (package manifests). */
export interface DependencyFact extends FactBase {
  /** Discriminator. */
  kind: "dependency";
  /** Ecosystem. */
  ecosystem: "npm" | "go" | "pypi" | "cargo" | "maven" | "nuget" | "composer" | "other";
  /** Package name. */
  name: string;
  /** Version spec as written. */
  version: string;
  /** Dev/test only. */
  dev: boolean;
}

/** An existing human doc used as a prior (README, CLAUDE.md, AGENTS.md, ADRs). */
export interface ExistingDocFact extends FactBase {
  /** Discriminator. */
  kind: "existing_doc";
  /** Doc role. */
  role: "readme" | "agents" | "claude" | "adr" | "contributing" | "architecture" | "other";
  /** Title (first heading). */
  title: string;
}

/** A TODO/FIXME/HACK marker. */
export interface TodoFact extends FactBase {
  /** Discriminator. */
  kind: "todo";
  /** Marker word. */
  marker: "TODO" | "FIXME" | "HACK" | "XXX";
  /** Text after the marker (≤ 120 chars). */
  text: string;
}

/** Union of all static facts. */
export type Fact =
  | RouteFact
  | CliFact
  | EnvFact
  | EntryFact
  | SchemaFact
  | TestFact
  | ScriptFact
  | DependencyFact
  | ExistingDocFact
  | TodoFact;

/** Static scan stages (all zero-token). */
export type ScanStage = "S0" | "S1" | "S2" | "S3" | "S4";

/** Coverage disclosure shown at the top of the doc (honest "what was read"). */
export interface Coverage {
  /** Tracked files. */
  filesTotal: number;
  /** Files fed to generation (text or skeleton). */
  filesIncluded: number;
  /** Excluded counts per reason. */
  filesExcluded: Partial<Record<ExcludeReason, number>>;
  /** Included source LOC. */
  locIncluded: number;
  /** Leaf + parent modules. */
  modulesTotal: number;
  /** Modules with a generated page. */
  modulesGenerated: number;
  /** Claims in the doc. */
  claimsTotal: number;
  /** Claims with verdict `verified` or `human-verified`. */
  claimsVerified: number;
}

/* ============================================================================
 * 7. Doc model (Markdown + sidecar)
 * ========================================================================== */

/** Depth of a block (progressive disclosure, C4 zoom). */
export type Depth = "L0" | "L1" | "L2" | "L3";

/** Reader level selected in the header (`-` / `=` / `0`). */
export type ReaderLevel = "newcomer" | "standard" | "expert";

/** Audience tags used by reading paths (zero extra tokens). */
export type Audience = "newcomer" | "dev" | "reviewer" | "pm" | "sre";

/** Block kinds. Determines rendering, ID placement rule and visibility rules. */
export type BlockKind =
  | "heading"
  | "prose"
  | "list"
  | "table"
  | "diagram"
  | "code"
  | "facts"
  | "learn"
  | "recap"
  | "pitfall"
  | "deepdive"
  | "why"
  | "question"
  | "faq"
  | "placeholder";

/** Who authored the current text of the block. */
export type BlockOrigin = "static" | "ai" | "human";

/** Production status of the block content. */
export type BlockStatus = "ready" | "generating" | "placeholder";

/** Freshness vs the current code (driven by the anchor engine over the block's claims). */
export type Freshness = "fresh" | "stale" | "unknown";

/** Human lock: regeneration produces a proposal instead of overwriting. */
export type BlockLock = "human-edited" | "human-verified";

/** Generation provenance stamped by the server (never by the LLM). */
export interface BlockGenInfo {
  /** Model that produced the text. */
  model: ModelId;
  /** Engine used. */
  engine: EngineId;
  /** Stage, e.g. `S5`. */
  stage: GenStage;
  /** Prompt template version. */
  promptVer: PromptVersion;
  /** Snapshot index digest the input was built from. */
  indexDigest: Xxh3;
  /** Run that produced it. */
  run?: GenRunId;
}

/** Block metadata as stored in `doc.index.json` (the Markdown holds only text + id comment). */
export interface BlockMeta {
  /** Block id (also appears as the trailing `<!-- b_… -->` comment). */
  id: BlockId;
  /** Owning section. */
  section: SectionId;
  /** Doc file (docDir-relative), e.g. `doc/modules/internal-session.md`. */
  file: string;
  /** Order within the section (0-based, dense). */
  ord: number;
  /** Kind. */
  kind: BlockKind;
  /** Depth. */
  depth: Depth;
  /** Reading-path audiences. */
  audience: Audience[];
  /** Language of the canonical text. */
  lang: DocLang;
  /** Author of the current text. */
  origin: BlockOrigin;
  /** Production status. */
  status: BlockStatus;
  /** Freshness vs code. */
  freshness: Freshness;
  /** Human lock, if any. */
  lock?: BlockLock;
  /** Display name of the verifier when `lock === "human-verified"`. */
  verifiedBy?: string;
  /** xxh3 of the normalized Markdown (3-way merge base, edit detection). */
  hash: Xxh3;
  /** Claims inside this block (ordered by position). */
  claims: ClaimId[];
  /** Estimated reading time: ja 500 chars/min, en 230 wpm, code 5 s/line. */
  readingSec: number;
  /** Deterministic slot key for static/deterministic blocks (`hash(moduleId + slot)` → id). */
  slot?: string;
  /** Diagram rendered by this block (`kind === "diagram"`). */
  diagram?: DiagramId;
  /** Server-stamped generation provenance (`origin === "ai"`). */
  gen?: BlockGenInfo;
}

/** A block with its Markdown source (id comment stripped). */
export interface Block extends BlockMeta {
  /** Canonical Markdown text of the block without the id comment. */
  md: string;
}

/** Claim kinds. */
export type ClaimKind =
  | "architecture"
  | "behavior"
  | "edge_case"
  | "invariant"
  | "risk"
  | "performance"
  | "security"
  | "fact";

/** Claim verdict shown as a badge (verified / inferred / stale / human-verified, unsupported in red). */
export type Verdict = "verified" | "inferred" | "unsupported" | "stale" | "human-verified";

/** Precision of a citation range. */
export type CitePrecision = "exact" | "search";

/** A citation: code range backing a claim. Server stamps blob/symbol/snippet; LLM only emits path+range. */
export interface Cite {
  /** File. */
  path: RepoPath;
  /** First line (inclusive). */
  start: LineNo;
  /** Last line (inclusive). */
  end: LineNo;
  /** Blob the range refers to. */
  blob: GitOid;
  /** Smallest enclosing symbol, when any. */
  symbol?: SymbolKey;
  /** xxh3 of the normalized text of lines start..end. */
  snippet: Xxh3;
  /** `exact` = parser-verified range; `search` = heuristic text match. */
  precision: CitePrecision;
}

/** Static/LLM verification checks of a claim (L0–L3). */
export interface ClaimChecks {
  /** L0: path exists and 1 ≤ start ≤ end ≤ lines. */
  l0: boolean;
  /** L1: every backticked identifier in the claim appears within cited range ±2 lines. */
  l1: boolean;
  /** L2: snippet hash still matches current code. */
  l2: boolean;
  /** L3: sampled LLM judge — Supported / Partial / Unsupported. */
  l3?: "S" | "P" | "U";
  /** When the checks were last computed. */
  checkedAt: Iso8601;
}

/** A cited assertion inside a block. */
export interface Claim {
  /** Id. */
  id: ClaimId;
  /** Owning block. */
  block: BlockId;
  /** Kind. */
  kind: ClaimKind;
  /** Exact claim sentence as it appears in the block Markdown (for highlight and L1). */
  quote: string;
  /** Citations (≥ 1 for verified claims; 0 ⇒ verdict `inferred`). */
  cites: Cite[];
  /** Current verdict. */
  verdict: Verdict;
  /** Check results. */
  checks: ClaimChecks;
}

/** Fixed top-level sections (UX 07 §6.2 / synthesis §4.1). */
export type TopSectionId =
  | "s0"
  | "s1"
  | "s2"
  | "s3"
  | "s4"
  | "s5"
  | "s6"
  | "s7"
  | "s8"
  | "s9"
  | "s10"
  | "s11"
  | "s12"
  | "s13"
  | "appendix";

/** Section id: a top section or a sub-section path, e.g. `s6/internal-session`, `s3/login-flow`. */
export type SectionId = TopSectionId | `${TopSectionId}/${string}`;

/** Who produces a top section's content. */
export type SectionSource = "static" | "ai" | "mixed";

/** Template row of the fixed table of contents. */
export interface SectionTemplate {
  /** Section id. */
  id: TopSectionId;
  /** Japanese title. */
  titleJa: string;
  /** English title. */
  titleEn: string;
  /** Docdir-relative file holding the section (modules use `doc/modules/<slug>.md`). */
  file: string;
  /** Depths that appear in the section. */
  depths: readonly Depth[];
  /** Content source. */
  source: SectionSource;
  /** Effort tiers that generate AI content for this section (static content always exists). */
  generatedAt: readonly Effort[];
}

/** The fixed TOC. Generated sections never render empty: static facts + a placeholder block. */
export const DOC_TEMPLATE = [
  { id: "s0", titleJa: "ひとことで", titleEn: "TL;DR", file: "doc/00-tldr.md", depths: ["L0"], source: "mixed", generatedAt: ["overview", "standard", "complete"] },
  { id: "s1", titleJa: "これは何か・誰のためか・なぜあるか", titleEn: "What & why", file: "doc/01-what-why.md", depths: ["L0", "L1"], source: "ai", generatedAt: ["overview", "standard", "complete"] },
  { id: "s2", titleJa: "見取り図", titleEn: "Floor plan", file: "doc/02-floor-plan.md", depths: ["L1"], source: "mixed", generatedAt: ["overview", "standard", "complete"] },
  { id: "s3", titleJa: "主要な流れ", titleEn: "Key flows", file: "doc/03-key-flows.md", depths: ["L1", "L2"], source: "ai", generatedAt: ["overview", "standard", "complete"] },
  { id: "s4", titleJa: "動かしてみる", titleEn: "Quickstart", file: "doc/04-quickstart.md", depths: ["L1"], source: "static", generatedAt: [] },
  { id: "s5", titleJa: "コードの地図", titleEn: "Codebase map", file: "doc/05-codebase-map.md", depths: ["L2"], source: "mixed", generatedAt: ["overview", "standard", "complete"] },
  { id: "s6", titleJa: "モジュール詳細", titleEn: "Modules", file: "doc/06-modules.md", depths: ["L2", "L3"], source: "mixed", generatedAt: ["standard", "complete"] },
  { id: "s7", titleJa: "データモデル", titleEn: "Data model", file: "doc/07-data-model.md", depths: ["L2", "L3"], source: "mixed", generatedAt: ["standard", "complete"] },
  { id: "s8", titleJa: "外部インターフェース", titleEn: "Interfaces", file: "doc/08-interfaces.md", depths: ["L2"], source: "static", generatedAt: ["overview", "standard", "complete"] },
  { id: "s9", titleJa: "非機能", titleEn: "Quality attributes", file: "doc/09-quality.md", depths: ["L3"], source: "ai", generatedAt: ["standard", "complete"] },
  { id: "s10", titleJa: "設計判断", titleEn: "Decisions", file: "doc/10-decisions.md", depths: ["L2", "L3"], source: "mixed", generatedAt: ["standard", "complete"] },
  { id: "s11", titleJa: "リスクと負債", titleEn: "Risks & debt", file: "doc/11-risks.md", depths: ["L3"], source: "mixed", generatedAt: ["standard", "complete"] },
  { id: "s12", titleJa: "用語集", titleEn: "Glossary", file: "doc/12-glossary.md", depths: ["L1", "L2"], source: "ai", generatedAt: ["overview", "standard", "complete"] },
  { id: "s13", titleJa: "未解決の問い", titleEn: "Open questions", file: "doc/13-open-questions.md", depths: ["L3"], source: "ai", generatedAt: ["standard", "complete"] },
  { id: "appendix", titleJa: "付録: 出典索引と生成メタ", titleEn: "Appendix: sources & generation meta", file: "doc/99-appendix.md", depths: ["L3"], source: "static", generatedAt: [] },
] as const satisfies readonly SectionTemplate[];

/** A node in the section tree (`doc.index.json`). */
export interface SectionNode {
  /** Section id. */
  id: SectionId;
  /** Title in the doc's primary language. */
  title: string;
  /** Docdir-relative file. */
  file: string;
  /** Ordered block ids. */
  blocks: BlockId[];
  /** Child sections in order. */
  children: SectionId[];
  /** Module described by this section (`s6/<slug>`). */
  module?: ModuleId;
  /** Generation state of the section. */
  state: "static_only" | "pending" | "generating" | "generated" | "partial";
  /** Sum of block reading times. */
  readingSec: number;
}

/** Glossary entry (§12). `yomi`/`romaji` power kana/romaji ⌘K lookup. */
export interface GlossaryEntry {
  /** Id. */
  id: GlossaryId;
  /** Term as used in the doc. */
  term: string;
  /** Reading in hiragana (ja docs). */
  yomi?: string;
  /** Hepburn romaji of `yomi`, lowercase, no spaces. */
  romaji?: string;
  /** English name. */
  en?: string;
  /** Definition (Markdown, 1–3 sentences). */
  definition: string;
  /** Blocks using the term (first-occurrence underline needs the first one). */
  usedIn: BlockId[];
  /** Related symbol. */
  symbol?: SymbolKey;
}

/** Reading path ("5 分コース" …): selection of existing blocks, zero extra tokens. */
export interface ReadingPath {
  /** Id, e.g. `5min`, `30min`, `reviewer`, `pm`, `sre`, or custom. */
  id: string;
  /** Title in the primary language. */
  title: string;
  /** Target audience. */
  audience: Audience;
  /** Ordered steps. */
  steps: {
    /** Section to read. */
    section: SectionId;
    /** Optional subset of blocks (default: blocks visible at the path's level). */
    blocks?: BlockId[];
  }[];
  /** Estimated total reading time. */
  readingSec: number;
}

/** `<docDir>/mitori.json` — the doc manifest. Deterministically serialized (sorted keys, 2-space). */
export interface DocManifest {
  /** Type tag for discovery (`git ls-files '*mitori.json'`). */
  kind: "mitori/doc-manifest";
  /** {@link FORMAT.docManifest}. */
  schemaVersion: 1;
  /** Stable doc identity. */
  docId: DocId;
  /** Document title (repo name by default). */
  title: string;
  /** Primary language; generation is eager in this language only. */
  primaryLang: DocLang;
  /** Snapshot the doc was last (re)generated from. */
  snapshot: {
    /** HEAD at generation. */
    commit: GitOid | null;
    /** Index Merkle root at generation. */
    indexDigest: Xxh3;
  };
  /** Generator stamp. */
  generator: {
    /** mitori version (semver). */
    mitoriVersion: string;
    /** Prompt versions used, keyed by prompt id. */
    prompts: Record<string, PromptVersion>;
    /** Extractor versions used, keyed by language. */
    extractors: Partial<Record<SourceLang, ExtractorVersion>>;
  };
  /** Models that produced current content. */
  models: ModelId[];
  /** Effort of the last full run. */
  effort: Effort;
  /** Coverage disclosure. */
  coverage: Coverage;
  /** Cumulative generation usage (API-equivalent). */
  usageTotals: UsageTotals;
  /** Last full generation time (only changes on generation, never on load/save). */
  generatedAt: Iso8601 | null;
}

/** `<docDir>/doc.index.json` — the deterministic sidecar. */
export interface DocIndex {
  /** Type tag. */
  kind: "mitori/doc-index";
  /** {@link FORMAT.docIndex}. */
  schemaVersion: 1;
  /** Section tree; roots are the {@link DOC_TEMPLATE} sections in order. */
  sections: SectionNode[];
  /** Block metadata keyed by id (serialized with sorted keys). */
  blocks: Record<BlockId, BlockMeta>;
  /** Claims keyed by id. */
  claims: Record<ClaimId, Claim>;
  /** Diagram IR keyed by id (layouts are cache, not persisted here). */
  diagrams: Record<DiagramId, DiagramIR>;
  /** Glossary (sorted by `yomi ?? term`). */
  glossary: GlossaryEntry[];
  /** Reading paths. */
  readingPaths: ReadingPath[];
  /** Module ↔ section mapping. */
  modules: {
    /** Module id. */
    id: ModuleId;
    /** Section describing it. */
    section: SectionId;
    /** Interface digest the page was generated against (early cutoff). */
    ifaceDigest: Xxh3;
  }[];
}

/** Doc change proposal (D12: doc updates after code changes are always proposals). */
export interface DocProposal {
  /** Id. */
  id: ProposalId;
  /** Target block (`null` for inserts). */
  block: BlockId | null;
  /** Section for inserts. */
  section: SectionId;
  /** Insert position: after this block (`null` = section start). */
  after?: BlockId | null;
  /** Operation. */
  op: "update" | "insert" | "delete";
  /** Block hash the proposal was computed against (rejects on mismatch → rebase). */
  baseHash: Xxh3 | null;
  /** Proposed Markdown (empty for delete). */
  md: string;
  /** Producer. */
  source: {
    /** Producer kind. */
    kind: "job" | "regen" | "sync" | "translate" | "simplify" | "answer_promote";
    /** Producer id (job id / run id). */
    id: string;
  };
  /** One-line reason shown on the suggestion card. */
  reason: string;
  /** State. */
  state: "pending" | "accepted" | "rejected" | "superseded";
  /** Created at. */
  createdAt: Iso8601;
}

/** One entry in a block's history timeline (also the undo source for doc edits). */
export interface BlockHistoryEntry {
  /** Block. */
  block: BlockId;
  /** Monotonic revision per block. */
  rev: number;
  /** Hash after this revision. */
  hash: Xxh3;
  /** Author. */
  by: MessageAuthor;
  /** When. */
  at: Iso8601;
  /** Review round, if part of one. */
  round?: number;
  /** Why it changed. */
  source: "generate" | "regen" | "human_edit" | "accept_proposal" | "accept_job" | "undo" | "import_external";
}

/** A resolved thread promoted to a decision record (`<docDir>/decisions/<id>.md`, committed). */
export interface Decision {
  /** Id. */
  id: DecisionId;
  /** Title. */
  title: string;
  /** Status. */
  status: "accepted" | "superseded";
  /** Supersedes another decision. */
  supersedes?: DecisionId;
  /** Origin thread (local id; kept for traceability only). */
  thread?: ThreadId;
  /** Blocks it explains. */
  blocks: BlockId[];
  /** Code it explains. */
  cites: Cite[];
  /** Docdir-relative file. */
  file: string;
  /** When decided. */
  decidedAt: Iso8601;
}

/** Visibility rule for one reader level (UX 07 §2.1 table, as data). */
export interface ReaderLevelRule {
  /** Depths rendered expanded. */
  expanded: readonly Depth[];
  /** Depths rendered collapsed (Deep Dive). */
  collapsed: readonly Depth[];
  /** Depths hidden behind a "詳しく (n)" chip. */
  hidden: readonly Depth[];
  /** Citation chip placement. */
  cites: "paragraph_end" | "inline" | "inline_with_lines";
  /** Glossary underline policy. */
  glossaryUnderline: "all_first" | "first_only" | "none";
  /** Why-box default. */
  whyBox: "expanded" | "collapsed";
  /** Show source line numbers in rendered Markdown. */
  lineNumbers: boolean;
}

/** Reader-level rules. Applied client-side (no server round trip on `-`/`=`). */
export const READER_LEVEL_RULES = {
  newcomer: { expanded: ["L0", "L1", "L2"], collapsed: [], hidden: ["L3"], cites: "paragraph_end", glossaryUnderline: "all_first", whyBox: "expanded", lineNumbers: false },
  standard: { expanded: ["L0", "L1", "L2"], collapsed: ["L3"], hidden: [], cites: "inline", glossaryUnderline: "first_only", whyBox: "collapsed", lineNumbers: false },
  expert: { expanded: ["L0", "L1", "L2", "L3"], collapsed: [], hidden: [], cites: "inline_with_lines", glossaryUnderline: "none", whyBox: "collapsed", lineNumbers: true },
} as const satisfies Record<ReaderLevel, ReaderLevelRule>;

/* ============================================================================
 * 8. Diagrams (IR → ELK in a Bun Worker → SVG)
 * ========================================================================== */

/** Diagram flavour. `sequence` uses a deterministic non-ELK layout. */
export type DiagramKind = "context" | "container" | "component" | "dependency" | "flow" | "sequence" | "er";

/** Reference from a diagram node to the thing it depicts (click-to-jump). */
export interface DiagramRef {
  /** Doc section. */
  section?: SectionId;
  /** Doc block. */
  block?: BlockId;
  /** Module. */
  module?: ModuleId;
  /** Symbol. */
  symbol?: SymbolKey;
  /** File or directory. */
  path?: RepoPath;
}

/** Diagram node. */
export interface DiagramNode {
  /** Node id, unique within the diagram (`[a-z0-9_-]+`). */
  id: string;
  /** Label (primary language). */
  label: string;
  /** Second line (tech, path, count). */
  sublabel?: string;
  /** Jump target. */
  ref?: DiagramRef;
  /** Group (compound node) id. */
  group?: string;
  /** Shape hint. */
  shape?: "box" | "store" | "actor" | "external" | "queue" | "note";
  /** Importance in [0,1] (size/weight hint). */
  weight?: number;
}

/** Diagram edge. */
export interface DiagramEdge {
  /** Edge id, unique within the diagram. */
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Semantic kind. */
  kind: "imports" | "calls" | "data" | "http" | "event" | "depends" | "message";
  /** Label. */
  label?: string;
  /** Message order for `sequence` diagrams (1-based). */
  seq?: number;
}

/** Diagram group (compound node / C4 boundary). */
export interface DiagramGroup {
  /** Group id. */
  id: string;
  /** Label. */
  label: string;
  /** Parent group. */
  parent?: string;
}

/** Diagram intermediate representation (LLM or analyzer output; persisted in `doc.index.json`). */
export interface DiagramIR {
  /** Id. */
  id: DiagramId;
  /** Kind. */
  kind: DiagramKind;
  /** Title. */
  title?: string;
  /** Nodes (≤ 300 for ELK layered within budget). */
  nodes: DiagramNode[];
  /** Edges. */
  edges: DiagramEdge[];
  /** Groups. */
  groups: DiagramGroup[];
  /** Preferred direction. */
  direction: "RIGHT" | "DOWN";
  /** Producer: static graph (labels may be LLM-provided) or LLM. */
  origin: "static" | "ai" | "human";
}

/** Positioned layout produced server-side (cached by IR hash; client renders SVG only). */
export interface DiagramLayout {
  /** Diagram id. */
  diagram: DiagramId;
  /** xxh3 of the canonical IR it was computed from. */
  irHash: Xxh3;
  /** Layout engine version, e.g. `elk@0.12.0/layered`. */
  engine: string;
  /** Canvas width in px. */
  width: number;
  /** Canvas height in px. */
  height: number;
  /** Node boxes. */
  nodes: {
    /** Node id. */
    id: string;
    /** Left. */
    x: number;
    /** Top. */
    y: number;
    /** Width. */
    w: number;
    /** Height. */
    h: number;
  }[];
  /** Edge polylines. */
  edges: {
    /** Edge id. */
    id: string;
    /** Points `[x, y]` including start and end. */
    points: [number, number][];
    /** Label anchor. */
    label?: [number, number];
  }[];
  /** Group boxes. */
  groups: {
    /** Group id. */
    id: string;
    /** Left. */
    x: number;
    /** Top. */
    y: number;
    /** Width. */
    w: number;
    /** Height. */
    h: number;
  }[];
}

/* ============================================================================
 * 9. Anchors (shared by claims and comments — one engine, ADR-0007)
 * ========================================================================== */

/** W3C Web Annotation TextQuoteSelector (prefix/suffix ≤ 32 chars each). */
export interface TextQuote {
  /** Text immediately before `exact`. */
  prefix: string;
  /** The selected text. */
  exact: string;
  /** Text immediately after `exact`. */
  suffix: string;
}

/** Anchor into the design doc. */
export interface DocAnchor {
  /** Block. */
  block: BlockId;
  /** Claim, when the selection maps to one. */
  claim?: ClaimId;
  /** Selected text inside the block's rendered text. */
  quote?: TextQuote;
  /** Character offset hint of `quote.exact` in the block's normalized text. */
  offset?: number;
  /** Block hash at anchoring time. */
  blockHash: Xxh3;
}

/** Anchor into code (same identity tuple as {@link Cite}). */
export interface CodeAnchor {
  /** File. */
  path: RepoPath;
  /** First line. */
  start: LineNo;
  /** Last line. */
  end: LineNo;
  /** Blob at anchoring time. */
  blob: GitOid;
  /** Smallest enclosing symbol. */
  symbol?: SymbolKey;
  /** xxh3 of normalized lines start..end. */
  snippet: Xxh3;
  /** Quote of the selected text (for fuzzy re-anchoring). */
  quote?: TextQuote;
}

/** Anchor onto a diagram node or edge. */
export interface DiagramAnchor {
  /** Diagram. */
  diagram: DiagramId;
  /** Node id. */
  node?: string;
  /** Edge id. */
  edge?: string;
}

/** Composite anchor; at least one member is present. `primary` says which one the user selected. */
export interface Anchor {
  /** Which member was the user's selection target. */
  primary: "doc" | "code" | "diagram";
  /** Doc member. */
  doc?: DocAnchor;
  /** Code member (for doc anchors, derived from the claim's first cite when available). */
  code?: CodeAnchor;
  /** Diagram member. */
  diagram?: DiagramAnchor;
}

/** Health of an anchor after the latest re-anchoring pass. */
export type AnchorHealth = "ok" | "moved" | "fuzzy" | "outdated";

/** Which re-anchoring step succeeded (cheapest first). */
export type ReanchorMethod = "identity" | "symbol" | "diff" | "quote" | "manual" | "none";

/** Result of re-anchoring one anchor member. Never deletes: failures become `outdated`. */
export interface ReanchorResult<T> {
  /** Resulting health. */
  health: AnchorHealth;
  /** Step that produced the result. */
  method: ReanchorMethod;
  /** New anchor (equal to `previous` when outdated). */
  anchor: T;
  /** Anchor before the pass (shown as the original snapshot for outdated anchors). */
  previous: T;
  /** Confidence in [0,1]. */
  confidence: number;
}

/* ============================================================================
 * 10. Review: threads, messages, rounds, state machine
 * ========================================================================== */

/** Intent chosen in the Composer (⌘1–4) or implied by the key (`e` question, `f` change, `c` note). */
export type ThreadIntent = "question" | "change" | "review" | "note" | "doc_edit";

/**
 * Thread lifecycle state. Anchor health and "stale because another change touched the range"
 * are orthogonal fields on {@link Thread}, not states (refinement of synthesis §4.2).
 */
export type ThreadState =
  | "draft"
  | "open"
  | "queued"
  | "running"
  | "answered"
  | "proposed"
  | "applied"
  | "rejected"
  | "failed"
  | "needs_input"
  | "resolved";

/** How a thread was resolved. */
export type Resolution = "applied" | "answered" | "wontfix" | "duplicate" | "promoted" | "obsolete";

/** Message author. Agents are `agent:<engine>/<model>` or `agent:<label>` (Pull). */
export type MessageAuthor = "human" | "system" | `agent:${string}`;

/** Transition trigger names. */
export type ThreadTrigger =
  | "submit"
  | "dispatch"
  | "start"
  | "answer"
  | "propose"
  | "ask_human"
  | "fail"
  | "cancel"
  | "accept"
  | "reject"
  | "revise"
  | "retry"
  | "reply"
  | "agent_done"
  | "undo"
  | "resolve"
  | "reopen";

/** Who may fire a transition. Agents can never resolve (resolution is a human right). */
export type TransitionActor = "human" | "agent" | "system";

/** One allowed transition. */
export interface ThreadTransition {
  /** Source state. */
  from: ThreadState;
  /** Target state. */
  to: ThreadState;
  /** Trigger. */
  on: ThreadTrigger;
  /** Allowed actors. */
  by: readonly TransitionActor[];
}

/** The thread state machine as data. Any transition not listed fails with `E_STATE_TRANSITION`. */
export const THREAD_TRANSITIONS = [
  { from: "draft", to: "open", on: "submit", by: ["human"] },
  { from: "open", to: "queued", on: "dispatch", by: ["human", "system"] },
  { from: "queued", to: "running", on: "start", by: ["system", "agent"] },
  { from: "queued", to: "open", on: "cancel", by: ["human", "system"] },
  { from: "queued", to: "failed", on: "fail", by: ["system"] },
  { from: "running", to: "answered", on: "answer", by: ["system", "agent"] },
  { from: "running", to: "proposed", on: "propose", by: ["system"] },
  { from: "running", to: "needs_input", on: "ask_human", by: ["system", "agent"] },
  { from: "running", to: "applied", on: "agent_done", by: ["agent"] },
  { from: "running", to: "failed", on: "fail", by: ["system"] },
  { from: "running", to: "open", on: "cancel", by: ["human", "system"] },
  { from: "proposed", to: "applied", on: "accept", by: ["human"] },
  { from: "proposed", to: "rejected", on: "reject", by: ["human"] },
  { from: "proposed", to: "queued", on: "revise", by: ["human"] },
  { from: "answered", to: "queued", on: "revise", by: ["human"] },
  { from: "answered", to: "open", on: "reply", by: ["human"] },
  { from: "needs_input", to: "queued", on: "reply", by: ["human"] },
  { from: "needs_input", to: "open", on: "cancel", by: ["human"] },
  { from: "rejected", to: "queued", on: "revise", by: ["human"] },
  { from: "rejected", to: "open", on: "reply", by: ["human"] },
  { from: "failed", to: "queued", on: "retry", by: ["human"] },
  { from: "failed", to: "open", on: "reply", by: ["human"] },
  { from: "applied", to: "open", on: "undo", by: ["human"] },
  { from: "open", to: "resolved", on: "resolve", by: ["human"] },
  { from: "answered", to: "resolved", on: "resolve", by: ["human"] },
  { from: "applied", to: "resolved", on: "resolve", by: ["human", "system"] },
  { from: "rejected", to: "resolved", on: "resolve", by: ["human"] },
  { from: "failed", to: "resolved", on: "resolve", by: ["human"] },
  { from: "needs_input", to: "resolved", on: "resolve", by: ["human"] },
  { from: "resolved", to: "open", on: "reopen", by: ["human"] },
] as const satisfies readonly ThreadTransition[];

/** A message in a thread. Human text is stored and forwarded verbatim (never rewritten). */
export interface Message {
  /** Id. */
  id: MessageId;
  /** Thread. */
  thread: ThreadId;
  /** Author. */
  by: MessageAuthor;
  /** Message kind. */
  kind: "comment" | "answer" | "done" | "question" | "proposal" | "system";
  /** Markdown body (rendered with raw HTML disabled). */
  body: string;
  /** Round in which it was written. */
  round: number;
  /** Job that produced it (agent messages). */
  job?: JobId;
  /** Citations extracted from an answer, verified for existence. */
  cites?: {
    /** File. */
    path: RepoPath;
    /** Line range start. */
    start: LineNo;
    /** Line range end. */
    end: LineNo;
    /** False when the cited range does not exist (UI warns). */
    exists: boolean;
  }[];
  /** Created at. */
  createdAt: Iso8601;
  /** Last edit (human messages only, before dispatch). */
  editedAt?: Iso8601;
}

/** A review thread anchored on the doc, the code or a diagram. */
export interface Thread {
  /** Id. */
  id: ThreadId;
  /** Anchor. */
  anchor: Anchor;
  /** Anchor health after the last re-anchoring pass. */
  anchorHealth: AnchorHealth;
  /** True when an accepted change from another thread touched this anchor (re-check suggested). */
  stale: boolean;
  /** Intent. */
  intent: ThreadIntent;
  /** Lifecycle state. */
  state: ThreadState;
  /** Set when `state === "resolved"`. */
  resolution?: Resolution;
  /** Current round number (1-based). */
  round: number;
  /** Optimistic concurrency counter; every mutation increments it. */
  version: number;
  /** Short title (first line of the first message, ≤ 60 chars). */
  title: string;
  /** Jobs spawned for this thread, oldest first. */
  jobs: JobId[];
  /** Engine session id for cheap follow-ups (`--resume`). */
  sessionId?: string;
  /** Batch round key when dispatched via Finish (Shift+F). */
  batchRound?: number;
  /** Created at. */
  createdAt: Iso8601;
  /** Updated at. */
  updatedAt: Iso8601;
}

/** A review round (batch Finish). Pull rounds release `mitori review`; push rounds create a batch job. */
export interface Round {
  /** Round number (1-based, per workspace). */
  n: number;
  /** Dispatch plane. */
  mode: "push" | "pull";
  /** State. */
  state: "collecting" | "dispatched" | "complete";
  /** Threads included. */
  threads: ThreadId[];
  /** True when finished with zero open threads (approval semantics of the Pull contract). */
  approved: boolean;
  /** Started at. */
  startedAt: Iso8601;
  /** Finished at. */
  finishedAt?: Iso8601;
}

/* ============================================================================
 * 11. Jobs and normalized agent events
 * ========================================================================== */

/**
 * Job kinds (owned by `@mitori/loop`). Doc-level LLM operations — section regeneration,
 * "やさしく" simplify, translation, post-change doc sync — are {@link GenTask}s owned by
 * `@mitori/gen`, not jobs. A fix job's doc update arrives inside its own output (`docUpdate`).
 */
export type JobKind =
  | "explain"
  | "review"
  | "fix"
  | "pull_round"
  | "external_patch";

/** Job lifecycle. */
export type JobState =
  | "queued"
  | "waiting_lock"
  | "preparing"
  | "running"
  | "gating"
  | "repairing"
  | "ready"
  | "accepting"
  | "accepted"
  | "partially_accepted"
  | "rejected"
  | "done"
  | "failed"
  | "cancelled"
  | "reverted";

/** Job state machine as data (`from` → allowed `to`). */
export const JOB_TRANSITIONS = {
  queued: ["waiting_lock", "preparing", "cancelled", "failed"],
  waiting_lock: ["preparing", "cancelled", "failed"],
  preparing: ["running", "failed", "cancelled"],
  running: ["gating", "ready", "done", "failed", "cancelled"],
  gating: ["ready", "repairing", "failed", "cancelled"],
  repairing: ["gating", "failed", "cancelled"],
  ready: ["accepting", "rejected", "cancelled", "queued"],
  accepting: ["accepted", "partially_accepted", "failed"],
  accepted: ["reverted"],
  partially_accepted: ["accepting", "reverted"],
  rejected: [],
  done: [],
  failed: ["queued"],
  cancelled: [],
  reverted: [],
} as const satisfies Record<JobState, readonly JobState[]>;

/** Router reason codes (deterministic; logged and shown in the job card). */
export type RouteReason =
  | "intent_question"
  | "intent_review"
  | "small_change"
  | "large_change"
  | "needs_more_context"
  | "patch_apply_failed"
  | "gates_failed_twice"
  | "agent_failed"
  | "user_override";

/** Output of the deterministic router. */
export interface RouteDecision {
  /** Mode. */
  mode: ExecMode;
  /** Why. */
  reason: RouteReason;
  /** Model (full id). */
  model: ModelId;
  /** Reasoning effort. */
  effort: ReasoningEffort;
  /** Tools granted. */
  tools: ToolProfile;
  /** Output contract requested. */
  contract: OutputContractId;
  /** Total anchored lines considered. */
  anchoredLines: number;
  /** Distinct files in scope. */
  files: number;
  /** True when this is an escalation that needs explicit human confirmation (Opus high, proposal-only). */
  requiresConfirm: boolean;
}

/** Fine-grained progress phase (rendered as stages; no fake percentage bars). */
export type JobPhase =
  | "queued"
  | "prepare"
  | "snapshot"
  | "bundle"
  | "spawn"
  | "read"
  | "think"
  | "edit"
  | "apply"
  | "scope"
  | "gate"
  | "repair"
  | "ready"
  | "done";

/** Permission denial reported by the engine. */
export interface Denial {
  /** Tool name (`Edit`, `Read`, …). */
  tool: string;
  /** Target path, when applicable. */
  target?: string;
  /** Reason text from the engine (truncated). */
  reason: string;
}

/** Why an engine run stopped. */
export type StopReason = "end" | "budget" | "refusal" | "max_turns" | "cancelled" | "error";

/**
 * Normalized agent/job event (engine-agnostic). Produced by engine adapters and job runners,
 * persisted as NDJSON under `~/.mitori/repos/<k>/jobs/<id>/events.ndjson`, streamed via SSE.
 */
export type JobEvent =
  | {
      /** Discriminator: phase change. */
      t: "phase";
      /** New phase. */
      phase: JobPhase;
      /** File being read/edited, when known (from tool_use input). */
      target?: RepoPath;
      /** Short detail line (e.g. `Read internal/auth/session.go`). */
      detail?: string;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: streamed answer text (server throttles to ≤ 10 Hz). */
      t: "text";
      /** Text delta. */
      delta: string;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: tool activity (agent mode). */
      t: "tool";
      /** Tool name. */
      name: string;
      /** Target path. */
      target?: RepoPath;
      /** Outcome. */
      status: "start" | "ok" | "denied" | "error";
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: usage. Only `final: true` values (from the `result` event) are ledgered. */
      t: "usage";
      /** Usage figures. */
      usage: Usage;
      /** True when taken from the terminal result (authoritative). */
      final: boolean;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: subscription window observation (`rate_limit_event`). */
      t: "window";
      /** Window snapshot. */
      window: SubscriptionWindow;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: terminal engine result. */
      t: "result";
      /** Stop reason. */
      stop: StopReason;
      /** Parsed structured output (validated against the requested contract by the caller). */
      structured?: unknown;
      /** Final text (answer mode). */
      text?: string;
      /** Engine session id (for `--resume`). */
      sessionId?: string;
      /** Permission denials. */
      denials: Denial[];
      /** Wall time of the engine run. */
      durationMs: number;
      /** Time to first token, when reported. */
      ttftMs?: number;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: gate result. */
      t: "gate";
      /** Result. */
      gate: GateResult;
      /** Event time. */
      at: UnixMs;
    }
  | {
      /** Discriminator: error (job may continue if retryable and a repair is scheduled). */
      t: "error";
      /** Error code. */
      code: ErrorCode;
      /** Message (English, for logs/UI detail). */
      message: string;
      /** Whether a retry may succeed. */
      retryable: boolean;
      /** Event time. */
      at: UnixMs;
    };

/** A quality gate detected from the repo (needs trust before it may run). */
export interface GateSpec {
  /** Id, e.g. `fmt:gofmt`. */
  id: GateId;
  /** Category. */
  kind: "format" | "lint" | "typecheck" | "test" | "build" | "custom";
  /** argv (no shell). */
  argv: string[];
  /** Working directory (repo-relative). */
  cwd: RepoPath;
  /** Files the gate is relevant for. */
  appliesTo: Glob[];
  /** Whether the gate may rewrite files (formatters run with autofix, others read-only). */
  autofix: boolean;
  /** Timeout. */
  timeoutMs: number;
  /** Where the spec came from. */
  source: "detected" | "repo_config" | "global_config";
  /** sha256 over the canonical spec + the config files it depends on (trust key). */
  trustHash: Sha256;
}

/** Outcome of one gate run. */
export interface GateResult {
  /** Gate. */
  gate: GateId;
  /** Status. */
  status: "pass" | "fail" | "error" | "timeout" | "skipped" | "untrusted";
  /** Duration. */
  ms: number;
  /** Failure excerpt for repair prompts (≤ 1k tokens, secrets redacted). */
  excerpt?: string;
  /** True when an autofix gate changed files. */
  autofixed?: boolean;
}

/** Failure summary of a job (one line in the UI + actions). */
export interface JobFailure {
  /** Error code. */
  code: ErrorCode;
  /** One-line message. */
  message: string;
  /** Last stderr lines (≤ 3, secrets redacted). */
  stderrTail?: string[];
  /** Suggested next actions. */
  actions: ("retry" | "copy_prompt" | "other_engine" | "escalate" | "narrow_scope")[];
}

/** A job: one agent execution for one or more threads, or a doc operation. */
export interface Job {
  /** Id. */
  id: JobId;
  /** Workspace. */
  ws: WorkspaceKey;
  /** Kind. */
  kind: JobKind;
  /** Threads served (batch jobs serve several). */
  threads: ThreadId[];
  /** Engine. */
  engine: EngineId;
  /** Router decision. */
  route: RouteDecision;
  /** State. */
  state: JobState;
  /** Attempt number (repairs increment). */
  attempt: number;
  /** Job this escalated from. */
  escalatedFrom?: JobId;
  /** Estimate shown before running. */
  estimate: Estimate;
  /** Actual usage (from final result events; summed over attempts). */
  usage?: Usage;
  /** Engine session id. */
  sessionId?: string;
  /** Absolute worktree path while it exists. */
  worktree?: string;
  /** Base snapshot ref (`refs/mitori/j/<id>/base`). */
  baseRef?: string;
  /** Result ref (`refs/mitori/j/<id>/head`). */
  headRef?: string;
  /** Allowed write set (exact paths; globs not allowed). */
  writeScope: RepoPath[];
  /** Gate results of the last attempt. */
  gates: GateResult[];
  /** Diff summary when ready. */
  diffStat?: {
    /** Files changed. */
    files: number;
    /** Added lines. */
    additions: number;
    /** Deleted lines. */
    deletions: number;
  };
  /** Doc proposals produced by this job. */
  proposals: ProposalId[];
  /** Checkpoint created at accept. */
  checkpoint?: CheckpointId;
  /** Failure info. */
  failure?: JobFailure;
  /** Prompt version used. */
  promptVer: PromptVersion;
  /** Created at. */
  createdAt: Iso8601;
  /** Started at. */
  startedAt?: Iso8601;
  /** Finished at. */
  finishedAt?: Iso8601;
}

/* ============================================================================
 * 12. Output contracts (engine → mitori). Validated server-side; never trusted.
 * ========================================================================== */

/** One line-range edit (search/replace is forbidden — slower and costlier, research 06 §10). */
export interface PatchEdit {
  /** Target file (must be in the job's write scope). */
  path: RepoPath;
  /** First line to replace (1-based). */
  start: LineNo;
  /** Last line to replace (inclusive). Omitted or `< start` ⇒ insert before `start`. */
  end?: LineNo;
  /** Replacement text (may be empty to delete). */
  newText: string;
  /** Optional xxh3 of the original range; mismatch ⇒ reject + re-anchor. */
  expect?: Xxh3;
}

/** `patch/1` output. */
export interface PatchOutput {
  /** ≤ 200 chars summary of what/why. */
  summary: string;
  /** ≤ 40 edits. */
  edits: PatchEdit[];
  /** New Markdown for the anchored doc block, or null if the doc needs no change. */
  docUpdate: string | null;
  /** Non-empty ⇒ router escalates to agent mode with these hints. */
  needsMoreContext?: string[];
}

/** `agent/1` output (agent mode edits files itself inside the worktree). */
export interface AgentOutput {
  /** Summary. */
  summary: string;
  /** Files the agent believes it changed (verified against `git diff --name-only`). */
  filesChanged: RepoPath[];
  /** New Markdown for the anchored doc block, or null. */
  docUpdate: string | null;
  /** Free-form notes for the reviewer. */
  notes?: string;
}

/** `answer/1` output (answer mode). */
export interface AnswerOutput {
  /** Markdown answer in the user's language. */
  markdown: string;
  /** Citations (existence verified deterministically). */
  cites: {
    /** File. */
    path: RepoPath;
    /** Start line. */
    start: LineNo;
    /** End line. */
    end: LineNo;
  }[];
}

/** `findings/1` output (AI Review intent). Each finding can become a thread candidate. */
export interface FindingsOutput {
  /** Findings, most severe first. */
  findings: {
    /** Title. */
    title: string;
    /** Markdown body. */
    body: string;
    /** Severity. */
    severity: "info" | "minor" | "major" | "critical";
    /** Citations. */
    cites: {
      /** File. */
      path: RepoPath;
      /** Start line. */
      start: LineNo;
      /** End line. */
      end: LineNo;
    }[];
    /** Suggested follow-up intent. */
    suggest: ThreadIntent;
  }[];
}

/** `docpatch/1` output (doc sync, simplify, translate, section regen). Id-referenced only. */
export interface DocPatchOutput {
  /** Block operations referencing existing ids or `new:<n>` placeholders. */
  blocks: {
    /** Existing block id or `new:<n>`. */
    id: BlockId | `new:${number}`;
    /** Operation. */
    op: "update" | "insert" | "delete" | "keep";
    /** Markdown (update/insert). */
    md?: string;
    /** Insert after this block id. */
    after?: BlockId | `new:${number}`;
  }[];
}

/* ============================================================================
 * 13. Diffs & checkpoints
 * ========================================================================== */

/** One file in a job diff. */
export interface FileDiff {
  /** Path after the change. */
  path: RepoPath;
  /** Path before (renames). */
  oldPath?: RepoPath;
  /** Status. */
  status: "modified" | "added" | "deleted" | "renamed";
  /** Binary files carry no hunks. */
  binary: boolean;
  /** Hunks. */
  hunks: Hunk[];
  /** Added lines. */
  additions: number;
  /** Deleted lines. */
  deletions: number;
}

/** A unified-diff hunk. Accept/reject granularity in the Review screen. */
export interface Hunk {
  /** `<path>:<oldStart>`. */
  id: HunkId;
  /** Old start line. */
  oldStart: LineNo;
  /** Old line count. */
  oldLines: number;
  /** New start line. */
  newStart: LineNo;
  /** New line count. */
  newLines: number;
  /** Lines prefixed with `' '`, `'+'` or `'-'` (unified format, no trailing newline). */
  lines: string[];
}

/** Undo point created at accept (D4: working tree uncommitted + checkpoint ref). */
export interface Checkpoint {
  /** Id. */
  id: CheckpointId;
  /** Job accepted. */
  job: JobId;
  /** Ref holding the pre-accept snapshot commit: `refs/mitori/ck/<id>`. */
  ref: string;
  /** Snapshot commit of the working tree before applying. */
  before: GitOid;
  /** Snapshot commit right after applying (undo refuses if files diverged since, unless forced). */
  after: GitOid;
  /** Files touched. */
  files: RepoPath[];
  /** Commit created when auto-commit is enabled. */
  commit?: GitOid;
  /** Created at. */
  createdAt: Iso8601;
  /** Set once undone. */
  undoneAt?: Iso8601;
}

/** Git ref namespace used by mitori (never `refs/heads/*`, never the user's index). */
export const GIT_REFS = {
  /** Job base snapshot. */
  jobBase: (job: JobId): string => `refs/mitori/j/${job}/base`,
  /** Job result. */
  jobHead: (job: JobId): string => `refs/mitori/j/${job}/head`,
  /** Accept checkpoint. */
  checkpoint: (ck: CheckpointId): string => `refs/mitori/ck/${ck}`,
  /** Integration head for queued accepts. */
  integration: "refs/mitori/integration",
} as const;

/* ============================================================================
 * 14. Generation runs (S5–S9)
 * ========================================================================== */

/** Generation stages (S0–S4 are static scan stages, see {@link ScanStage}). */
export type GenStage = "S5" | "S6" | "S6o" | "S7" | "S8" | "S9" | "translate" | "simplify";

/** Generation run lifecycle. */
export type GenRunState = "estimating" | "awaiting_confirm" | "running" | "paused" | "done" | "failed" | "cancelled";

/** Why a run is paused. */
export type PauseReason = "user" | "yield_5h" | "rate_limit" | "billing_changed";

/** Target of a generation task. */
export interface GenTarget {
  /** Target kind. */
  kind: "module" | "parent" | "overview" | "section" | "block" | "verify";
  /** Module id / section id / block id. */
  id: string;
}

/** Generation task lifecycle. */
export type GenTaskState =
  | "pending"
  | "ready"
  | "running"
  | "validating"
  | "retrying"
  | "done"
  | "cached"
  | "skipped"
  | "failed";

/** One unit of LLM work in a run. */
export interface GenTask {
  /** Id. */
  id: GenTaskId;
  /** Run. */
  run: GenRunId;
  /** Stage. */
  stage: GenStage;
  /** Target. */
  target: GenTarget;
  /** Scheduling priority (higher first; user click on a section boosts it). */
  priority: number;
  /** State. */
  state: GenTaskState;
  /** Attempts (NDJSON invalid lines get exactly one retry). */
  attempt: number;
  /** Cache key: xxh3(input digest × prompt ver × model × extractor vers). */
  cacheKey: Xxh3;
  /** Model. */
  model: ModelId;
  /** Estimated usage. */
  estimate: {
    /** Input tokens (all classes). */
    in: number;
    /** Output tokens. */
    out: number;
  };
  /** Actual usage. */
  usage?: Usage;
  /** Blocks written. */
  blocks: BlockId[];
  /** Failure. */
  error?: MitoriErrorData;
}

/** A generation run (initial generation, effort upgrade, or scoped regeneration). */
export interface GenRun {
  /** Id. */
  id: GenRunId;
  /** Workspace. */
  ws: WorkspaceKey;
  /** Effort. */
  effort: Effort;
  /** What started the run: explicit generation, an incremental (S9) suggestion the user accepted, or an on-demand block op. */
  trigger: "user" | "incremental" | "ondemand";
  /** Engine. */
  engine: EngineId;
  /** Optional scope (sections/modules); empty = whole doc for the effort. */
  scope: SectionId[];
  /** State. */
  state: GenRunState;
  /** Pause info. */
  paused?: {
    /** Reason. */
    reason: PauseReason;
    /** Auto-resume time (5h window reset). */
    until?: Iso8601;
  };
  /** Concurrency in effect. */
  concurrency: number;
  /** Estimate confirmed by the user. */
  estimate: GenEstimate;
  /** Progress counters. */
  progress: {
    /** Total tasks. */
    total: number;
    /** Finished (done/cached/skipped). */
    done: number;
    /** Failed. */
    failed: number;
    /** Blocks written so far. */
    blocks: number;
  };
  /** Actual usage so far. */
  usage: UsageTotals;
  /** Started at. */
  startedAt?: Iso8601;
  /** Finished at. */
  finishedAt?: Iso8601;
}

/* ============================================================================
 * 15. Usage, subscription windows, estimates
 * ========================================================================== */

/** Token usage of one engine call (or a sum). `apiUsd` is computed by mitori from {@link PRICING}. */
export interface Usage {
  /** Uncached input tokens. */
  in: number;
  /** Cache write tokens (all TTLs). */
  cacheWrite: number;
  /** Subset of `cacheWrite` written with 1h TTL (2× price). */
  cacheWrite1h: number;
  /** Cache read tokens. */
  cacheRead: number;
  /** Output tokens (including thinking). */
  out: number;
  /** Thinking tokens (subset of `out`), when reported. */
  thinking?: number;
  /** API-equivalent list price in USD, computed by mitori (primary cost unit, research addendum A1). */
  apiUsd: number;
  /** Cost reported by the engine (claude-cli `total_cost_usd` delta), for cross-checking only. */
  reportedUsd?: number;
  /** Pricing table version used for `apiUsd`. */
  pricingVer: string;
  /** True when produced via Message Batches (×0.5). */
  batch?: boolean;
}

/** Aggregate of many usages. */
export interface UsageTotals {
  /** Calls summed. */
  calls: number;
  /** Uncached input. */
  in: number;
  /** Cache writes. */
  cacheWrite: number;
  /** Cache reads. */
  cacheRead: number;
  /** Output. */
  out: number;
  /** API-equivalent USD. */
  apiUsd: number;
}

/** Subscription usage window observation (secondary display; only when observed). */
export interface SubscriptionWindow {
  /** 5-hour window. */
  fiveHour?: {
    /** Utilization in [0,1]. */
    utilization: number;
    /** Reset time. */
    resetsAt?: Iso8601;
  };
  /** 7-day window. */
  sevenDay?: {
    /** Utilization in [0,1]. */
    utilization: number;
    /** Reset time. */
    resetsAt?: Iso8601;
  };
  /** Overage / credit state (`overageStatus`, `isUsingOverage`). */
  overage?: {
    /** Raw status string. */
    status: string;
    /** True when usage is billed beyond the subscription window. */
    active: boolean;
  };
  /** Derived billing mode. */
  billing: BillingMode;
  /** Observation time. */
  observedAt: Iso8601;
  /** Source of the observation. */
  source: "claude-cli" | "codex-cli" | "statusline";
}

/** One immutable usage-ledger row (append-only, global `~/.mitori/state.sqlite`). */
export interface UsageRecord {
  /** Id. */
  id: UsageRecordId;
  /** Completion time. */
  at: Iso8601;
  /** Workspace (null for probes). */
  ws: WorkspaceKey | null;
  /** What incurred it. */
  scope: {
    /** Scope kind. */
    kind: "job" | "gen_task" | "probe" | "contract_test";
    /** Id of the job/task. */
    id: string;
  };
  /** Engine. */
  engine: EngineId;
  /** Model. */
  model: ModelId;
  /** Auth used (verified per run). */
  auth: AuthKind;
  /** Usage. */
  usage: Usage;
  /** Estimate given beforehand (calibration input). */
  estimate?: {
    /** Estimated input tokens (all classes). */
    in: number;
    /** Estimated output tokens. */
    out: number;
  };
  /** Wall time. */
  durationMs: number;
  /** Time to first token. */
  ttftMs?: number;
  /** Window after the call, when observed. */
  window?: SubscriptionWindow;
  /** Outcome. */
  outcome: "ok" | "error" | "cancelled" | "budget";
}

/** Why an estimate requires an explicit confirmation. */
export type ConfirmReason = "over_token_threshold" | "whole_repo_scope" | "generation_run" | "escalation" | "billing_overage" | "api_key_billing";

/** Line item of an estimate (doubles as a removable context chip in the Composer). */
export interface EstimateItem {
  /** Stable key (chip id). */
  key: string;
  /** Category. */
  kind: "fixed" | "instructions" | "ask" | "thread" | "doc" | "code" | "related" | "rules" | "repo_pack" | "module" | "output";
  /** Display label (e.g. `login.go:40-78`, `§3.2`). */
  label: string;
  /** Token estimate. */
  tokens: number;
  /** Expected to be served from cache. */
  cached: boolean;
  /** User may remove it (ASK, anchor body, WRITE, ACCEPT, OUT are never removable). */
  removable: boolean;
}

/** Pre-run estimate (shown before every LLM action; generation always requires one click). */
export interface Estimate {
  /** Id (referenced when confirming). */
  id: EstimateId;
  /** Engine. */
  engine: EngineId;
  /** Model. */
  model: ModelId;
  /** Uncached input tokens. */
  inTokens: number;
  /** Expected cache-read tokens. */
  cacheReadTokens: number;
  /** Expected cache-write tokens. */
  cacheWriteTokens: number;
  /** Expected output tokens. */
  outTokens: number;
  /** API-equivalent USD. */
  apiUsd: number;
  /** Expected wall seconds (median and p90). */
  seconds: {
    /** Median. */
    p50: number;
    /** 90th percentile. */
    p90: number;
  };
  /** Concurrency assumed. */
  concurrency: number;
  /** Expected 5h-window utilization increase in percentage points (null until calibrated). */
  windowDeltaPct: number | null;
  /** ± accuracy in percent from calibration (25 initially, target 12). */
  confidencePct: number;
  /** Number of calibration samples behind the coefficients. */
  calibrationN: number;
  /** Colour band. */
  band: TokenBand;
  /** Line items. */
  items: EstimateItem[];
  /** Confirmation required. */
  requiresConfirm: boolean;
  /** Why confirmation is required. */
  confirmReasons: ConfirmReason[];
  /** Validity end (estimates are tied to the index digest). */
  expiresAt: Iso8601;
}

/** Generation estimate: stage breakdown + alternatives (C=3 push vs C=1 session). */
export interface GenEstimate extends Estimate {
  /** Effort. */
  effort: Effort;
  /** Per-stage totals. */
  stages: {
    /** Stage. */
    stage: GenStage;
    /** Task count. */
    tasks: number;
    /** Input tokens (all classes). */
    inTokens: number;
    /** Output tokens. */
    outTokens: number;
    /** USD. */
    apiUsd: number;
    /** Seconds at the run concurrency. */
    seconds: number;
  }[];
  /** Seconds on the critical path that concurrency cannot shorten (overview stage). */
  criticalPathSeconds: number;
  /** Alternative executions. */
  alternatives: {
    /** Engine. */
    engine: EngineId;
    /** Concurrency. */
    concurrency: number;
    /** Wall seconds (p50). */
    seconds: number;
    /** USD (API key + Batch can be cheaper). */
    apiUsd: number;
  }[];
  /** Data-handling disclosure for the selected engine/plan (shown once per engine). */
  dataPolicyKey: string;
}

/* ============================================================================
 * 16. Settings, scopes, trust
 * ========================================================================== */

/** Where a setting may be written. Command-executing keys are global-only. */
export type SettingScope = "global" | "workspace" | "repo";

/** Per-engine settings (global-only). */
export interface EngineSettings {
  /** claude-cli. */
  "claude-cli": {
    /** Enabled. */
    enabled: boolean;
    /** Binary path or command name resolved on PATH (`claude`). */
    binary: string;
    /** Pass `--setting-sources user` (user hooks like Headroom/claude-mem). Project settings are never inherited. */
    inheritUserSettings: boolean;
    /** Extra env var names passed through the allowlist (never credentials). */
    envPassthrough: string[];
    /** Resident stream-json processes kept warm (0–2). */
    warmPool: 0 | 1 | 2;
    /** Keep session persistence (default false ⇒ `--no-session-persistence`). */
    persistSessions: boolean;
  };
  /** in-session pull. */
  session: {
    /** Enabled. */
    enabled: boolean;
  };
  /** anthropic-api (opt-in). */
  "anthropic-api": {
    /** Enabled. */
    enabled: boolean;
    /** Where the key comes from; the key itself is never stored by mitori. */
    keySource: "env" | "keychain";
    /** Env var name when `keySource === "env"`. */
    envVar: string;
    /** Use Message Batches for deep passes. */
    useBatch: boolean;
    /** Hard monthly cap in USD (required when enabled). */
    monthlyCapUsd: number;
  };
  /** codex-cli (after MVP). */
  "codex-cli": {
    /** Enabled. */
    enabled: boolean;
    /** Binary. */
    binary: string;
    /** Default model slug. */
    model: string;
  };
  /** generic agent_cmd. */
  generic: {
    /** Enabled. */
    enabled: boolean;
    /** argv; prompt is written to stdin. */
    argv: string[];
  };
}

/** Model routing defaults (full ids). */
export interface ModelDefaults {
  /** Explain / answer mode. */
  answer: ModelId;
  /** Patch mode. */
  patch: ModelId;
  /** Agent mode. */
  agent: ModelId;
  /** Module pages (S5) and parents (S6). */
  genModule: ModelId;
  /** Overview (S6o). */
  genOverview: ModelId;
  /** L3 judge and leaf notes. */
  judge: ModelId;
  /** Simplify / translate / doc sync. */
  rewrite: ModelId;
  /** Escalation (proposal-only). */
  escalate: ModelId;
}

/** Spend/size limits (global-only). */
export interface Limits {
  /** Estimates above this many tokens require confirmation (default 100k). */
  confirmAboveTokens: number;
  /** Per-job USD cap (API-equivalent). */
  jobMaxUsd: number;
  /** Per-generation-run USD cap. */
  genRunMaxUsd: number;
  /** Daily USD cap across workspaces. */
  dailyMaxUsd: number;
  /** Fraction of a budget at which mitori sends SIGINT (default 0.8). */
  stopAtBudgetFraction: number;
  /** Gate repair attempts before escalation (default 2). */
  repairMaxAttempts: number;
  /** Patch mode threshold: max anchored lines (default 120). */
  patchMaxLines: number;
  /** Patch mode threshold: max files (default 2). */
  patchMaxFiles: number;
  /** Default bundle budget (tokens, default 4000). */
  bundleDefaultTokens: number;
  /** Max bundle budget (tokens, default 12000). */
  bundleMaxTokens: number;
  /** Agent-mode input cap (tokens, default 30000). */
  agentMaxInputTokens: number;
}

/** Agent scheduler (global-only). */
export interface SchedulerSettings {
  /** Concurrent engine processes across all workspaces (default 3). */
  concurrency: number;
  /** Hard maximum (8). */
  maxConcurrency: number;
  /** Pause background generation when 5h utilization exceeds this (default 0.8). */
  yieldAtFiveHour: number;
  /** Launch one request first and fan out after its first streamed token (cache warm). */
  warmFirstFanout: boolean;
  /** 429 backoff base (ms). */
  backoffBaseMs: number;
  /** 429 backoff max (ms). */
  backoffMaxMs: number;
}

/** UI preferences. */
export interface UiSettings {
  /** UI language. */
  lang: UiLang;
  /** Theme. */
  theme: "system" | "light" | "dark";
  /** Default reader level. */
  readerLevel: ReaderLevel;
  /** Single-key shortcuts enabled (WCAG 2.1.4). */
  singleKeyShortcuts: boolean;
  /** Keymap overrides: action id → binding. */
  keymap: Record<string, string>;
  /** Show USD next to tokens. */
  showUsd: boolean;
  /** Desktop notification when long jobs finish (asked on first long job). */
  notifyOnDone: boolean | null;
  /** Open the browser on `mitori`. */
  openBrowser: boolean;
}

/** Review behaviour. */
export interface ReviewSettings {
  /** Auto-resolve a thread when its job is accepted. */
  autoResolveOnAccept: boolean;
  /** D12: auto-accept trivial doc updates (default false). */
  autoAcceptDocUpdates: boolean;
  /** D4 option: commit on accept with trailers (default false). */
  autoCommit: boolean;
  /** Add `Mitori-Thread`/`Mitori-Agent`/`Mitori-Cost` trailers to auto-commits. */
  commitTrailers: boolean;
}

/** Security switches (global-only). */
export interface SecuritySettings {
  /** Additional deny globs (defaults are always applied). */
  denyGlobs: Glob[];
  /** Secret scanning before generation, bundle building, export and share. */
  secretScan: boolean;
  /** Allow binding a non-loopback host (`--unsafe-network`); default false. */
  allowNonLoopback: boolean;
}

/** Privacy switches. */
export interface PrivacySettings {
  /** Per engine: when the data-handling disclosure was acknowledged. */
  dataPolicyAck: Partial<Record<EngineId, Iso8601>>;
  /** Log prompt/response contents (default false; ids/counts only). */
  logContent: boolean;
  /** Keep raw engine stdout for debugging (default false). */
  keepRawStreams: boolean;
}

/** `~/.mitori/config.json`. */
export interface GlobalSettings {
  /** {@link FORMAT.globalSettings}. */
  schemaVersion: 1;
  /** UI. */
  ui: UiSettings;
  /** Default engine for push tasks (explain/fix/review) and generation. */
  defaultEngine: EngineId;
  /** Default generation effort. */
  defaultEffort: Effort;
  /** Default doc language for new docs. */
  defaultDocLang: DocLang;
  /** Engines. */
  engines: EngineSettings;
  /** Models. */
  models: ModelDefaults;
  /** Reasoning effort per mode. */
  reasoning: Record<ExecMode | "gen", ReasoningEffort>;
  /** Limits. */
  limits: Limits;
  /** Scheduler. */
  scheduler: SchedulerSettings;
  /** Review. */
  review: ReviewSettings;
  /** Security. */
  security: SecuritySettings;
  /** Privacy. */
  privacy: PrivacySettings;
  /** Per-workspace overrides written from the UI (global file, never the repo). */
  workspaces: Partial<Record<WorkspaceKey, WorkspaceOverrides>>;
}

/** Per-workspace overrides stored in the GLOBAL config. */
export interface WorkspaceOverrides {
  /** Doc directory override. */
  docDir?: string;
  /** Engine override. */
  defaultEngine?: EngineId;
  /** Effort override. */
  defaultEffort?: Effort;
  /** Extra excludes. */
  exclude?: Glob[];
  /** Reader level. */
  readerLevel?: ReaderLevel;
}

/** Gate declaration in repo config (data only; executing it requires trust). */
export interface GateDeclaration {
  /** Id. */
  id: GateId;
  /** Kind. */
  kind: GateSpec["kind"];
  /** argv. */
  argv: string[];
  /** Applies to. */
  appliesTo: Glob[];
}

/** `<docDir>/config.json` — repo-scoped SAFE subset (committed). Unknown/unsafe keys are ignored with a notice. */
export interface RepoSettings {
  /** {@link FORMAT.repoSettings}. */
  schemaVersion: 1;
  /** Primary doc language. */
  docLang?: DocLang;
  /** Suggested effort (UI default; never auto-runs). */
  effortHint?: Effort;
  /** Additional include globs (override exclusion heuristics). */
  include?: Glob[];
  /** Additional exclude globs. */
  exclude?: Glob[];
  /** Additive deny globs (cannot remove defaults). */
  denyGlobs?: Glob[];
  /** Custom reading paths (block selections). */
  readingPaths?: ReadingPath[];
  /** Glossary seeds. */
  glossary?: Pick<GlossaryEntry, "term" | "yomi" | "en" | "definition">[];
  /** Module naming/merge overrides keyed by path prefix. */
  modules?: Record<RepoPath, {
    /** Display name. */
    name?: string;
    /** Slug. */
    slug?: string;
    /** Merge the prefix into the module containing this path. */
    mergeInto?: RepoPath;
  }>;
  /** Gate declarations (require trust). */
  gates?: GateDeclaration[];
  /** Rule sources sliced into bundles (`AGENTS.md`, `CLAUDE.md`, …). Data only. */
  rules?: RepoPath[];
}

/** Scope/trust metadata per top-level key (as data, enforced by the settings resolver). */
export const SETTING_SCOPES = {
  ui: { scopes: ["global"], trust: false },
  defaultEngine: { scopes: ["global", "workspace"], trust: false },
  defaultEffort: { scopes: ["global", "workspace"], trust: false },
  defaultDocLang: { scopes: ["global"], trust: false },
  engines: { scopes: ["global"], trust: false },
  models: { scopes: ["global"], trust: false },
  reasoning: { scopes: ["global"], trust: false },
  limits: { scopes: ["global"], trust: false },
  scheduler: { scopes: ["global"], trust: false },
  review: { scopes: ["global"], trust: false },
  security: { scopes: ["global"], trust: false },
  privacy: { scopes: ["global"], trust: false },
  docLang: { scopes: ["repo"], trust: false },
  effortHint: { scopes: ["repo"], trust: false },
  include: { scopes: ["repo", "workspace"], trust: false },
  exclude: { scopes: ["repo", "workspace"], trust: false },
  denyGlobs: { scopes: ["repo", "global"], trust: false },
  readingPaths: { scopes: ["repo"], trust: false },
  glossary: { scopes: ["repo"], trust: false },
  modules: { scopes: ["repo"], trust: false },
  gates: { scopes: ["repo", "global"], trust: true },
  rules: { scopes: ["repo"], trust: false },
} as const satisfies Record<string, { scopes: readonly SettingScope[]; trust: boolean }>;

/** Default deny globs: never written by agents, never packed into bundles/prompts, never exported. */
export const DEFAULT_DENY_GLOBS = [
  ".git/**",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.npmrc",
  "**/.netrc",
  ".dev.vars",
  ".github/workflows/**",
  ".claude/**",
  ".codex/**",
  ".agents/**",
  ".cursor/**",
  ".mitori/**",
] as const satisfies readonly Glob[];

/** A trust decision (global `state.sqlite`). Re-prompted when the content hash changes. */
export interface TrustRecord {
  /** Id. */
  id: TrustItemId;
  /** Workspace. */
  ws: WorkspaceKey;
  /** What is trusted. */
  item: "gates" | "repo_prompts" | "rules";
  /** sha256 of the canonical item content. */
  hash: Sha256;
  /** Decision. */
  decision: "trusted" | "denied";
  /** When decided. */
  at: Iso8601;
}

/** Effective, resolved settings for one workspace (defaults ← global ← workspace ← repo-safe). */
export interface EffectiveSettings {
  /** Global settings. */
  global: GlobalSettings;
  /** Repo settings after filtering (only safe keys). */
  repo: RepoSettings;
  /** Workspace overrides. */
  overrides: WorkspaceOverrides;
  /** Keys present in the repo file but ignored (shown as a notice). */
  ignoredRepoKeys: string[];
  /** Deny globs in effect (defaults ∪ global ∪ repo). */
  denyGlobs: Glob[];
  /** Gates in effect after trust filtering. */
  trustedGates: GateSpec[];
}

/* ============================================================================
 * 17. Errors
 * ========================================================================== */

/** Every error code. Prefix = domain. Add codes here only (exhaustive {@link ERROR_META}). */
export const ERROR_CODES = [
  "E_INTERNAL",
  "E_INVALID_INPUT",
  "E_NOT_FOUND",
  "E_CONFLICT",
  "E_PRECONDITION",
  "E_UNSUPPORTED",
  "E_CANCELLED",
  "E_TIMEOUT",
  "E_AUTH_REQUIRED",
  "E_FORBIDDEN",
  "E_CSRF",
  "E_BAD_HOST",
  "E_PAYLOAD_TOO_LARGE",
  "E_NOT_READY",
  "E_SHUTTING_DOWN",
  "E_VERSION_MISMATCH",
  "E_CFG_INVALID",
  "E_CFG_GLOBAL_ONLY",
  "E_TRUST_REQUIRED",
  "E_WS_NOT_FOUND",
  "E_WS_READONLY",
  "E_GIT_FAILED",
  "E_GIT_MERGE_CONFLICT",
  "E_GIT_WORKTREE",
  "E_GIT_DIVERGED",
  "E_GIT_CLONE_FAILED",
  "E_IDX_PARSE",
  "E_IDX_LANG_UNSUPPORTED",
  "E_IDX_WATCH",
  "E_DOC_PARSE",
  "E_DOC_ID_COLLISION",
  "E_DOC_BASE_MISMATCH",
  "E_DOC_LOCKED",
  "E_FORMAT_TOO_NEW",
  "E_FORMAT_INVALID",
  "E_GEN_OUTPUT_INVALID",
  "E_GEN_COVERAGE_LOW",
  "E_GEN_FINGERPRINT",
  "E_GEN_PREP_EXPIRED",
  "E_BUDGET_EXCEEDED",
  "E_AGENT_NOT_INSTALLED",
  "E_AGENT_AUTH",
  "E_AGENT_AUTH_SOURCE",
  "E_AGENT_RATE_LIMIT",
  "E_AGENT_TIMEOUT",
  "E_AGENT_PROTOCOL",
  "E_AGENT_REFUSAL",
  "E_AGENT_CAPABILITY",
  "E_AGENT_EXIT",
  "E_AGENT_YIELDED",
  "E_ANCHOR_LOST",
  "E_PATCH_APPLY",
  "E_PATCH_RANGE",
  "E_SCOPE_VIOLATION",
  "E_DENY_GLOB",
  "E_SECRET_DETECTED",
  "E_GATE_FAILED",
  "E_STATE_TRANSITION",
  "E_LOCK_TIMEOUT",
  "E_EXPORT_FAILED",
] as const;

/** Error code union. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Static metadata per error code. `i18n` key lives in both `ja` and `en` catalogs. */
export interface ErrorMeta {
  /** HTTP status used by the daemon API. */
  http: number;
  /** Default retryability. */
  retryable: boolean;
}

/** Exhaustive error metadata. */
export const ERROR_META = {
  E_INTERNAL: { http: 500, retryable: false },
  E_INVALID_INPUT: { http: 400, retryable: false },
  E_NOT_FOUND: { http: 404, retryable: false },
  E_CONFLICT: { http: 409, retryable: true },
  E_PRECONDITION: { http: 412, retryable: false },
  E_UNSUPPORTED: { http: 501, retryable: false },
  E_CANCELLED: { http: 499, retryable: false },
  E_TIMEOUT: { http: 504, retryable: true },
  E_AUTH_REQUIRED: { http: 401, retryable: false },
  E_FORBIDDEN: { http: 403, retryable: false },
  E_CSRF: { http: 403, retryable: false },
  E_BAD_HOST: { http: 421, retryable: false },
  E_PAYLOAD_TOO_LARGE: { http: 413, retryable: false },
  E_NOT_READY: { http: 503, retryable: true },
  E_SHUTTING_DOWN: { http: 503, retryable: false },
  E_VERSION_MISMATCH: { http: 409, retryable: false },
  E_CFG_INVALID: { http: 422, retryable: false },
  E_CFG_GLOBAL_ONLY: { http: 422, retryable: false },
  E_TRUST_REQUIRED: { http: 428, retryable: false },
  E_WS_NOT_FOUND: { http: 404, retryable: false },
  E_WS_READONLY: { http: 409, retryable: false },
  E_GIT_FAILED: { http: 500, retryable: false },
  E_GIT_MERGE_CONFLICT: { http: 409, retryable: false },
  E_GIT_WORKTREE: { http: 500, retryable: true },
  E_GIT_DIVERGED: { http: 409, retryable: false },
  E_GIT_CLONE_FAILED: { http: 502, retryable: true },
  E_IDX_PARSE: { http: 422, retryable: false },
  E_IDX_LANG_UNSUPPORTED: { http: 422, retryable: false },
  E_IDX_WATCH: { http: 500, retryable: true },
  E_DOC_PARSE: { http: 422, retryable: false },
  E_DOC_ID_COLLISION: { http: 409, retryable: false },
  E_DOC_BASE_MISMATCH: { http: 409, retryable: true },
  E_DOC_LOCKED: { http: 423, retryable: false },
  E_FORMAT_TOO_NEW: { http: 422, retryable: false },
  E_FORMAT_INVALID: { http: 422, retryable: false },
  E_GEN_OUTPUT_INVALID: { http: 502, retryable: true },
  E_GEN_COVERAGE_LOW: { http: 422, retryable: false },
  E_GEN_FINGERPRINT: { http: 409, retryable: false },
  E_GEN_PREP_EXPIRED: { http: 410, retryable: false },
  E_BUDGET_EXCEEDED: { http: 402, retryable: false },
  E_AGENT_NOT_INSTALLED: { http: 424, retryable: false },
  E_AGENT_AUTH: { http: 424, retryable: false },
  E_AGENT_AUTH_SOURCE: { http: 424, retryable: false },
  E_AGENT_RATE_LIMIT: { http: 429, retryable: true },
  E_AGENT_TIMEOUT: { http: 504, retryable: true },
  E_AGENT_PROTOCOL: { http: 502, retryable: true },
  E_AGENT_REFUSAL: { http: 422, retryable: false },
  E_AGENT_CAPABILITY: { http: 424, retryable: false },
  E_AGENT_EXIT: { http: 502, retryable: true },
  E_AGENT_YIELDED: { http: 503, retryable: true },
  E_ANCHOR_LOST: { http: 409, retryable: false },
  E_PATCH_APPLY: { http: 422, retryable: true },
  E_PATCH_RANGE: { http: 422, retryable: true },
  E_SCOPE_VIOLATION: { http: 422, retryable: false },
  E_DENY_GLOB: { http: 403, retryable: false },
  E_SECRET_DETECTED: { http: 422, retryable: false },
  E_GATE_FAILED: { http: 422, retryable: true },
  E_STATE_TRANSITION: { http: 409, retryable: false },
  E_LOCK_TIMEOUT: { http: 503, retryable: true },
  E_EXPORT_FAILED: { http: 500, retryable: false },
} as const satisfies Record<ErrorCode, ErrorMeta>;

/** Serializable error (HTTP bodies, job failures, NDJSON). */
export interface MitoriErrorData {
  /** Code. */
  code: ErrorCode;
  /** English developer message (UI uses `i18nKey(code)` + params). */
  message: string;
  /** Interpolation params for the i18n message (no secrets, no file contents). */
  params?: Record<string, string | number | boolean>;
  /** Retryability (defaults from {@link ERROR_META}). */
  retryable: boolean;
  /** Short actionable hint (English). */
  hint?: string;
  /** Wrapped cause (code/message only, stack never crosses the wire). */
  cause?: {
    /** Cause code if it was a mitori error. */
    code?: ErrorCode;
    /** Cause message. */
    message: string;
  };
  /** Request id when produced by the HTTP layer. */
  requestId?: RequestId;
}

/** i18n catalog key of an error code: `error.<CODE>`. */
export type ErrorI18nKey = `error.${ErrorCode}`;

/* ============================================================================
 * 18. Ports (implemented in `@mitori/platform`, injected by the server composition root)
 * ========================================================================== */

/** Structured logger writing NDJSON. Never log file contents/prompts unless `privacy.logContent`. */
export interface Logger {
  /** Debug. */
  debug(msg: string, fields?: LogFields): void;
  /** Info. */
  info(msg: string, fields?: LogFields): void;
  /** Warn. */
  warn(msg: string, fields?: LogFields): void;
  /** Error. */
  error(msg: string, fields?: LogFields): void;
  /** Child logger with a namespace (`idx`, `gen`, `agent.claude`, …) and bound fields. */
  child(ns: string, fields?: LogFields): Logger;
}

/** Allowed log fields (ids, counts, durations — not content). */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Clock (injectable for tests). */
export interface Clock {
  /** Epoch ms. */
  now(): UnixMs;
  /** ISO timestamp. */
  iso(): Iso8601;
}

/** Hashing primitives (Bun: `Bun.hash.xxHash3`, Node fallback: wasm xxhash). */
export interface Hasher {
  /** xxh3-64 hex of a string (UTF-8) or bytes. */
  xxh3(data: string | Uint8Array): Xxh3;
  /** sha256 hex. */
  sha256(data: string | Uint8Array): Sha256;
  /** git blob oid of content (`blob <len>\0` framing), matching the repo's hash algorithm. */
  gitBlob(data: Uint8Array, algo: "sha1" | "sha256"): GitOid;
}

/** Minimal synchronous SQLite port (bun:sqlite; node:sqlite fallback). WAL, `synchronous=NORMAL`. */
export interface SqlDb {
  /** Execute one or more statements without results. */
  exec(sql: string): void;
  /** Run a statement; returns change info. */
  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number };
  /** All rows. */
  all<T>(sql: string, params?: SqlParams): T[];
  /** First row or null. */
  get<T>(sql: string, params?: SqlParams): T | null;
  /** Run `fn` in an IMMEDIATE transaction (nested calls use savepoints). */
  tx<T>(fn: () => T): T;
  /** Close. */
  close(): void;
}

/** SQL parameters (named `$name` or positional). */
export type SqlParams = Record<string, SqlValue> | SqlValue[];

/** SQLite value. */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

/** One schema migration owned by a package (tables prefixed by package: `idx_`, `doc_`, `gen_`, `rev_`, `job_`, `use_`, `srv_`). */
export interface Migration {
  /** Owning package. */
  pkg: PackageName;
  /** Database the migration targets. */
  db: "workspace" | "state";
  /** Monotonic version within the package (1, 2, 3 …). */
  version: number;
  /** Forward-only SQL. */
  up: string;
}

/** Read-only git access shared by indexer/anchor/gen (implemented over `git` subprocesses). */
export interface GitReader {
  /** `git ls-files -s -z` (+ untracked via `--others --exclude-standard`). */
  lsFiles(): Promise<{ path: RepoPath; blob: GitOid; mode: string; tracked: boolean }[]>;
  /** Porcelain v2 status (paths changed vs HEAD/index). */
  status(): Promise<{ path: RepoPath; xy: string }[]>;
  /** Blob content. */
  catBlob(blob: GitOid): Promise<Uint8Array>;
  /** HEAD commit or null. */
  head(): Promise<GitOid | null>;
  /** Current branch or null. */
  branch(): Promise<string | null>;
  /** Changed paths between two commits/trees. */
  diffNames(from: GitOid, to: GitOid): Promise<RepoPath[]>;
  /** Hash algorithm of the repository. */
  objectFormat(): Promise<"sha1" | "sha256">;
}

/** Event sink used by domain packages; the server stamps `ws`/`rev`/`at` and fans out to SSE. */
export interface EventSink<E> {
  /** Emit a domain event. Must not throw; must not block. */
  emit(event: E): void;
}

/** Cancellation token shape (standard `AbortSignal` is used at runtime). */
export type Cancel = AbortSignal;

/* ============================================================================
 * 19. Package graph (machine-checked by `scripts/check-boundaries.ts`)
 * ========================================================================== */

/** Workspace package names. */
export type PackageName =
  | "@mitori/core"
  | "@mitori/platform"
  | "@mitori/indexer"
  | "@mitori/doc"
  | "@mitori/anchor"
  | "@mitori/agent"
  | "@mitori/gen"
  | "@mitori/loop"
  | "@mitori/server"
  | "@mitori/client"
  | "@mitori/cli"
  | "@mitori/web"
  | "@mitori/share";

/**
 * Allowed runtime dependencies (imports) per package. Type-only imports of `@mitori/core`
 * are always allowed. Anything else fails CI. gen ⟂ loop: they never import each other;
 * the server wires their interactions through events/commands.
 */
export const PACKAGE_DEPS = {
  "@mitori/core": [],
  "@mitori/platform": ["@mitori/core"],
  "@mitori/indexer": ["@mitori/core", "@mitori/platform"],
  "@mitori/doc": ["@mitori/core", "@mitori/platform"],
  "@mitori/anchor": ["@mitori/core"],
  "@mitori/agent": ["@mitori/core", "@mitori/platform"],
  "@mitori/gen": ["@mitori/core", "@mitori/platform", "@mitori/indexer", "@mitori/doc", "@mitori/anchor", "@mitori/agent"],
  "@mitori/loop": ["@mitori/core", "@mitori/platform", "@mitori/indexer", "@mitori/doc", "@mitori/anchor", "@mitori/agent"],
  "@mitori/server": ["@mitori/core", "@mitori/platform", "@mitori/indexer", "@mitori/doc", "@mitori/anchor", "@mitori/agent", "@mitori/gen", "@mitori/loop"],
  "@mitori/client": ["@mitori/core"],
  "@mitori/cli": ["@mitori/core", "@mitori/platform", "@mitori/client", "@mitori/server"],
  "@mitori/web": ["@mitori/core", "@mitori/client"],
  "@mitori/share": ["@mitori/core"],
} as const satisfies Record<PackageName, readonly PackageName[]>;
