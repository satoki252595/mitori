/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/gen.ts` (Part A) — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/doc.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

/**
 * @file mitori — doc model + generation contract.
 *
 * Covers TWO packages owned by the gen spec (`docs/design/specs/generation.md`, "§n" below):
 *   - Part A `@mitori/doc`  — Markdown ⇄ blocks (trailing ID comments), cite links ⇄ claim markers,
 *                             semantic hash, `doc.index.json`, history, proposals + sentence-level 3-way,
 *                             decisions/, rendering, Diagram IR → ELK, static sections, HTML export.
 *   - Part B `@mitori/gen`  — planner (effort → task DAG), prompts (English, versioned), `gen.block/1`
 *                             NDJSON line protocol with per-line validation + exactly one retry,
 *                             server-side stamping, Verifier L0–L3, estimates (C=3 / C=1, API-equivalent
 *                             $, 5h window), engines (claude-cli / anthropic-api / session prep+ingest),
 *                             incremental S9, on-demand deep dive / simplify / translate.
 *
 * Status: DRAFT 1.1 (2026-10-03, revision R1). Signatures are the seams server / loop / web rely on.
 * `@mitori/gen` MUST NOT import `@mitori/loop` (and vice versa); the server wires them.
 * Change requests §17 C1–C12 were applied to core/api in R1 (`contracts/CR-LEDGER.md`); review findings that
 * changed this file are tagged `[ID]` (see `docs/design/REVIEW-LOG.md`).
 */

import type {
  Audience,
  Block,
  BlockAspect,
  BlockGenInfo,
  BlockHistoryEntry,
  BlockId,
  BlockKind,
  Cancel,
  CheckError,
  Cite,
  Claim,
  ClaimChecks,
  ClaimId,
  ClaimKind,
  CodeSlice,
  Coverage,
  Decision,
  Depth,
  DiagramIR,
  DiagramLayout,
  DocIndex,
  DocLang,
  DocManifest,
  DocProposal,
  Effort,
  ExportReq,
  ExportRes,
  Fact,
  Freshness,
  GitOid,
  GlossaryEntry,
  LineNo,
  MessageAuthor,
  ModelId,
  ModuleId,
  ModuleInfo,
  PromptVersion,
  ProposalId,
  ReaderLevel,
  RepoPath,
  RepoSnapshot,
  SectionId,
  SectionNode,
  SourceLang,
  SymbolKind,
  UsageTotals,
  Verdict,
  WorkspaceKey,
  Xxh3,
} from "@mitori/core";

/* ============================================================================
 * Part A — @mitori/doc
 * ========================================================================== */

/* ---- A1. Markdown grammar constants (§10.2–§10.4) --------------------------------- */

/**
 * Where the block-ID comment goes for each kind (FORMAT.blockIdSyntax = 1).
 * `trailing`: ` <!-- b_xxxxxxxx -->` appended to the block's last line (one space, trailing spaces removed first).
 * `own_line`: the comment alone on the line right after the block's last line.
 * ID comments are also the block DELIMITERS when parsing (§10.4).
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

/** Regex (source) of a block ID comment. Exactly one space inside the delimiters. */
export const BLOCK_ID_COMMENT_RE = "<!-- (b_[0-9a-hjkmnp-tv-z]{8}) -->" as const;

/** Regex (source) of a decision ID comment (first line of `decisions/<id>.md`). */
export const DECISION_ID_COMMENT_RE = "<!-- (dc_[0-9a-hjkmnp-tv-z]{8}) -->" as const;

/** Regex (source) of a claim marker in marker form (outside code spans / fences only). §6.6 */
export const CLAIM_MARKER_RE = "\\[\\[([1-9][0-9]?)\\]\\]" as const;

/** Sentence terminators used by marker normalization (W07) and quote derivation (§6.6). */
export const SENTENCE_TERMINATORS = "。．！？!?." as const;

/** Cite-link rendering per language (§10.3). `groupRe` recognizes one rendered group when parsing. */
export const CITE_LINK_FORMAT = {
  ja: {
    open: "（",
    close: "）",
    sep: "、",
    inferred: "（推測）",
    groupRe: "（(?:\\[[^\\]\\n]+\\]\\([^)\\s]+#L\\d+(?:-L\\d+)?\\)(?:、)?)+）|（推測）",
  },
  en: {
    open: " (",
    close: ")",
    sep: ", ",
    inferred: " (inferred)",
    groupRe: " \\((?:\\[[^\\]\\n]+\\]\\([^)\\s]+#L\\d+(?:-L\\d+)?\\)(?:, )?)+\\)| \\(inferred\\)",
  },
} as const satisfies Record<DocLang, { open: string; close: string; sep: string; inferred: string; groupRe: string }>;

/** GitHub-alert wrapper per callout kind (§10.2). `label: null` ⇒ no label line (why: md starts with a bold title). */
export const CALLOUT_FORMAT = {
  learn: { alert: "NOTE", label: { ja: "この章で分かること", en: "What you will learn" } },
  recap: { alert: "TIP", label: { ja: "まとめ", en: "Recap" } },
  pitfall: { alert: "WARNING", label: { ja: "落とし穴", en: "Pitfall" } },
  deepdive: { alert: "NOTE", label: { ja: "深掘り", en: "Deep dive" } },
  placeholder: { alert: "NOTE", label: { ja: "未生成", en: "Not generated yet" } },
  faq: { alert: "NOTE", label: { ja: "よくある質問", en: "FAQ" } },
  why: { alert: "IMPORTANT", label: null },
} as const satisfies Partial<Record<BlockKind, { alert: "NOTE" | "TIP" | "WARNING" | "IMPORTANT"; label: { ja: string; en: string } | null }>>;

/* ---- A2. Aspects (§4.2). `BlockAspect` lives in core (R1, C2 applied) -------------------- */

/** Section key used to look up the allowed aspect list. `s3/*` = a flow sub-section. */
export type SectionAspectKey = "s0" | "s1" | "s2" | "s3" | "s3/*" | "s6/leaf" | "s6/parent" | "s7" | "s9" | "s10" | "s11";

