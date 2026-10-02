/**
 * @file mitori — doc model + generation contract STUB.
 *
 * Covers TWO packages owned by the gen spec writer:
 *   - `@mitori/doc`  — Markdown ⇄ blocks (trailing ID comments), `doc.index.json`, history,
 *                      proposals, server-side rendering (markdown-it + Shiki), Diagram IR → ELK
 *                      layout, static (zero-token) sections, self-contained HTML export.
 *   - `@mitori/gen`  — generation orchestrator S5–S9: planning, prompts, NDJSON streaming with
 *                      per-line validation + one retry, verification L0–L3, estimates (C=3 and C=1),
 *                      session engine (`mitori gen --prep/--ingest`), incremental update (S9),
 *                      on-demand simplify/translate/regenerate.
 *
 * Status: STUB. The signatures are the seams other packages (server, loop, web) rely on.
 * `@mitori/gen` MUST NOT import `@mitori/loop` (and vice versa); the server wires them.
 */

import type {
  Audience,
  Block,
  BlockHistoryEntry,
  BlockId,
  BlockKind,
  BlockMeta,
  Cancel,
  Claim,
  ClaimChecks,
  ClaimId,
  ClaimKind,
  Cite,
  Clock,
  Coverage,
  Depth,
  DiagramIR,
  DiagramLayout,
  DocIndex,
  DocLang,
  DocManifest,
  DocProposal,
  Effort,
  EffectiveSettings,
  EngineId,
  EstimateId,
  EventSink,
  Fact,
  Freshness,
  GenEstimate,
  GenRun,
  GenRunId,
  GenStage,
  GenTask,
  GenTaskId,
  Hasher,
  LineNo,
  Logger,
  MessageAuthor,
  Migration,
  ModelId,
  ModuleId,
  ModuleInfo,
  PromptVersion,
  ProposalId,
  ReaderLevel,
  RepoPath,
  SectionId,
  SectionNode,
  SourceLang,
  SqlDb,
  WorkspaceInfo,
  Xxh3,
} from "./core.ts";
import type {
  ExportReq,
  ExportRes,
  GenEstimateReq,
  IngestReport,
  IngestReq,
  PrepInfo,
  SseEventPayload,
  CheckError,
} from "./api.ts";
import type { CodeSlice, IndexDelta, Indexer } from "./indexer.ts";
import type { AgentScheduler, AnchorEngine, PromptTemplate } from "./loop.ts";

/* ============================================================================
 * Part A — @mitori/doc
 * ========================================================================== */

/**
 * Where the trailing block-ID comment goes for each kind (FORMAT.blockIdSyntax = 1).
 * `trailing`: appended to the block's last line (`… <!-- b_xxxxxxxx -->`).
 * `own_line`: the comment occupies the line right after the block (fences, tables, diagrams),
 *             and binds to the nearest preceding block. Parser strips ID comments BEFORE markdown-it.
 * (Initial table; the doc spec may refine with byte-exact examples + golden tests.)
 */
export const BLOCK_ID_PLACEMENT = {
  heading: "trailing",
  prose: "trailing",
  list: "trailing",
  table: "own_line",
  diagram: "own_line",
  code: "own_line",
  facts: "own_line",
  learn: "trailing",
  recap: "trailing",
  pitfall: "trailing",
  deepdive: "trailing",
  why: "trailing",
  question: "trailing",
  faq: "trailing",
  placeholder: "trailing",
} as const satisfies Record<BlockKind, "trailing" | "own_line">;

/** Regex (source) of an ID comment. Exactly one space inside the delimiters. */
export const BLOCK_ID_COMMENT_RE = "<!-- (b_[0-9a-hjkmnp-tv-z]{8}) -->" as const;

/** Result of loading a doc directory. */
export interface DocLoadReport {
  /** Manifest found. */
  manifest: DocManifest | null;
  /** Blocks whose text hash differs from the index ⇒ marked `human-edited` (edited outside mitori). */
  externallyEdited: BlockId[];
  /** Blocks without an ID comment that received a fresh id (written back on next save). */
  assignedIds: BlockId[];
  /** Index entries whose block disappeared from Markdown (kept as tombstones for re-anchoring). */
  orphaned: BlockId[];
  /** Parse problems (structured). */
  problems: CheckError[];
}

