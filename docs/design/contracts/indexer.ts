/**
 * @file mitori — indexer contract STUB (package `@mitori/indexer`, stages S0–S4 + incremental).
 *
 * Status: STUB. Owner: indexer spec writer (fleshes out this file; architect reviews changes
 * that touch `core.ts`/`api.ts`). Signatures below are the agreed seams other packages code
 * against; internals (tables, algorithms) are the owner's to design.
 *
 * Responsibilities: inventory + filtering (S0), parsing in a WASM Worker pool (S1), static facts
 * (S2), structure — import resolution, graph, directory-prior Leiden, PageRank, SCC (S3),
 * context packs/skeletons (S4), incremental update on file change, search + palette indexes,
 * token estimation. Zero tokens: the indexer never calls an LLM.
 *
 * Budgets (bench/budgets.json): S0–S1 cold ≤ 0.3 s @100k LOC (limit 0.5), ≤ 1.2 s @7k files/100MB;
 * S0–S4 ≤ 1.0 s @100k LOC (limit 2.0); warm rescan ≤ 10 ms (limit 25); single-file update ≤ 15 ms;
 * peak RSS ≤ 700 MB (limit 1 GB).
 */

import type {
  Cancel,
  Clock,
  EffectiveSettings,
  EventSink,
  ExcludeReason,
  ExtractorVersion,
  Fact,
  FactKind,
  FileClass,
  FileEntry,
  GitOid,
  GitReader,
  GraphEdgeKind,
  Hasher,
  LineNo,
  Logger,
  Migration,
  ModuleId,
  ModuleInfo,
  RepoPath,
  RepoSnapshot,
  SourceLang,
  SqlDb,
  SymbolEntry,
  SymbolKey,
  TextKind,
  TokenizerId,
  WorkspaceInfo,
  Xxh3,
} from "./core.ts";
import type { PaletteIndex, ScanSummaryView, SearchHit, SearchKind, SseEventPayload } from "./api.ts";

/* ---------------------------------------------------------------------------
 * Dependencies (injected by @mitori/server)
 * ------------------------------------------------------------------------- */

/** Worker pool port (implemented in @mitori/platform over Bun Workers / node:worker_threads). */
export interface WorkerPool<Req, Res> {
  /** Run one request on the least-loaded worker. */
  run(req: Req, signal?: Cancel): Promise<Res>;
  /** Current worker count. */
  size(): number;
  /** Terminate idle workers (called after 60 s idle to keep idle RSS ≤ 30 MB). */
  shrink(): Promise<void>;
  /** Terminate all workers. */
  close(): Promise<void>;
}

/** Everything the indexer needs from the outside world. */
export interface IndexerDeps {
  /** Workspace being indexed. */
  ws: WorkspaceInfo;
  /** Workspace SQLite (tables prefixed `idx_`). */
  db: SqlDb;
  /** Git access (works for shadow repos via GIT_DIR). */
  git: GitReader;
  /** Hashing. */
  hasher: Hasher;
  /** Logger (`idx`). */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Parse worker pool factory; size = clamp(ceil(MB/2), 1, min(8, cores-2)). */
  parsePool: (size: number) => WorkerPool<ParseRequest, ParseResponse>;
  /** Settings accessor (include/exclude/deny globs). */
  settings: () => EffectiveSettings;
  /** SSE events (`scan.progress`, `scan.done`, `index.changed`, `map.updated`). */
  events: EventSink<SseEventPayload>;
}

/* ---------------------------------------------------------------------------
 * Main service
 * ------------------------------------------------------------------------- */

/** Options of a full scan. */
export interface ScanOptions {
  /** Ignore caches and re-parse everything. */
  force?: boolean;
  /** Stop after this stage (tests/benchmarks). */
  until?: "S0" | "S1" | "S2" | "S3" | "S4";
  /** Cancellation. */
  signal?: Cancel;
}