/** Allowed aspects per section, in rendering order (§4.2). Sections not listed take no LLM blocks. */
export const SECTION_ASPECTS = {
  s0: ["tldr"],
  s1: ["problem", "users", "scope", "constraints"],
  s2: ["caption"],
  s3: ["intro"],
  "s3/*": ["summary", "sequence", "steps", "edge_cases"],
  "s6/leaf": [
    "learn",
    "responsibility",
    "interface",
    "dependencies",
    "data",
    "flow",
    "config",
    "tests",
    "invariants",
    "errors",
    "concurrency",
    "performance",
    "pitfalls",
    "deepdive",
    "files",
    "recap",
  ],
  "s6/parent": ["learn", "responsibility", "structure", "interactions", "interface", "invariants", "recap"],
  s7: ["overview", "entities", "lifecycle", "invariants", "migrations"],
  s9: ["hotpaths", "caching", "limits", "security", "reliability", "observability"],
  s10: ["decision"],
  s11: ["debt", "untested", "hotspots", "fragile"],
} as const satisfies Record<SectionAspectKey, readonly BlockAspect[]>;

/**
 * Allowed kinds, default depth and audience per aspect (gen spec §5.6 per-prompt "Audience" rules; compact lines
 * derive kind / depth / audience from here, PT-03) [CR m1-14]. Validator accepts depth within default ± 1 (V08).
 */
export const ASPECT_DEFAULTS = {
  tldr: { kinds: ["prose"], depth: "L0", audience: ["newcomer", "pm", "dev"] },
  problem: { kinds: ["prose"], depth: "L0", audience: ["newcomer", "pm", "dev"] },
  users: { kinds: ["list"], depth: "L1", audience: ["newcomer", "pm", "dev"] },
  scope: { kinds: ["list"], depth: "L1", audience: ["newcomer", "pm", "dev"] },
  constraints: { kinds: ["list"], depth: "L1", audience: ["newcomer", "pm", "dev"] },
  caption: { kinds: ["prose"], depth: "L1", audience: ["newcomer", "pm", "dev"] },
  intro: { kinds: ["prose"], depth: "L1", audience: ["newcomer", "dev"] },
  summary: { kinds: ["prose"], depth: "L1", audience: ["newcomer", "pm", "dev"] },
  sequence: { kinds: ["diagram"], depth: "L2", audience: ["dev"] },
  steps: { kinds: ["list"], depth: "L2", audience: ["dev", "reviewer"] },
  edge_cases: { kinds: ["list"], depth: "L3", audience: ["reviewer", "dev"] },
  learn: { kinds: ["learn"], depth: "L1", audience: ["newcomer", "dev"] },
  responsibility: { kinds: ["prose"], depth: "L2", audience: ["newcomer", "dev"] },
  interface: { kinds: ["list", "table"], depth: "L2", audience: ["dev"] },
  dependencies: { kinds: ["prose", "list"], depth: "L2", audience: ["dev"] },
  data: { kinds: ["list", "table"], depth: "L2", audience: ["dev"] },
  flow: { kinds: ["list"], depth: "L2", audience: ["dev"] },
  config: { kinds: ["list"], depth: "L2", audience: ["dev"] },
  tests: { kinds: ["prose", "list"], depth: "L2", audience: ["dev"] },
  invariants: { kinds: ["list"], depth: "L3", audience: ["reviewer", "dev"] },
  errors: { kinds: ["prose", "list"], depth: "L3", audience: ["reviewer", "dev"] },
  concurrency: { kinds: ["prose"], depth: "L3", audience: ["reviewer", "dev"] },
  performance: { kinds: ["prose"], depth: "L3", audience: ["reviewer", "dev"] },
  pitfalls: { kinds: ["pitfall"], depth: "L2", audience: ["dev"] },
  deepdive: { kinds: ["deepdive"], depth: "L3", audience: ["reviewer", "dev"] },
  files: { kinds: ["deepdive"], depth: "L3", audience: ["reviewer", "dev"] },
  recap: { kinds: ["recap"], depth: "L1", audience: ["newcomer", "dev"] },
  structure: { kinds: ["list"], depth: "L2", audience: ["dev"] },
  interactions: { kinds: ["prose", "list"], depth: "L2", audience: ["dev"] },
  overview: { kinds: ["prose"], depth: "L2", audience: ["dev", "reviewer", "pm"] },
  entities: { kinds: ["table"], depth: "L2", audience: ["dev", "reviewer"] },
  lifecycle: { kinds: ["list"], depth: "L2", audience: ["dev", "reviewer"] },
  migrations: { kinds: ["prose"], depth: "L3", audience: ["dev", "reviewer"] },
  hotpaths: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  caching: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  limits: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  security: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  reliability: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  observability: { kinds: ["prose", "list", "pitfall"], depth: "L3", audience: ["reviewer", "sre", "dev"] },
  decision: { kinds: ["why"], depth: "L2", audience: ["reviewer", "dev", "pm"] },
  debt: { kinds: ["list", "prose", "pitfall"], depth: "L3", audience: ["reviewer", "dev", "pm"] },
  untested: { kinds: ["list", "prose", "pitfall"], depth: "L3", audience: ["reviewer", "dev", "pm"] },
  hotspots: { kinds: ["list", "prose", "pitfall"], depth: "L3", audience: ["reviewer", "dev", "pm"] },
  fragile: { kinds: ["list", "prose", "pitfall"], depth: "L3", audience: ["reviewer", "dev", "pm"] },
} as const satisfies Record<BlockAspect, { kinds: readonly BlockKind[]; depth: Depth; audience: readonly Audience[] }>;