/** A generated block coming from gen (already validated, cites already stamped). */
export interface GeneratedBlock {
  /** Existing id to update, or `null` to create. */
  id: BlockId | null;
  /** Section. */
  section: SectionId;
  /** Insert after (creates only). */
  after?: BlockId | null;
  /** Kind. */
  kind: BlockKind;
  /** Depth. */
  depth: Depth;
  /** Audience. */
  audience: Audience[];
  /** Language. */
  lang: DocLang;
  /** Markdown (no ID comment, no raw HTML). */
  md: string;
  /** Claims with stamped cites. */
  claims: Omit<Claim, "id" | "block">[];
  /** Diagram IR when kind is `diagram`. */
  diagram?: Omit<DiagramIR, "id">;
  /** Provenance. */
  gen: NonNullable<BlockMeta["gen"]>;
}

/** Outcome of applying generated blocks. Locked blocks become proposals, never overwritten. */
export interface ApplyResult {
  /** Created/updated blocks. */
  written: BlockId[];
  /** Deleted blocks. */
  deleted: BlockId[];
  /** Proposals created instead of overwriting locked (human-edited/verified) blocks. */
  proposals: ProposalId[];
}

/** Static (zero-token) doc content derived from the index (S0–S4). */
export interface StaticDocInput {
  /** Coverage. */
  coverage: Coverage;
  /** Facts grouped by section (§4 quickstart, §5 codebase map, §8 interfaces, §11 todos). */
  facts: Fact[];
  /** Modules (placeholders under §6 with exports/LOC/deps). */
  modules: ModuleInfo[];
  /** Static diagrams (floor plan from the module graph; labels may be refined by the LLM later). */
  diagrams: Omit<DiagramIR, "id">[];
}

/** The doc store (one per workspace). Single writer: only called inside the workspace write queue. */
export interface DocStore {
  /** Load docDir (Markdown canonical for text, index canonical for metadata) and reconcile. */
  load(): Promise<DocLoadReport>;
  /** Manifest. */
  manifest(): DocManifest | null;
  /** Whole sidecar (in memory). */
  index(): DocIndex;
  /** Sections (flat). */
  sections(): SectionNode[];
  /** Section with blocks. */
  section(id: SectionId): { node: SectionNode; blocks: Block[] } | null;
  /** Block. */
  block(id: BlockId): Block | null;
  /** Claims of a block. */
  claims(block: BlockId): Claim[];
  /** Blocks citing a file range (gutter backlinks, stale propagation). */
  blocksCiting(path: RepoPath, start?: LineNo, end?: LineNo): BlockId[];
  /** Build/refresh static sections + placeholders (deterministic ids: hash(module|section + slot)). */
  applyStatic(input: StaticDocInput): ApplyResult;
  /** Apply generated blocks (id-referenced upsert/delete; enforces id uniqueness). */
  applyGenerated(blocks: GeneratedBlock[], deletes: BlockId[]): ApplyResult;
  /** Human edit (3-way: `baseHash` must equal current hash else `E_DOC_BASE_MISMATCH`). Locks as human-edited. */
  editBlock(id: BlockId, baseHash: Xxh3, md: string, by: MessageAuthor): Block;
  /** Toggle human-verified (claims → verdict `human-verified`, preserved across regeneration). */
  setVerified(id: BlockId, verified: boolean, by: string): Block;
  /** Freshness updates from the anchor engine. */
  setFreshness(blocks: BlockId[], freshness: Freshness): void;
  /** Claim check updates from the verifier / re-anchoring. */
  setClaimChecks(updates: { id: ClaimId; checks: ClaimChecks; cites?: Cite[] }[]): void;
  /** Create a proposal. */
  propose(p: Omit<DocProposal, "id" | "state" | "createdAt">): DocProposal;
  /** Proposals. */
  proposals(filter?: { state?: DocProposal["state"]; block?: BlockId }): DocProposal[];
  /** Accept (optionally with edited text) ⇒ writes the block, history `accept_proposal`. */
  acceptProposal(id: ProposalId, md?: string): Block;
  /** Reject. */
  rejectProposal(id: ProposalId): void;
  /** Block history (timeline + undo source). */
  history(block: BlockId): BlockHistoryEntry[];
  /** Persist changed files atomically (debounced ≤ 500 ms by the caller); deterministic serialization. */
  flush(): Promise<string[]>;
}