/** A filesystem change reported by the watcher (debounced ~30 ms by the server). */
export interface FsChange {
  /** Path. */
  path: RepoPath;
  /** Kind. */
  kind: "add" | "change" | "delete";
}

/** What an incremental update changed (input to anchor re-anchoring and gen S9 early cutoff). */
export interface IndexDelta {
  /** New snapshot. */
  snapshot: RepoSnapshot;
  /** Files whose blob changed: old → new. */
  changed: { path: RepoPath; oldBlob: GitOid | null; newBlob: GitOid | null }[];
  /** Files where only bodies changed (all sigHashes equal). */
  bodyOnly: RepoPath[];
  /** Modules whose `ifaceDigest` changed. */
  ifaceChanged: ModuleId[];
  /** Modules whose membership changed (re-clustered). */
  membershipChanged: ModuleId[];
  /** True when facts (routes/schema/entries) changed ⇒ overview may need regeneration. */
  factsChanged: boolean;
}

/** Text of a file range. */
export interface CodeSlice {
  /** Path. */
  path: RepoPath;
  /** Blob. */
  blob: GitOid;
  /** First line. */
  start: LineNo;
  /** Last line. */
  end: LineNo;
  /** Text; when `numbered`, each line is prefixed `N|`. */
  text: string;
  /** Lines carry `N|` prefixes (citations need them; +12–14 % tokens). */
  numbered: boolean;
  /** Estimated tokens. */
  tokens: number;
}

/** Skeleton tiers (research 04 §2.3; only `sig` and `doc` keep line numbers and support citations). */
export type SkeletonTier = "l0" | "sig" | "doc";

/** Skeleton target. */
export type SkeletonTarget =
  | {
      /** One file. */
      kind: "file";
      /** Path. */
      path: RepoPath;
    }
  | {
      /** All member files of a module. */
      kind: "module";
      /** Module. */
      module: ModuleId;
    }
  | {
      /** Whole repo (L0 only — 1 declaration per line). */
      kind: "repo";
    };

/** A rendered skeleton. */
export interface Skeleton {
  /** Tier. */
  tier: SkeletonTier;
  /** Text (deterministic, byte-stable for a given index digest). */
  text: string;
  /** Estimated tokens for the requested tokenizer. */
  tokens: number;
  /** Files covered. */
  files: RepoPath[];
  /** Cache key. */
  key: Xxh3;
}

/** Repo context pack (S4): the shared, cacheable prefix for every LLM call (~10k tokens). */
export interface RepoPack {
  /** Deterministic text (MBF-style tagged lines; byte-identical per index digest ⇒ prompt cache hits). */
  text: string;
  /** Estimated tokens. */
  tokens: number;
  /** Index digest it was built from. */
  indexDigest: Xxh3;
  /** Parts and their sizes (estimate breakdown). */
  parts: { name: "repo_map" | "module_tree" | "facts" | "glossary_seed" | "existing_docs"; tokens: number }[];
}

/** Graph export for diagrams. */
export interface GraphData {
  /** Level. */
  level: "module" | "file";
  /** Nodes. */
  nodes: { id: string; label: string; module?: ModuleId; path?: RepoPath; rank: number; loc: number }[];
  /** Weighted edges. */
  edges: { from: string; to: string; kind: GraphEdgeKind; weight: number }[];
}

/** File query. */
export interface FileQuery {
  /** Glob filter. */
  glob?: string;
  /** Class filter. */
  classes?: FileClass[];
  /** Module filter. */
  module?: ModuleId;
  /** Include excluded files. */
  includeExcluded?: boolean;
}