/** Static heading text per aspect (`null` = no heading block). LLM never writes headings (V12). */
export const ASPECT_HEADINGS = {
  tldr: null,
  problem: { ja: "解決する課題", en: "Problem" },
  users: { ja: "利用者", en: "Users" },
  scope: { ja: "範囲", en: "Scope" },
  constraints: { ja: "制約", en: "Constraints" },
  caption: null,
  intro: null,
  summary: null,
  sequence: null,
  steps: { ja: "手順", en: "Steps" },
  edge_cases: { ja: "例外と境界", en: "Edge cases" },
  learn: null,
  responsibility: { ja: "責務", en: "Responsibility" },
  interface: { ja: "公開インターフェース", en: "Public interface" },
  dependencies: { ja: "依存関係", en: "Dependencies" },
  data: { ja: "データ構造", en: "Data structures" },
  flow: { ja: "処理の流れ", en: "How a call flows" },
  config: { ja: "設定", en: "Configuration" },
  tests: { ja: "テスト", en: "Tests" },
  invariants: { ja: "不変条件", en: "Invariants" },
  errors: { ja: "エラー処理", en: "Error handling" },
  concurrency: { ja: "並行性", en: "Concurrency" },
  performance: { ja: "性能", en: "Performance" },
  pitfalls: { ja: "落とし穴", en: "Pitfalls" },
  deepdive: { ja: "深掘り", en: "Deep dives" },
  files: { ja: "ファイル別の詳細", en: "Per-file notes" },
  recap: null,
  structure: { ja: "構成", en: "Structure" },
  interactions: { ja: "相互作用", en: "Interactions" },
  overview: { ja: "概要", en: "Overview" },
  entities: { ja: "エンティティ", en: "Entities" },
  lifecycle: { ja: "ライフサイクル", en: "Lifecycle" },
  migrations: { ja: "マイグレーション", en: "Migrations" },
  hotpaths: { ja: "ホットパス", en: "Hot paths" },
  caching: { ja: "キャッシュ", en: "Caching" },
  limits: { ja: "上限値", en: "Limits" },
  security: { ja: "セキュリティ境界", en: "Security boundaries" },
  reliability: { ja: "信頼性", en: "Reliability" },
  observability: { ja: "可観測性", en: "Observability" },
  decision: null,
  debt: { ja: "技術的負債", en: "Debt" },
  untested: { ja: "テストの穴", en: "Untested areas" },
  hotspots: { ja: "ホットスポット", en: "Hotspots" },
  fragile: { ja: "壊れやすい箇所", en: "Fragile spots" },
} as const satisfies Record<BlockAspect, { ja: string; en: string } | null>;

/**
 * Deterministic slot keys of static blocks (§4.1, §10.5). Placeholders: `<id>` = ModuleId,
 * `<aspect>` = BlockAspect, `<key>` = flow key, `<section>` = SectionId. Block id = `b_` + base32(xxh3(docId|slot))[0..8].
 */
export const STATIC_SLOTS = [
  "<section>:h",
  "<section>:h:<aspect>",
  "<section>:ph",
  "s0:badges",
  "s0:coverage",
  "s2:floorplan",
  "s3:<key>:h",
  "s4:scripts",
  "s4:env",
  "s4:entries",
  "s5:tree",
  "s5:start",
  "s5:noise",
  "s6:index",
  "m:<id>:h",
  "m:<id>:facts",
  "m:<id>:h:<aspect>",
  "m:<id>:diagram",
  "m:<id>:change",
  "m:<id>:regions",
  "m:<id>:ph",
  "s7:types",
  "s7:types-map",
  "s7:schema",
  "s7:er",
  "s8:routes",
  "s8:cli",
  "s8:outbound",
  "s8:env",
  "s8:secrets",
  "s10:decisions",
  "s10:adrs",
  "s11:todos",
  "s11:untested",
  "s11:large",
  "s12:table",
  "s13:list",
  "ap:sources",
  "ap:meta",
] as const;

/* ---- A3. Codec (pure functions; byte-exact, golden-tested) ---------------------------- */

/** Context needed to render / parse cite links. */
export interface CodecContext {
  /** Primary language of the doc (selects the cite-link grammar). */
  lang: DocLang;
  /** Docdir-relative file being written/read, e.g. `doc/modules/internal-session.md`. */
  docFile: string;
  /** Absolute docDir path. */
  docDirAbs: string;
  /** Absolute working-tree root (cite hrefs are relative paths from the doc file to here). */
  rootAbs: string;
}

/** One cite-link group found in a Markdown file (parse direction). */
export interface CiteLinkGroup {
  /** 1-based occurrence index inside the block (becomes `[[k]]`). */
  k: number;
  /** Parsed cites (path/start/end only; blob etc. come from the sidecar or are re-stamped). */
  cites: { path: RepoPath; start: LineNo; end: LineNo }[];
  /** `（推測）` / ` (inferred)`. */
  inferred: boolean;
}