/** Factory. */
export declare function createDocStore(deps: {
  /** Workspace. */
  ws: WorkspaceInfo;
  /** Workspace DB (`doc_*` tables: render cache, history, proposals, translations). */
  db: SqlDb;
  /** Hasher. */
  hasher: Hasher;
  /** Logger. */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Events (`doc.*`). */
  events: EventSink<SseEventPayload>;
}): DocStore;

/** SQLite migrations owned by `@mitori/doc` (`doc_*`). */
export declare const DOC_MIGRATIONS: readonly Migration[];

/** Server-side renderer: Markdown (html disabled) → block HTML per `HTML_CONTRACT`; Shiki (Oniguruma) for code. */
export interface BlockRenderer {
  /** Render a block (cached by `hash × lang × rendererVersion`). */
  render(block: Block, claims: Claim[], opts: { lang: DocLang; glossaryTerms: Map<string, string> }): Promise<string>;
  /** Highlight a code range for cite peeks (±ctx lines). */
  highlight(slice: CodeSlice, lang: SourceLang): Promise<string>;
  /** Renderer version (cache key component). */
  readonly version: string;
}

/** Diagram layout service (ELK layered in a Bun Worker; deterministic sequence layout). */
export interface DiagramLayouter {
  /** Layout (cached by IR hash). Budget: 300 nodes ≤ 100 ms, 1000 ≤ 400 ms. */
  layout(ir: DiagramIR, signal?: Cancel): Promise<DiagramLayout>;
  /** Deterministic Mermaid text for the Markdown file (GitHub renders it; mitori's UI never uses Mermaid for its own diagrams). */
  toMermaid(ir: DiagramIR): string;
}

/** Self-contained HTML export (P3): one file, viewer JS + doc JSON inline, no network. */
export interface HtmlExporter {
  /** Export the current doc. Secret scan runs first; redactions are counted. */
  export(req: ExportReq): Promise<ExportRes & { html?: string }>;
}

/* ============================================================================
 * Part B — @mitori/gen
 * ========================================================================== */

/**
 * `gen.block/1` NDJSON line protocol emitted by the LLM (one JSON object per line).
 * The LLM references code by `path` + line range only; the server stamps blob/symbol/snippet.
 * Lines are validated on arrival; invalid lines are collected and re-requested ONCE.
 */
export type GenLine =
  | {
      /** Block upsert. */
      t: "block";
      /** Existing id (update) or `new:<n>` placeholder (create). */
      id: BlockId | `new:${number}`;
      /** Section. */
      section: SectionId;
      /** Insert position for creates. */
      after?: BlockId | `new:${number}`;
      /** Kind. */
      kind: BlockKind;
      /** Depth. */
      depth: Depth;
      /** Audience tags. */
      audience: Audience[];
      /** Markdown (no raw HTML, no ID comments, no headings deeper than the section allows). */
      md: string;
      /** Claims; `text` must be an exact substring of `md`. */
      claims: { text: string; kind: ClaimKind; cites: { path: RepoPath; start: LineNo; end: LineNo }[] }[];
    }
  | {
      /** Delete an existing block (regeneration only). */
      t: "delete";
      /** Block. */
      id: BlockId;
    }
  | {
      /** Keep an existing block unchanged (explicit, for coverage accounting). */
      t: "keep";
      /** Block. */
      id: BlockId;
    }
  | {
      /** Diagram for a `diagram` block (or labels for a static diagram). */
      t: "diagram";
      /** Block placeholder/id owning the diagram. */
      block: BlockId | `new:${number}`;
      /** Full IR (LLM-authored flows/sequences) … */
      ir?: Omit<DiagramIR, "id" | "origin">;
      /** … or node label overrides for a static diagram. */
      labels?: Record<string, string>;
    }
  | {
      /** Glossary term. */
      t: "term";
      /** Term. */
      term: string;
      /** Hiragana reading. */
      yomi?: string;
      /** English. */
      en?: string;
      /** Definition (Markdown, ≤ 3 sentences). */
      definition: string;
    }
  | {
      /** Module display name (replaces the provisional one). */
      t: "module_name";
      /** Module. */
      module: ModuleId;
      /** Name in the doc language. */
      name: string;
    }
  | {
      /** Open question for §13. */
      t: "question";
      /** Question text. */
      text: string;
      /** Optional cites. */
      cites: { path: RepoPath; start: LineNo; end: LineNo }[];
    }
  | {
      /** Terminator with self-reported counts (server checks coverage independently). */
      t: "end";
      /** Number of block lines emitted. */
      blocks: number;
    };