/** The indexer service (one per workspace). */
export interface Indexer {
  /** Full scan S0→S4. Emits `scan.progress`/`scan.done`. Idempotent; warm when nothing changed. */
  scan(opts?: ScanOptions): Promise<ScanSummaryView>;
  /** Incremental update for watcher batches. Must finish ≤ 15 ms per changed file (warm). */
  update(changes: FsChange[], signal?: Cancel): Promise<IndexDelta>;
  /** Current snapshot (null before the first scan). */
  snapshot(): RepoSnapshot | null;
  /** Files. */
  files(q?: FileQuery): FileEntry[];
  /** One file. */
  file(path: RepoPath): FileEntry | null;
  /** Read a range at the CURRENT blob (or a given blob). Lines are 1-based inclusive. */
  read(path: RepoPath, range?: { start: LineNo; end: LineNo }, opts?: { blob?: GitOid; numbered?: boolean }): Promise<CodeSlice>;
  /** Raw blob text (anchor engine uses it for old-vs-new diffs). */
  blobText(blob: GitOid): Promise<string>;
  /** Symbols of a file. */
  symbols(path: RepoPath): SymbolEntry[];
  /** Smallest symbol enclosing a range (citation stamping). */
  enclosingSymbol(path: RepoPath, start: LineNo, end: LineNo): SymbolEntry | null;
  /** Lookup by key. */
  symbol(key: SymbolKey): SymbolEntry | null;
  /** Fuzzy symbol search (MCP `find_symbol`, Code peek "go to definition"). */
  findSymbols(query: string, limit: number): SymbolEntry[];
  /** Modules (tree via parent/children). */
  modules(): ModuleInfo[];
  /** One module. */
  module(id: ModuleId): ModuleInfo | null;
  /** Graph at module or file level. */
  graph(level: "module" | "file", focus?: string): GraphData;
  /** Static facts. */
  facts(kind?: FactKind): Fact[];
  /** Skeleton of a target. */
  skeleton(target: SkeletonTarget, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton;
  /** "Hot bodies" for a module within a token budget (≤ 25 % of module input): PageRank, entry reachability, fan-in, complexity. */
  hotBodies(module: ModuleId, budgetTokens: number, tokenizer: TokenizerId): CodeSlice[];
  /** Repo context pack (S4). */
  repoPack(tokenizer: TokenizerId): RepoPack;
  /** Server-side search (FTS5 trigram; 1–2 char queries fall back to LIKE). */
  search(q: string, kinds: SearchKind[], limit: number): SearchHit[];
  /** Palette entries contributed by the index (files, symbols, modules); doc adds sections/terms. */
  paletteItems(): PaletteIndex["items"];
  /** Token estimate for arbitrary text using calibrated coefficients. */
  estimateTokens(text: string, kind: TextKind, tokenizer: TokenizerId): number;
  /** Feed an observed (estimated, actual) pair to the EMA calibrator. */
  calibrate(sample: { kind: TextKind; tokenizer: TokenizerId; chars: number; tokens: number }): void;
  /** Release workers and statements. */
  close(): Promise<void>;
}

/** Factory (implementation in packages/indexer/src/index.ts). */
export declare function createIndexer(deps: IndexerDeps): Indexer;

/** SQLite migrations owned by the indexer (`idx_*` tables). */
export declare const INDEXER_MIGRATIONS: readonly Migration[];

/* ---------------------------------------------------------------------------
 * Extension points
 * ------------------------------------------------------------------------- */

/** Language plugin: grammar + queries + import resolution + skeleton rules. */
export interface LanguagePlugin {
  /** Language id. */
  id: SourceLang;
  /** File extensions (lowercase, with dot). */
  extensions: readonly string[];
  /** Grammar wasm asset name (embedded via `import … with { type: "file" }`). */
  wasm: string;
  /** tags.scm-style query source (definitions/references/imports). */
  tagsQuery: string;
  /** Extractor version (participates in every cache key). */
  version: ExtractorVersion;
  /** Resolve an import specifier to repo files (tsconfig paths, go.mod module path, python packages, cargo crates). */
  resolveImport(spec: string, fromPath: RepoPath, ctx: ImportContext): RepoPath[];
  /** Test-file heuristic (`*_test.go`, `test_*.py`, `*.test.ts`, …). */
  isTestFile(path: RepoPath): boolean;
}

/** Context for import resolution. */
export interface ImportContext {
  /** True when a repo path exists. */
  exists(path: RepoPath): boolean;
  /** Project configs (tsconfig.json, go.mod, pyproject.toml, Cargo.toml) parsed once per scan. */
  config(name: "tsconfig" | "gomod" | "pyproject" | "cargo"): unknown;
}

/** Static fact detector (routes, CLI, env, schema, entries, scripts…). Pure over parse results + text. */
export interface FactDetector {
  /** Id with version, e.g. `route.hono@1`. */
  id: string;
  /** Kinds produced. */
  kinds: readonly FactKind[];
  /** Cheap applicability check (extension/path/content sniff). */
  appliesTo(file: FileEntry): boolean;
  /** Detect facts in one file. */
  detect(input: { file: FileEntry; text: string; tree?: unknown }): Fact[];
}

/** Inventory filter rule (S0). Order matters; first match wins. */
export interface InventoryRule {
  /** Rule id. */
  id: string;
  /** Class assigned. */
  class: FileClass;
  /** Exclusion reason (if excluded). */
  exclude?: ExcludeReason;
  /** Matcher. */
  match(input: { path: RepoPath; size: number; head: Uint8Array; avgLineLen?: number }): boolean;
}

/* ---------------------------------------------------------------------------
 * Worker protocol (S1)
 * ------------------------------------------------------------------------- */

/** Parse request sent to a WASM tree-sitter worker. */
export interface ParseRequest {
  /** Path. */
  path: RepoPath;
  /** Blob. */
  blob: GitOid;
  /** Language. */
  lang: SourceLang;
  /** Source bytes (transferred). */
  source: Uint8Array;
}

/** Parse result. Workers MUST call `tree.delete()` before replying (deterministic memory). */
export interface ParseResponse {
  /** Path. */
  path: RepoPath;
  /** Blob. */
  blob: GitOid;
  /** Symbols. */
  symbols: Omit<SymbolEntry, "path" | "blob">[];
  /** Import specifiers as written. */
  imports: { spec: string; line: LineNo; kind: "static" | "dynamic" | "type" }[];
  /** Name references (deduped, line numbers kept for IDF-weighted ref edges). */
  refs: { name: string; line: LineNo }[];
  /** Physical lines. */
  lines: number;
  /** Parse errors count (partial trees are still used). */
  errors: number;
  /** Worker time. */
  ms: number;
}

/*
 * TODO(indexer spec):
 *  - S0 rules table (vendored/minified: `.min.*`, avg line > 300, `vendor/`, `dist/`, linguist attrs;
 *    data JSON > 50KB; lockfiles; NUL-byte binaries; > 2MB oversize; secret globs), exact order.
 *  - Shadow repo flow for non-git dirs (GIT_DIR under ~/.mitori/repos/<k>/shadow.git, default ignores).
 *  - Leiden with directory prior: choose ngraph.leiden (initial partition?) or in-house refine (research addendum A6);
 *    leaf size 2–6k LOC & skeleton ≤ 24k tokens; depth ≤ 3; fan-out ≈ 10; stable ModuleId matching (Jaccard ≥ 0.5).
 *  - Ref-edge weighting: import-resolved edges 1.0, refs sqrt(n)·IDF with generic-name damping, same-dir 0.2.
 *  - Skeleton formats (byte-exact examples + golden tests) for l0/sig/doc; struct fields kept; `⋮` elision; 60-line cap.
 *  - Repo pack layout (~10k tokens) and its determinism test (same digest ⇒ same bytes).
 *  - Calibration persistence (`use_calibration` in state.sqlite) shared with the agent package.
 *  - Linux watcher decision input: measure Bun recursive fs.watch vs `git ls-files -m -o` polling (addendum A5).
 *  - Table schema (`idx_files`, `idx_blobs`, `idx_symbols`, `idx_imports`, `idx_edges`, `idx_modules`, `idx_facts`,
 *    `idx_skeleton`, `idx_search` FTS5 trigram) and migrations.
 */