/** A claim span derived from marker form (§6.6). */
export interface ClaimSpan {
  /** Marker number. */
  n: number;
  /** UTF-16 offsets of the sentence span in the marker-form md (excluding the marker). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Plain-text quote (ANCHOR_TEXT_RULES-compatible, ≤ 300 chars). */
  quote: string;
  /** Backticked identifiers in the span's Markdown source (L1 input). */
  identifiers: string[];
}

/** Result of parsing one doc file (§10.4). */
export interface ParsedDocFile {
  /** Blocks in file order (md = de-wrapped Markdown WITH cite links, i.e. file form). */
  blocks: { id: BlockId | null; kindHint: BlockKind; md: string; links: CiteLinkGroup[] }[];
  /** Duplicate ids found (second occurrences get fresh ids). */
  duplicates: BlockId[];
  /** Problems (≤ 20). */
  problems: CheckError[];
}

// `parseDocFile` → ./codec/index.ts

// `serializeDocFile` → ./codec/index.ts

// `toMarkerForm` → ./codec/index.ts

// `fromMarkerForm` → ./codec/index.ts

// `semanticHash` → ./codec/index.ts

// `deriveClaimSpans` → ./codec/index.ts

// `canonicalJson` → ./codec/index.ts (re-export of the @mitori/core implementation)

// `yomiToRomaji` → ./codec/index.ts

// `merge3` → ./codec/index.ts

/* ---- A4. Store types ------------------------------------------------------------------ */

/** Result of loading a doc directory. */
export interface DocLoadReport {
  /** Manifest found. */
  manifest: DocManifest | null;
  /** Blocks whose semantic hash differs from the index ⇒ locked `human-edited` (edited outside mitori). */
  externallyEdited: BlockId[];
  /** Blocks without an ID comment that received a fresh id (written back on next save). */
  assignedIds: BlockId[];
  /** Index entries whose block disappeared from Markdown (tombstoned; threads become outdated). */
  orphaned: BlockId[];
  /** Parse problems (structured, ≤ 20). */
  problems: CheckError[];
}

/** A stamped claim ready to be written (all fields server-computed except `kind`). */
export interface GeneratedClaim {
  /** Marker number in `GeneratedBlock.md`. */
  n: number;
  /** Kind (from the LLM line). */
  kind: ClaimKind;
  /** Plain quote derived from the marker span. */
  quote: string;
  /** Stamped cites (blob/symbol/snippet/precision). */
  cites: Cite[];
  /** L0–L2 checks at stamp time. */
  checks: ClaimChecks;
  /** Verdict computed by `computeVerdict`. */
  verdict: Verdict;
  /** Existing claim id to keep (identity rules §6.7-6). */
  reuse?: ClaimId;
}

/** A generated (or regenerated) block from gen, already validated and stamped. */
export interface GeneratedBlock {
  /** Existing id to update, or `null` to create. */
  id: BlockId | null;
  /** The LLM placeholder when creating (`new:3`), for `ApplyResult.idMap`. */
  ref?: NewBlockRef;
  /** Section. */
  section: SectionId;
  /** Aspect (fixes order / heading). */
  aspect?: BlockAspect;
  /** Insert after (existing id, or a ref of a block earlier in the same apply call). */
  after?: BlockId | NewBlockRef | null;
  /** Kind. */
  kind: BlockKind;
  /** Depth. */
  depth: Depth;
  /** Audience. */
  audience: Audience[];
  /** Language. */
  lang: DocLang;
  /** Markdown in MARKER FORM (no ID comment, no links, no raw HTML). The doc store renders links. */
  md: string;
  /** Claims (marker n ↔ claim). */
  claims: GeneratedClaim[];
  /** Diagram IR when kind is `diagram`. */
  diagram?: Omit<DiagramIR, "id">;
  /** Provenance (server-stamped). */
  gen: BlockGenInfo;
}

/** Write directly, or turn every change into a proposal (D12 / locked blocks always become proposals). */
export type ApplyMode = "write" | "propose";

/** Options of `applyGenerated`. */
export interface ApplyOptions {
  /** Write or propose. Locked blocks are proposals regardless. */
  mode: ApplyMode;
  /** Blocks to delete (regeneration only). */
  deletes: BlockId[];
  /** Proposal source when proposals are created. */
  source: DocProposal["source"];
  /** One-line reason for proposal cards. */
  reason: string;
  /** Number of EXISTING ids the task listed (mass-delete guard §6.7-4). */
  listed: number;
}

/** Outcome of applying generated blocks. */
export interface ApplyResult {
  /** Created/updated blocks. */
  written: BlockId[];
  /** Deleted blocks (tombstoned). */
  deleted: BlockId[];
  /** Proposals created instead of writes. */
  proposals: ProposalId[];
  /** Updates whose semantic hash was unchanged (no-op). */
  unchanged: BlockId[];
  /** `new:n` → assigned id (persisted with gen_outputs for idempotent replay). */
  idMap: Record<NewBlockRef, BlockId>;
}

/** Module display name + one-line summary (from `module` lines). Stored in `DocIndex.modules` (§17 C2). */
export interface ModuleLabel {
  /** Module. */
  module: ModuleId;
  /** Name in the doc language. */
  name: string;
  /** One-line summary. */
  summary?: string;
}