/** Per-line validation outcome. */
export interface LineVerdict {
  /** 1-based line number in the stream. */
  line: number;
  /** Parsed line when valid. */
  value?: GenLine;
  /** Errors (≤ 5 per line). */
  errors: CheckError[];
}

/** Planned unit of work before scheduling. */
export interface PlannedTask {
  /** Stage. */
  stage: GenStage;
  /** Target. */
  target: GenTask["target"];
  /** Depends on (bottom-up topo order: children before parents before overview). */
  deps: GenTaskId[];
  /** Prompt used. */
  prompt: PromptVersion;
  /** Model. */
  model: ModelId;
  /** Input estimate. */
  inTokens: number;
  /** Output estimate. */
  outTokens: number;
  /** Cache key (skips the call when a validated result exists). */
  cacheKey: Xxh3;
}

/** Plan for a run. */
export interface GenPlan {
  /** Effort. */
  effort: Effort;
  /** Ordered tasks. */
  tasks: PlannedTask[];
  /** Sections covered. */
  sections: SectionId[];
  /** Index digest the plan is valid for. */
  indexDigest: Xxh3;
}

/** Deterministic planner (effort formulas of research 04 §9.1, recomputed for C=3 / C=1). */
export interface GenPlanner {
  /** Build a plan. Standard = top ≤ 40 modules by rank eager, the rest lazy placeholders. */
  plan(req: GenEstimateReq): GenPlan;
  /** Price + time a plan (stages, critical path = overview, alternatives push C=3 vs session C=1 vs API+Batch). */
  estimate(plan: GenPlan, engine: EngineId, concurrency: number): GenEstimate;
}

/** Verification (L0–L2 deterministic; L3 sampled judge — P3). */
export interface Verifier {
  /** Stamp blob/symbol/snippet on raw cites and fix trivially out-of-range ends (clamp ≤ 2 lines). */
  stamp(raw: { path: RepoPath; start: LineNo; end: LineNo }[]): Promise<Cite[]>;
  /** L0/L1/L2 checks for claims. */
  check(claims: { quote: string; cites: Cite[] }[]): Promise<ClaimChecks[]>;
  /** Select claims for the L3 judge (all L1 failures + 10 % sample). */
  sampleForJudge(claims: Claim[], rate: number): ClaimId[];
}

/** Outcome of the incremental pass (S9) — static marking only; LLM work is suggested, not run (D12). */
export interface IncrementalOutcome {
  /** Claims turned stale (hunks overlapping cited ranges). */
  staleClaims: ClaimId[];
  /** Blocks turned stale. */
  staleBlocks: BlockId[];
  /** Regeneration suggestions (shown as "この節だけ再生成 ≈4k tok"). */
  suggestions: {
    /** Section. */
    section: SectionId;
    /** Why (early cutoff rules: iface digest changed, > 20 % stale claims, facts changed). */
    reason: "iface_changed" | "stale_ratio" | "facts_changed" | "new_symbols";
    /** Estimate for the scoped run. */
    estimate: GenEstimate;
  }[];
}

/** Session engine (in-session Pull for generation). Packet layout is `mitori.prep/1`. */
export interface SessionEngine {
  /** Write a work packet into `<repo>/.mitori/tmp/prep/<id>/` (README.md, tasks.json, schema.md, inputs/, out/). */
  prep(req: GenEstimateReq): Promise<PrepInfo>;
  /** Validate `out/*.ndjson` with the same line validator, stamp provenance, apply to the doc. */
  ingest(req: IngestReq): Promise<IngestReport>;
}