/** Static (zero-token) doc content derived from the index (S0–S4), refreshed on every delta (§11.2). */
export interface StaticDocInput {
  /** Snapshot (badges: last commit). */
  snapshot: RepoSnapshot;
  /** Coverage. */
  coverage: Coverage;
  /** All facts (§4 quickstart, §5 map, §7 schema, §8 interfaces, §11 todos, §10 ADR docs). */
  facts: Fact[];
  /** Modules (§5 tree, §6 index + facts + placeholders). */
  modules: ModuleInfo[];
  /** Static diagrams (floor plan from the module graph, ER from schema facts, parent component diagrams). */
  diagrams: Omit<DiagramIR, "id">[];
  /** License name detected from LICENSE* (null when unknown). */
  license: string | null;
  /** Language mix for the badge. */
  languages: { lang: SourceLang; loc: number }[];
  /** Eager/lazy split (placeholders for lazy modules). */
  lazyModules: ModuleId[];
  /**
   * Gen planner numbers per section (placeholder label 「生成する ≈N tok」 = `inTokens + outTokens`, `SectionNode.est`,
   * ux-R14); absent ⇒ the label has no number [CR m1-42].
   */
  estimates?: Partial<Record<SectionId, { inTokens: number; outTokens: number }>>;
  /** Largest included files for `s11:large` (大きいファイル表, gen §4.1), largest first, ≤ 20 [CR m1-42]. */
  largeFiles?: { path: RepoPath; loc: number; bytes: number }[];
  /** §4 quick start and §5 reading order, from the index (0 tokens; NC-06 / NC-07). Absent ⇒ the tables only. */
  guide?: StaticGuide;
}

/** What §4 「動かしてみる」 and §5 「読む順番」 say before their tables (NC-06 / NC-07). */
export interface StaticGuide {
  /** Declared toolchain (`RepoProfile.toolchain`). */
  toolchain?: { name: string; version: string; path: RepoPath; line: number };
  /** Dependency install command chosen from the lockfile (`npm install`, `pnpm install`, `uv sync`). */
  install?: { command: string; path: RepoPath };
  /** The run command, qualified by the package manager (`npm run dev`, `go run ./cmd/x`); `raw` = the script's own text. */
  run?: { command: string; path: RepoPath; line: number; raw?: string };
  /** The local URL the README / CONTRIBUTING gives (`http://localhost:3000`). */
  url?: { url: string; path: RepoPath; line: number };
  /** The framework's own entry page (Next.js App Router → `app/page.tsx`), listed first under 入口. */
  framework?: { path: RepoPath; label: string };
  /** Reading order: entry → base types → hub → feature core, each with its lines and main symbols. */
  reading?: { role: "entry" | "types" | "hub" | "core"; path: RepoPath; line: number; end?: number; symbols: { name: string; line: number }[] }[];
  /** §7 主要な型 (NC-10): the exported data types ranked by use, with what their fields hold [CR rdoc-2]. */
  types?: StaticKeyType[];
  /** 変更の手引き of every leaf module, by module id (module chapter; the map popover links to it) [CR rdoc-2]. */
  change?: Record<string, ModuleChangeGuide>;
  /** Region outlines of the files over 1,500 lines, by path (module chapter; the code view has the same) [CR rdoc-2]. */
  regions?: Record<string, { lines: number; regions: FileRegion[] }>;
}

/** One key data type of §7 (NC-10). */
export interface StaticKeyType {
  /** Name. */
  name: string;
  /** Declaration kind (`struct`, `interface`, `class`, `type`, `enum`, `trait`). */
  kind: SymbolKind;
  /** Where it is declared. */
  path: RepoPath;
  /** First line. */
  line: LineNo;
  /** Last line. */
  end: LineNo;
  /** Its module. */
  module?: ModuleId;
  /** Fields declared. */
  fields: number;
  /** Other key types its fields hold (`Session.Files []File` → `{ name: "File", field: "Files" }`). */
  refs: { name: string; field: string }[];
  /** Files that use it (references through their imports; Go: `pkg.T`, or the same package) [CR rdoc-5]. */
  usedBy: number;
}

/** 変更の手引き of one module: what a change here reaches, what checks it, where it is entered [CR rdoc-2]. */
export interface ModuleChangeGuide {
  /** Modules that depend on this one (a change here reaches them), strongest first. */
  dependents: { module: ModuleId; weight: number }[];
  /** Modules it depends on. */
  dependencies: { module: ModuleId; weight: number }[];
  /** Test files attached to it, with their case counts. */
  tests: { path: RepoPath; cases: number }[];
  /** How to run them (`go test ./internal/session/...`, the root `test` script), when known. */
  testCommand?: { command: string; path?: RepoPath; line?: LineNo };
  /** Entry points that reach it (routes, CLI commands, mains), ≤ 5. */
  entries: { label: string; path: RepoPath; line: LineNo }[];
  /**
   * Its declarations other files use the most (a change to them reaches those files; m3e: `Item` 15, `Kind` 8),
   * ≥ 2 users, ≤ 5 [CR rdoc-5].
   */
  used?: { name: string; path: RepoPath; line: LineNo; users: number }[];
  /** Files outside it that changed in the same commits (git history, bounded), most often first, ≤ 5. */
  coChange: { path: RepoPath; together: number }[];
  /** Commits that touched it in the window; null without history (shallow clone, no git). */
  commits: number | null;
  /** History window (commits read). */
  window: number;
  /** Risk markers. */
  risks: { kind: "hub" | "large_file" | "untested" | "cycle"; path?: RepoPath; lines?: number; with?: ModuleId[] }[];
}

/** One region of a large file (code view, module chapter) [CR rdoc-2]. */
export interface FileRegion {
  /**
   * What the lines hold. Top level: runs of `types` / `constants` / `functions` / `methods` (of `host`) / `handlers`,
   * and `symbol` = one declaration big enough to have its body outlined (the depth-1 regions after it): `state`
   * (hooks), `effects`, `derived` (memos), `handlers`, `helpers`, `render` (the returned JSX). `section`: a region the
   * author named (`title`) holding nothing the outline recognizes (a long Go function's commented blocks).
   */
  kind:
    | "types"
    | "constants"
    | "functions"
    | "methods"
    | "handlers"
    | "symbol"
    | "state"
    | "effects"
    | "derived"
    | "render"
    | "helpers"
    | "section";
  /**
   * The author's own name of the region: a section header (`// ===== Comment Form =====`, `/* ---- history ---- *\/`,
   * `#region`, `MARK:`) or the comment leading a block of a long function. `kind` then says what most of it is
   * [CR rdoc-6].
   */
  title?: string;
  /** What a titled region holds, by kind (`{ state: 10, effects: 6, helpers: 8 }`), most first in its label. */
  mix?: Partial<Record<FileRegion["kind"], number>>;
  /** First line. */
  start: LineNo;
  /** Last line. */
  end: LineNo;
  /** 0 = top level, 1 = inside the `symbol` (or the titled section holding it) before it. */
  depth: 0 | 1;
  /** Declarations / statements in it. */
  count?: number;
  /** Representative names (≤ 6, in order). */
  names: string[];
  /** The receiver of `methods`, the name of a `symbol`, the enclosing symbol of a depth-1 region. */
  host?: string;
  /** Declaration kind of a `symbol`. */
  symbolKind?: SymbolKind;
  /** Hooks of a depth-1 region (`{ useState: 14, useRef: 6 }`). */
  hooks?: Record<string, number>;
  /** Exported declarations in a top-level run. */
  exported?: number;
}

/** Cached translation of a block (D5). Not a proposal. */
export interface TranslationRecord {
  /** Block. */
  block: BlockId;
  /** Source semantic hash (invalidates on change). */
  srcHash: Xxh3;
  /** Target language. */
  lang: DocLang;
  /** Marker-form md in the target language. */
  md: string;
  /** Prompt version. */
  promptVer: PromptVersion;
  /** Model. */
  model: ModelId;
}