/** The generation orchestrator (one per workspace). */
export interface GenOrchestrator {
  /** Plan + estimate (never spends tokens). */
  estimate(req: GenEstimateReq): Promise<GenEstimate>;
  /** Start a confirmed run (estimate id must match the current index digest). */
  start(estimateId: EstimateId): Promise<GenRun>;
  /** Pause / resume / cancel. Cancel sends SIGINT to running engine calls (results recorded). */
  control(run: GenRunId, action: "pause" | "resume" | "cancel"): Promise<GenRun>;
  /** Boost a section's tasks ("この章を先に生成"). */
  prioritize(section: SectionId): void;
  /** Run + tasks. */
  run(id: GenRunId): { run: GenRun; tasks: GenTask[] } | null;
  /** Active run. */
  active(): GenRun | null;
  /** S9: react to an index delta (re-anchor claims via the anchor engine, mark stale, suggest). */
  onIndexDelta(delta: IndexDelta): Promise<IncrementalOutcome>;
  /** On-demand "やさしく" rewrite (≈0.5k tokens; cached per block hash) ⇒ proposal. */
  simplify(block: BlockId, level: ReaderLevel): Promise<{ cached: boolean; run?: GenRunId; proposal?: ProposalId }>;
  /** On-demand translation (D5; cached per block hash × lang) ⇒ stored translation (not a proposal). */
  translate(block: BlockId, lang: DocLang): Promise<{ cached: boolean; run?: GenRunId }>;
  /** Session engine. */
  session: SessionEngine;
}

/** Everything gen needs. */
export interface GenDeps {
  /** Workspace. */
  ws: WorkspaceInfo;
  /** DB (`gen_*` tables: runs, tasks, notes cache keyed by cacheKey). */
  db: SqlDb;
  /** Read-only index. */
  indexer: Indexer;
  /** Doc store (writes go through the workspace write queue). */
  doc: DocStore;
  /** Anchor engine (claims re-anchoring on code change). */
  anchors: AnchorEngine;
  /** Shared agent scheduler (concurrency, yield, back-off, usage ledger). */
  scheduler: AgentScheduler;
  /** Prompt registry (gen-owned templates). */
  prompts: (id: GenPromptId) => PromptTemplate;
  /** Settings. */
  settings: () => EffectiveSettings;
  /** Logger. */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Events (`gen.*`, `doc.*`). */
  events: EventSink<SseEventPayload>;
}

/** Gen-owned prompt ids (English templates; user/ASK text inserted verbatim). */
export type GenPromptId =
  | "gen.module"
  | "gen.parent"
  | "gen.overview"
  | "gen.flows"
  | "gen.glossary"
  | "gen.labels"
  | "gen.judge"
  | "doc.regen"
  | "doc.sync"
  | "doc.simplify"
  | "doc.translate";

/** Factory. */
export declare function createGen(deps: GenDeps): GenOrchestrator;

/** SQLite migrations owned by `@mitori/gen` (`gen_*`). */
export declare const GEN_MIGRATIONS: readonly Migration[];

/*
 * TODO(gen spec):
 *  - D14 measurement (P0): `--json-schema` vs NDJSON for module pages on crit/m3e (tokens, turns, latency,
 *    validity); decide per stage. Small tasks (labels, judge) may use --json-schema.
 *  - Prompt texts (English, versioned, byte-stable), cache layout: [system][repo pack][module input][unit].
 *    claude-cli: repo pack goes in --system-prompt-file (only cross-process cache point; 1h TTL write ×2).
 *    anthropic-api: explicit breakpoints BP1 system / BP2 repo pack / BP3 module, Batch for Pass 2.
 *  - Pass-1 actual measurement on crit and m3e at C=3 (tokens, time, 5h %, citation L0/L1) — addendum C6/C3.
 *  - Effort scope formulas + standard-tier selection; lazy placeholders ("生成する ≈6k tok").
 *  - Regeneration protocol: existing block ids + 1-line summaries in, id-referenced update/new/delete/keep out;
 *    coverage check + duplicate rejection (generalized crit hunk_refs); locked blocks ⇒ proposals.
 *  - Prep packet format `mitori.prep/1` (byte-exact README skeleton ≤ 1.5 KB; server fingerprint required at ingest).
 *  - Markdown serialization rules (deterministic; relative citation links `../../path#Lx-Ly`; GitHub alerts for callouts;
 *    Mermaid fence generated from IR for GitHub), golden tests, and the 3-way merge for externally edited files.
 *  - Refusal handling (Sonnet 5.5 classifiers: cyber/bio/frontier_llm/...) ⇒ `E_AGENT_REFUSAL` per task, run continues.
 */