/** The doc store (one per workspace). Single writer: mutations only inside the workspace write queue. */
export interface DocStore {
  /**
   * Load docDir (Markdown canonical for text, index canonical for metadata) and reconcile (§10.4). R1: the
   * persisted `file` field is never used as a path (recomputed from DOC_TEMPLATE + validated slug) and slugs
   * failing SLUG_RE are re-slugified with `notice.slug.rewritten` [SEC-01]. Files whose bytes differ from the
   * ownership ledger `doc_files(rel, sha256_last_written)` are imported via §10.4 (md) or left alone with
   * `notice.doc.notOwned` (non-md) — never overwritten [SEC-02].
   */
  load(): Promise<DocLoadReport>;
  /** Manifest. */
  manifest(): DocManifest | null;
  /** Whole sidecar (in memory). */
  index(): DocIndex;
  /** Sections (flat). */
  sections(): SectionNode[];
  /** Section with blocks. */
  section(id: SectionId): { node: SectionNode; blocks: Block[] } | null;
  /** Block (md in file form, with cite links). */
  block(id: BlockId): Block | null;
  /** Marker-form md of a block (LLM inputs, hashing). */
  markerForm(id: BlockId): string | null;
  /** Plain text per ANCHOR_TEXT_RULES (loop spec §1.1) — doc anchors and claim quotes use it. */
  blockText(id: BlockId): string | null;
  /** Claims of a block. */
  claims(block: BlockId): Claim[];
  /** Blocks citing a file range (gutter backlinks, stale propagation). */
  blocksCiting(path: RepoPath, start?: LineNo, end?: LineNo): BlockId[];
  /** Build/refresh static sections + placeholders (deterministic slot ids). Locked static blocks ⇒ proposals. */
  applyStatic(input: StaticDocInput): ApplyResult;
  /** Apply generated blocks (id-referenced upsert/delete, uniqueness enforced, locks ⇒ proposals). */
  applyGenerated(blocks: GeneratedBlock[], opts: ApplyOptions): ApplyResult;
  /** Store module names/summaries (diagram labels, §5 map, §6 titles). */
  setModuleLabels(labels: ModuleLabel[]): void;
  /** Create/rename a flow sub-section `s3/<key>` at position `order` (0-based). */
  upsertFlowSection(key: string, title: string, order: number): SectionNode;
  /** Remove a sub-section (its blocks are tombstoned). */
  removeSection(id: SectionId): void;
  /** Replace the glossary (entries already merged with repo seeds; romaji/usedIn computed by the store). */
  setGlossary(entries: Omit<GlossaryEntry, "id" | "romaji" | "usedIn">[]): void;
  /**
   * Human edit (3-way: `baseHash` must equal the current hash else `E_DOC_BASE_MISMATCH`). Locks as human-edited.
   * R1 [CONS-06]: `md` in FILE form is parsed (§10.3), new/changed cite links are stamped through `deps.stamper`
   * and L0–L2 run before the edit commits; `checks` are returned. AI-origin md never passes through here.
   * The re-stamped block's freshness is recomputed from its new stamps (a stale block the human re-cites becomes
   * `fresh`) [CR m1-52].
   */
  editBlock(id: BlockId, baseHash: Xxh3, md: string, by: MessageAuthor): Promise<{ block: Block; checks: CheckError[]; dropped: ClaimId[] }>;
  /** Toggle human-verified (claims → verdict `human-verified`, preserved across regeneration). */
  setVerified(id: BlockId, verified: boolean, by: string): Block;
  /** Freshness updates (S9 static marking). */
  setFreshness(blocks: BlockId[], freshness: Freshness): void;
  /** Claim check updates (verifier / re-anchoring). `cites` replaces the cites (moved ranges ⇒ links re-rendered). */
  setClaimChecks(updates: { id: ClaimId; checks: ClaimChecks; cites?: Cite[]; verdict?: Verdict }[]): void;
  /** Create a proposal. */
  propose(p: Omit<DocProposal, "id" | "state" | "createdAt">): DocProposal;
  /** Proposals. */
  proposals(filter?: { state?: DocProposal["state"]; block?: BlockId }): DocProposal[];
  /** Accept (optionally with edited text). Base mismatch ⇒ sentence-level 3-way (§10.6); conflict ⇒ throws `E_DOC_BASE_MISMATCH`. Other pending proposals of the block become `superseded`. */
  acceptProposal(id: ProposalId, md?: string): Block;
  /** Reject. */
  rejectProposal(id: ProposalId): void;
  /** Undo accepted proposals: blocks still at their post-accept hash revert to the previous revision; others are reported as diverged. */
  undoAccept(proposals: ProposalId[]): { reverted: BlockId[]; diverged: BlockId[] };
  /** Block history (timeline + undo source; `doc_history` keeps the text). */
  history(block: BlockId): BlockHistoryEntry[];
  /** Text of a block at a past hash (3-way base). */
  textAt(block: BlockId, hash: Xxh3): string | null;
  /**
   * Write `decisions/<id>.md` and register it (§10.7). The Markdown is rendered by loop (loop spec §2.6.1);
   * the store validates (`# DC: ` heading, `- id:` line, unused id, `file` path), writes atomically and refreshes `s10:decisions`.
   */
  writeDecision(decision: Decision, md: string): Decision;
  /** Decisions. */
  decisions(): Decision[];
  /** Cached translation (null when missing or stale). */
  translation(block: BlockId, lang: DocLang): TranslationRecord | null;
  /** Store a translation. */
  putTranslation(rec: TranslationRecord): void;
  /** Tombstone ids (never reused for 180 days). */
  tombstone(ids: BlockId[]): void;
  /**
   * Persist changed files atomically through `deps.safeWrite` (kind `doc`); deterministic serialization. R1 [PT-11]:
   * serialized block fragments are memoized so a flush is O(changes) (bench: 1 block change on a 10k-block doc
   * ≤ 5 ms CPU); serialization runs OUTSIDE the write queue, only the renames inside; cadence 500 ms normally,
   * 2 s while a generation runs; cite-only moves are deferred until the file is quiet ≥ 10 s (or `force`).
   */
  flush(opts?: { force?: boolean }): Promise<string[]>;
  /** Mint docId + skeleton manifest if absent (first applyStatic / `mitori init`) [CONS-11]. Idempotent. */
  ensureManifest(): DocManifest;
  /**
   * 1-based line of the block's first line in its Markdown file as of the last flush (`BlockView.mdLine`,
   * `data-ln`, permalinks); null before the block was flushed [CR m1-46].
   */
  mdLine(id: BlockId): number | null;
  /**
   * Stamp the manifest at the end of a generation run (gen §10.8 / AC-29) [CR m1-50]: adds `usage` to
   * `usageTotals`, sets `effort` and `snapshot`, and `generatedAt` only when `full` (trigger `user`, whole doc, run
   * `done`). Called by gen's orchestrator inside the run's final write slot.
   */
  stampRun(run: { effort: Effort; snapshot: DocManifest["snapshot"]; usage: UsageTotals; full: boolean }): DocManifest;
}

/**
 * Claim stamping port the doc store needs for human edits and external-editor cite links [CONS-06].
 * Implemented by gen's `Verifier` and injected by the server (doc cannot import gen). `RawCite` and `ClaimSpan`
 * are owned by `@mitori/doc` (this Part A).
 */
export interface ClaimStamper {
  /** Stamp blob/symbol/snippet for raw cites at the CURRENT snapshot and run L0–L2. */
  stamp(raw: readonly RawCite[], span: ClaimSpan): Promise<{ cites: Cite[]; checks: ClaimChecks }>;
}

/**
 * Validator for every AI-origin Markdown (gen NDJSON, patch/agent `docUpdates`, answer promotion, doc.sync /
 * simplify / translate) — the extracted V13 rule [SEC-11]: only repo-relative links and cite links; no images,
 * no autolinks to external hosts, no raw HTML, no ID comments. External links are counted (`externalLinks`)
 * and shown on the proposal card; images ⇒ invalid.
 */
export interface AiMarkdownValidator {
  /** Validate one md; returns problems (≤ 20) and the external-link count. */
  validate(md: string, ctx: { lang: DocLang; allowRepoLinks: boolean }): { ok: boolean; errors: CheckError[]; externalLinks: number };
}

// `createAiMarkdownValidator` → ./store/index.ts

// `createDocStore` → ./store/index.ts

// `DOC_MIGRATIONS` → ./store/index.ts

/**
 * Server-side renderer: Markdown (html disabled) → block HTML per `HTML_CONTRACT`; Shiki (Oniguruma, fine-grained
 * imports only, fixed language list) for code [SC-25]. R1 [PT-07]: body HTML is cached by `semanticHash × lang ×
 * rendererVersion × glossaryDigest(terms in block)` with claim placeholders; `splice` fills cite chips and
 * verdicts from the current claims at serve time. R1 [UXP-24]: the Markdown keeps ONE ASCII space at CJK↔alnum
 * boundaries; the renderer strips exactly that space outside code spans/links (markdown-it core rule) and
 * ANCHOR_TEXT_RULES / `blockText` apply the same strip so TextQuote offsets match.
 */
export interface BlockRenderer {
  /**
   * Render a block body with claim placeholders (cached). `opts.diagram` (the IR from `DocStore.index().diagrams`
   * and the layout dims from `DiagramLayouter.layout`) lets a diagram block carry `figure.mdiagram[data-w][data-h]`
   * and the full text alternative (nodes AND edges); the dims are spliced at serve time like cite chips, so the
   * cached body never depends on the layout [CR m1-51].
   */
  render(
    block: Block,
    claims: Claim[],
    opts: { lang: DocLang; glossaryTerms: Map<string, string>; diagram?: { ir: DiagramIR; layout?: Pick<DiagramLayout, "width" | "height"> } },
  ): Promise<string>;
  /**
   * Thread message Markdown → HTML for `MessageView.html` (CR ux-R23): markdown-it `html:false`, the AI-md link
   * rules (repo-relative and cite links only), no images; sync and cached by text hash [CR m1-70].
   */
  renderMessage(md: string): string;
  /** Fill claim placeholders (chips, hrefs via core HREFS, data-verdict) from current claims. Pure, ≤ 0.05 ms/claim. */
  splice(bodyHtml: string, claims: readonly Claim[], ctx: { ws: WorkspaceKey; level: ReaderLevel }): string;
  /** Highlight a code range for cite peeks (±ctx lines). */
  highlight(slice: CodeSlice, lang: SourceLang): Promise<string>;
  /** Renderer version (cache key component). */
  readonly version: string;
}

/** Diagram layout service (ELK layered in a DEDICATED ELK Worker; deterministic sequence layout) [SC-04]. */
export interface DiagramLayouter {
  /** Layout (cached by IR hash). Budget: 300 nodes ≤ 100 ms, 1000 ≤ 400 ms. */
  layout(ir: DiagramIR, signal?: Cancel): Promise<DiagramLayout>;
  /**
   * Floor-plan layout (`specs/floorplan.md`; WP-18, stretch) [CONS-10]: squarified treemap zones → rooms,
   * Fiedler order, doors, order retention against `prev`. Returns the layout plus quality metrics; the server
   * falls back to `layout(containerIR)` when the gate fails.
   */
  layoutFloorplan(ir: DiagramIR, prev: DiagramLayout | null, signal?: Cancel): Promise<{ layout: DiagramLayout; quality: { labelFit: number; doorRatio: number; rooms: number; layoutMs: number } }>;
  /** Deterministic Mermaid text for the Markdown file (§10.2-5). mitori's UI never uses Mermaid for its own diagrams. */
  toMermaid(ir: DiagramIR): string;
}

/**
 * Self-contained HTML export (P3): one file, viewer JS + doc JSON inline, no network. R1 [SEC-11]: the JSON payload
 * escapes `<`, `>`, `&`, U+2028, U+2029 as `\uXXXX`; the document carries the meta CSP
 * `default-src 'none'; script-src 'sha256-<viewer>'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`.
 * The daemon returns the HTML; the CLI writes `--out` [CONS-07].
 */
export interface HtmlExporter {
  /** Export the current doc. Secret scan runs first; redactions and code excerpts are counted. */
  export(req: ExportReq): Promise<ExportRes>;
}

/**
 * Highlight request for the compute Worker (Shiki). `lang` widens to the config / docs fences
 * (`"json" | "yaml" | "toml" | "markdown" | "shellscript" | "sql"`) when WP-04 adds those grammars (contract line +
 * grammars in one change) [CR m1-48].
 */
export interface HighlightReq {
  /** Source text (whole blob; tokenized once per blob with grammar-state checkpoints every 100 lines) [PT-16]. */
  text: string;
  /** Language. */
  lang: SourceLang;
  /** Blob (cache key). */
  blob: GitOid;
  /** Line window to return. */
  range?: { start: LineNo; end: LineNo };
}

// `createBlockRenderer` → ./render/index.ts

// `createHighlight` → ./render/index.ts — `(wasm, cacheBlobs?) => Promise<(req: HighlightReq) => string>`, the compute Worker's half [CR m1-3]

// `createDiagramLayouter` → ./layout/index.ts

// `elkLayout` → ./layout/index.ts — `(elk: { layout(elkGraph) }, { ir }) => Promise<DiagramLayout>`, the ELK pool adapter's half [CR m1-3]

// `createHtmlExporter` → ./export/index.ts

/* ---- A5. Moved from Part B (@mitori/gen) at the M0 freeze [CR m0-2]: Part A's store API uses them;
 *      @mitori/gen re-exports these names --------------------------------------------------- */

/**
 * Id generator = core `newId(kind, random)` (random in production, seeded in tests for determinism). `doc` mints
 * `DocManifest.docId` (CONS-11), `diagram` the id of an AI diagram block [CR m1-41].
 */
export interface GenIdSource {
  /** Next id of a kind (format per `ID_SPEC`). */
  next(kind: "block" | "claim" | "genRun" | "genTask" | "prep" | "proposal" | "estimate" | "decision" | "suggestion" | "doc" | "diagram"): string;
}

/** LLM placeholder id of a block created in the same reply. */
export type NewBlockRef = `new:${number}`;

/** Raw cite as emitted by the LLM (server stamps blob/symbol/snippet). */
export interface RawCite {
  /** Repo path. */
  path: RepoPath;
  /** First line. */
  start: LineNo;
  /** Last line. */
  end: LineNo;
}
