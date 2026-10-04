/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/indexer.ts` — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/indexer.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

/**
 * @file mitori — indexer contract (package `@mitori/indexer`, stages S0–S4 + incremental).
 *
 * Status: DOMAIN CONTRACT. Owner: indexer spec (`docs/design/specs/indexer.md`, 1:1 with this file;
 * when they disagree the types here win, the prose there wins). Change requests CR-1…CR-13 (spec appendix B)
 * were applied to core/api in revision R1 (`contracts/CR-LEDGER.md`); the former local stand-ins are now
 * aliases of the core types (IndexerFs = FsReader, SecretScanner, WriteQueue, WorkerPool, CalibrationSnapshot).
 *
 * Responsibilities: inventory + filtering (S0), parsing in a WASM Worker pool fused with per-file
 * fact extraction (S1), fact linking (S2), structure — import resolution, graph, directory-prior
 * deterministic Leiden, PageRank, Tarjan SCC, stable module ids (S3), context packs / skeletons /
 * hot bodies (S4), incremental update on file change, search + palette indexes, token estimation.
 * Zero tokens: the indexer never calls an LLM.
 *
 * Budgets (bench/budgets.json, spec §11.3): S0–S1 cold ≤ 0.3 s @100k LOC (limit 0.5), ≤ 1.2 s
 * @7k files/100MB (limit 1.5); S0–S4 ≤ 1.0 s @100k LOC (limit 2.0); warm rescan ≤ 10 ms (limit 25);
 * update() ≤ 15 ms per file (limit 30); save → doc.freshness ≤ 50 ms (limit 1 s); peak RSS ≤ 700 MB
 * (limit 1 GB); repo pack 10k ± 15 % tokens (cap 12k).
 */

import type {
  CalibrationSnapshot,
  Cancel,
  Clock,
  CodeSlice,
  EffectiveSettings,
  EventSink,
  ExcludeReason,
  ExtractorVersion,
  Fact,
  FactKind,
  FileClass,
  FileEntry,
  FsReader,
  GitOid,
  GitReader,
  GraphEdgeKind,
  HardwareInfo,
  Hasher,
  IndexDelta,
  Iso8601,
  LineNo,
  Logger,
  Metrics,
  ModuleId,
  ModuleInfo,
  PaletteIndex,
  RepoPath,
  RepoProfile,
  RepoSnapshot,
  ScanStage,
  ScanSummaryView,
  SearchHit,
  SearchKind,
  SecretScanner,
  SourceLang,
  SqlDb,
  SseEventPayload,
  SymbolEntry,
  SymbolKey,
  SymbolKind,
  TextKind,
  TokenizerId,
  WorkerPool,
  WorkspaceInfo,
  WriteQueue,
  Xxh3,
} from "@mitori/core";

/* ============================================================================
 * A. Versions and constants (pure data; mirrored by golden tests in packages/indexer/test)
 * ========================================================================== */

/** Format / algorithm versions. Bump the matching integer on ANY behavioural change (cache keys use them). */
export const INDEXER_FORMAT = {
  /** Extraction code version (qualname/signature/doc/hash rules). Part of every ExtractorVersion (`q8`). */
  extractorCode: 1,
  /**
   * Fact detector set version (bumped whenever any detector `@ver` changes, or a detector's candidate payload does:
   * 2 = route handler candidate lists, gen #4c).
   */
  detectors: 2,
  /** Structure algorithm version (graph weights, Leiden, id matching). Part of the structure cache key. */
  structure: 1,
  /** Skeleton rendering version (spec §7.1). Part of `idx_skeleton` keys via the extractor version. */
  skeleton: 1,
  /** Repo pack format tag (first line of the pack). */
  pack: "mitori.repopack/1",
  /** indexDigest framing prefix (spec §2.2). */
  digest: "mitori.idx/1",
} as const;

/** Grammar ids (a SourceLang maps to one grammar; Flow-annotated js/jsx switch to `tsx`, spec IDX-D5). */
export type GrammarId = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust";

/** Pinned grammars embedded in the binary (spec §3.2). `wasm` is the asset name used by `scripts/gen-assets.ts`. */
export const GRAMMARS = {
  typescript: { npm: "tree-sitter-typescript", version: "0.23.2", wasm: "tree-sitter-typescript.wasm" },
  tsx: { npm: "tree-sitter-typescript", version: "0.23.2", wasm: "tree-sitter-tsx.wasm" },
  javascript: { npm: "tree-sitter-javascript", version: "0.25.0", wasm: "tree-sitter-javascript.wasm" },
  python: { npm: "tree-sitter-python", version: "0.25.0", wasm: "tree-sitter-python.wasm" },
  go: { npm: "tree-sitter-go", version: "0.25.0", wasm: "tree-sitter-go.wasm" },
  rust: { npm: "tree-sitter-rust", version: "0.24.0", wasm: "tree-sitter-rust.wasm" },
} as const satisfies Record<GrammarId, { npm: string; version: string; wasm: string }>;

/** The WASM runtime. */
export const TREE_SITTER_RUNTIME = { npm: "web-tree-sitter", version: "0.27.0", wasm: "web-tree-sitter.wasm" } as const;

/** Default grammar per SourceLang (`null` = generic line-based extraction). */
export const LANG_GRAMMAR = {
  typescript: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  jsx: "javascript",
  python: "python",
  go: "go",
  rust: "rust",
  java: null,
  csharp: null,
  php: null,
  generic: null,
} as const satisfies Record<SourceLang, GrammarId | null>;

/** S0 thresholds (spec §2.3). Values marked [仮] in the spec are measured in P0 and may change. */
export const INVENTORY_LIMITS = {
  /** R07: files larger than this are `oversize` and never read. */
  oversizeBytes: 2_097_152,
  /** R15: data-like files larger than this are `data_large`. */
  dataLargeBytes: 51_200,
  /** R12: average bytes per line above which non-doc text is `minified`. */
  minifiedAvgLineBytes: 300,
  /** R12: files of at most this many LF with more than `minifiedFewLinesBytes` bytes are `minified`. */
  minifiedFewLines: 3,
  /** R12 companion threshold. */
  minifiedFewLinesBytes: 5_120,
  /** R12 does not apply below this size. */
  minifiedMinBytes: 1_024,
  /** R11: bytes inspected for NUL / invalid UTF-8. */
  binarySniffBytes: 8_000,
  /** R11: invalid UTF-8 byte ratio above which a file is binary [仮]. */
  invalidUtf8Ratio: 0.3,
  /** R13: header lines inspected for generated markers. */
  generatedHeaderLines: 5,
  /** R13: header bytes inspected. */
  generatedHeaderBytes: 1_024,
  /** IDX-D5: bytes inspected for `@flow`. */
  flowSniffBytes: 2_048,
  /** Shadow guard: refuse directories with more entries than this [仮]. */
  shadowMaxEntries: 200_000,
  /** Shadow guard: refuse directories larger than this many bytes [仮]. */
  shadowMaxBytes: 5_368_709_120,
  /** Racy window: entries whose mtime is within this many ms of the scan start are re-hashed next time. */
  racyWindowMs: 3_000,
} as const;

/** Ordered S0 rule ids (first match wins; spec §2.3). */
export const INVENTORY_RULE_ORDER = [
  "R00.special",
  "R01.deny",
  "R02.user_exclude",
  "R03.include",
  "R04.secret_name",
  "R05.lockfile",
  "R06.binary_ext",
  "R07.oversize",
  "R08.vendored",
  "R09.generated_path",
  "R10.minified_name",
  "R11.binary_content",
  "R12.minified_content",
  "R13.generated_header",
  "R14.fixture",
  "R15.data_large",
  "R16.test",
  "R17.docs",
  "R18.config",
  "R19.source",
  "R20.fallback",
] as const;

/** S0 rule id. */
export type InventoryRuleId = (typeof INVENTORY_RULE_ORDER)[number];

/**
 * Name sets and regular expressions of S0 (spec §2.3). Regex values are `RegExp` sources (case
 * flags in `flags`). Golden tests assert the implementation's tables equal these.
 */
export const INVENTORY_SETS = {
  secretName: {
    source: String.raw`(^|/)(\.env(\..*)?|\.dev\.vars|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials\.json|service[-_]account[^/]*\.json)$|\.(pem|key|p12|pfx|jks|keystore|kdbx)$`,
    flags: "i",
  },
  lockfiles: [
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "deno.lock",
    "Cargo.lock", "go.sum", "go.work.sum", "poetry.lock", "Pipfile.lock", "uv.lock", "pdm.lock", "composer.lock",
    "Gemfile.lock", "flake.lock", "mix.lock", "Podfile.lock", "packages.lock.json", "gradle.lockfile", "pubspec.lock",
  ],
  binaryExts: [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "icns", "bmp", "tif", "tiff", "psd", "svg", "woff", "woff2",
    "ttf", "otf", "eot", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "tar", "mp3", "mp4", "m4a", "mov", "webm",
    "wav", "ogg", "flac", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "exe", "dll", "so", "dylib", "a", "o",
    "obj", "class", "jar", "war", "wasm", "pyc", "pyo", "sqlite", "sqlite3", "db", "bin", "dat", "pkl", "npy", "npz",
    "parquet", "onnx", "pt", "ckpt",
  ],
  vendorSegments: [
    "node_modules", "vendor", "third_party", "third-party", "thirdparty", "bower_components", "jspm_packages", ".yarn",
    "Pods", "Carthage", "__vendor__",
  ],
  generatedSegments: ["dist", ".next", ".nuxt", ".svelte-kit", ".output", "coverage", "__generated__", "generated"],
  generatedName: {
    source: String.raw`(\.pb\.go|_pb2(_grpc)?\.py|\.pb\.(ts|js)|_pb\.(js|ts|d\.ts)|\.generated\.[a-z]+|_generated\.[a-z]+|\.gen\.(go|ts|js)|\.g\.dart|\.designer\.cs|\.map)$`,
    flags: "i",
  },
  minifiedName: { source: String.raw`(\.min\.(js|mjs|css)|-min\.js|\.bundle\.js|\.chunk\.js)$`, flags: "i" },
  /** Applied to comment lines among the first 5 lines (comment markers stripped, and to the whole line). */
  generatedHeader: [
    { source: String.raw`^// Code generated .* DO NOT EDIT\.$`, flags: "" },
    { source: String.raw`@generated\b`, flags: "" },
    { source: String.raw`\b(this|the) (file|code) (is|was|has been) (automatically |auto-?|machine[- ])?generated\b`, flags: "i" },
    { source: String.raw`^(auto-?generated|automatically generated|generated) (file|code|by|from|with|using)\b`, flags: "i" },
    { source: String.raw`\bgenerated\b.*\bdo not (edit|modify)\b|\bdo not (edit|modify)\b.*\bgenerated\b`, flags: "i" },
  ],
  fixtureSegments: ["testdata", "fixture", "fixtures", "__fixtures__", "__snapshots__", "snapshots"],
  testSegments: ["test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "playwright", "benches", "bench", "benchmark", "benchmarks"],
  exampleSegments: ["example", "examples", "sample", "samples", "demo", "demos", "docs_src", "playground"],
  dataExts: ["json", "jsonl", "ndjson", "csv", "tsv", "xml", "yaml", "yml", "geojson", "txt", "log", "har", "ipynb"],
  docExts: ["md", "mdx", "markdown", "rst", "adoc", "asciidoc"],
  docName: {
    source: String.raw`(^|/)(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|LICENSE|LICENCE|NOTICE|AUTHORS|SECURITY|CODE_OF_CONDUCT|CLAUDE|AGENTS)(\.[A-Za-z]+)?$`,
    flags: "i",
  },
  configName: {
    source: String.raw`(^|/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|deno\.jsonc?|bunfig\.toml|biome\.jsonc?|\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|\.prettierrc[^/]*|wrangler\.(toml|jsonc?)|vercel\.json|netlify\.toml|Dockerfile[^/]*|[^/]*\.dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|Procfile|Makefile|makefile|GNUmakefile|[^/]*\.mk|[Jj]ustfile|Taskfile\.ya?ml|flake\.nix|default\.nix|shell\.nix|pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini|mypy\.ini|ruff\.toml|\.flake8|requirements[^/]*\.txt|Pipfile|environment\.ya?ml|go\.mod|go\.work|Cargo\.toml|rust-toolchain(\.toml)?|Gemfile|[^/]*\.gemspec|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|\.gitattributes|\.gitignore|\.editorconfig|\.nvmrc|\.node-version|\.tool-versions|\.python-version|\.gitlab-ci\.yml|[^/]*\.config\.[cm]?[jt]s)$`,
    flags: "",
  },
  configExts: ["toml", "ini", "cfg", "conf", "yaml", "yml", "json", "jsonc", "json5", "nix", "properties"],
  codeExts: [
    "java", "kt", "kts", "swift", "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "cs", "php", "rb", "scala", "lua", "sh",
    "bash", "zsh", "fish", "ps1", "sql", "css", "scss", "sass", "less", "html", "htm", "vue", "svelte", "astro", "ex",
    "exs", "erl", "hs", "ml", "mli", "clj", "cljs", "dart", "r", "jl", "m", "mm", "zig", "nim", "sol", "tf", "hcl",
    "proto", "graphql", "gql", "prisma", "el", "vim", "groovy", "pl", "pm",
  ],
  /** Shadow repo `info/exclude` (spec §2.1-b). */
  shadowExcludes: [
    ".git/", "node_modules/", ".venv/", "venv/", "env/", "__pycache__/", "*.pyc", "target/", "dist/", "build/", "out/",
    ".next/", ".nuxt/", ".cache/", ".turbo/", "coverage/", ".DS_Store", "Thumbs.db", "*.log", ".mitori/",
  ],
} as const;

/** Exclusion reasons (CR-2 applied in core R1: `special` and `fixture` are core `ExcludeReason`s). */
export type IndexerExcludeReason = ExcludeReason;

/** Parse pool sizing and Worker hygiene (spec §3.1, §3.3, §3.7). */
export const PARSE_POOL = {
  /** W = clamp(ceil(parseMB / mbPerWorker), 1, min(maxWorkers, cores − reserveCores, perfCores)) [仮]. */
  mbPerWorker: 0.75,
  /** Hard cap. */
  maxWorkers: 8,
  /** Cores left for the main thread and the OS. */
  reserveCores: 2,
  /** Batch: at most this many files. */
  batchMaxFiles: 64,
  /** Batch byte bound = clamp(totalBytes / (W · batchesPerWorker), batchMinBytes, batchMaxBytes). */
  batchesPerWorker: 8,
  /** Lower batch byte bound. */
  batchMinBytes: 32_768,
  /** Upper batch byte bound. */
  batchMaxBytes: 1_048_576,
  /** Shrink to 0 Workers after this long without an SSE client or update. */
  idleShrinkMs: 60_000,
  /** Recycle a Worker after this many parsed files [仮]. */
  recycleFiles: 50_000,
  /** … or after this many parsed bytes [仮]. */
  recycleBytes: 536_870_912,
  /** Per-file parse timeout (progressCallback) [仮]. */
  parseTimeoutMs: 250,
  /** Budget of the one retry after a timeout (wall time: a loaded machine must not change the index) [CR rdoc-4]. */
  parseRetryMs: 8_000,
  /** Files whose ERROR-node bytes exceed this share keep defs only (`degraded`) [仮]. */
  degradedErrorRatio: 0.3,
  /** Folded refs per file cap [仮]. */
  refsPerFileMax: 10_000,
  /** Trees kept per warm Worker for `tree.edit` incremental reparse. */
  lruTrees: 8,
  /** Only files above this size keep their tree in the LRU. */
  lruTreeMinBytes: 65_536,
} as const;

/** Query capture names (spec §3.4). `_`-prefixed helper captures are ignored by extraction. */
export const CAPTURE_NAMES = [
  "name",
  "def.function",
  "def.method",
  "def.class",
  "def.interface",
  "def.type",
  "def.enum",
  "def.namespace",
  "def.module",
  "def.struct",
  "def.trait",
  "def.impl",
  "def.const",
  "def.var",
  "def.field",
  "def.macro",
  "def.package",
  "doc",
  "doc.module",
  "import.source",
  "import.name",
  "import.dynamic",
  "import.mod",
  "export.name",
  "export.source",
  "ref.call",
  "ref.new",
  "ref.type",
  "ref.jsx",
  "ref.qual.pkg",
  "ref.qual.name",
] as const;

/** A capture name of the tags-query contract. */
export type CaptureName = (typeof CAPTURE_NAMES)[number];

/** Parse profile: `full` (source), `lite` (tests: no type/qualified refs), `text` (no tree; docs/config/data). */
export type ParseProfile = "full" | "lite" | "text";

/** Captures disabled in the `lite` profile (via `Query.disableCapture`). */
export const LITE_DISABLED_CAPTURES = ["ref.type", "ref.qual.pkg", "ref.qual.name"] as const satisfies readonly CaptureName[];

/** Structure parameters (spec §4.6, §6). [仮] values are tuned by bench/indexer.bench.ts §11.4. */
export const STRUCTURE_PARAMS = {
  /** Resolved import edge weight. */
  importWeight: 1.0,
  /** Barrel re-export edge weight [仮]. */
  reexportWeight: 0.5,
  /** Name-reference edge scale λ_ref [仮]. */
  lambdaRef: 0.5,
  /** Go same-package precise reference scale λ_pkg [仮]. */
  lambdaPkg: 0.8,
  /** Names defined in more files than this are ignored for name refs. */
  maxDefsPerName: 20,
  /** Names defined in at least this many files get ×0.1 (aider rule). */
  dampDefsPerName: 6,
  /** Directory prior strength per node. */
  sameDirStrength: 0.2,
  /** Directories with at most this many files get a complete prior graph; larger ones a ring (±2). */
  sameDirCompleteMax: 30,
  /** Module-level dependency threshold (sum of file edge weights). */
  moduleEdgeMin: 1.0,
  /** Leaf LOC lower bound (merge below). */
  leafLocMin: 2_000,
  /** Leaf LOC target (γ search aims at this median). */
  leafLocTarget: 4_000,
  /** Leaf LOC soft upper bound. */
  leafLocMax: 6_000,
  /** Leaf LOC hard cap (split above). */
  leafLocHard: 9_000,
  /** Leaf sig-skeleton token cap. */
  leafSkeletonTokensMax: 24_000,
  /** Parent fan-out target / window. */
  fanoutTarget: 10,
  /** Fan-out lower bound. */
  fanoutMin: 5,
  /** Fan-out upper bound. */
  fanoutMax: 15,
  /** Max hierarchy depth including leaves. */
  maxDepth: 3,
  /** γ search range (log scale) and steps. */
  gammaMin: 0.05,
  /** γ upper bound. */
  gammaMax: 20,
  /** γ binary-search steps. */
  gammaSteps: 8,
  /** Move hysteresis for nodes still in their warm-start community [仮]. */
  hysteresis: 1e-4,
  /** Max Leiden levels. */
  maxLevels: 10,
  /** Module id match threshold (LOC-weighted Jaccard). */
  jaccardMatch: 0.5,
  /** Split lineage threshold. */
  splitLineage: 0.3,
  /** Seed representative paths per module (CR-1). */
  seedReps: 32,
  /** Seed hit threshold. */
  seedHit: 0.5,
  /** Tombstone retention [仮]. */
  tombstoneDays: 90,
  /** Dominant-dir share of member LOC. */
  dominantDirShare: 0.6,
  /** PageRank damping. */
  pagerankAlpha: 0.85,
  /** PageRank L1 tolerance. */
  pagerankTol: 1e-6,
  /** PageRank max iterations. */
  pagerankMaxIter: 100,
  /** Quiet period before a structure refresh [仮]. */
  refreshQuietMs: 2_000,
  /** Re-run Leiden when this share of files changed since the last run. */
  reclusterChangedRatio: 0.1,
  /** Max cross-file hops when composing route mount prefixes [仮]. */
  mountHops: 3,
} as const;

/** PageRank personalization multipliers (spec §6.4) [仮]. */
export const PAGERANK_PERSONALIZATION = {
  entry: 5,
  routeHandler: 3,
  cli: 3,
  exportDense: 1.5,
  exportDenseMinSymbols: 5,
  example: 0.3,
  tooling: 0.5,
} as const;

/** Slug noise segments dropped when building a module slug (spec §6.6). */
export const SLUG_NOISE_SEGMENTS = ["src", "lib", "pkg", "packages", "crates", "app"] as const;

/** Skeleton rendering rules (spec §7.1). */
export const SKELETON_RULES = {
  /** Body elision line (U+22EE), alone on a line, no number. */
  elision: "⋮",
  /** Callable header lines printed at most. */
  callableHeaderMaxLines: 8,
  /** Type-like symbol lines printed at most (then `⋮ +<k> lines`). */
  typeMaxLines: 60,
  /** Doc lines per symbol at most (doc tier). */
  docMaxLines: 12,
  /** l0 signature truncation. */
  l0SignatureMax: 120,
  /** Imports listed in a sig/doc file header. */
  headerImportsMax: 12,
  /** Header separator (U+00B7). */
  headerSep: " · ",
} as const;

/** Hot-body selection (spec §7.3) [仮 weights]. */
export const HOT_BODY_RULES = {
  /** Score weights. */
  weights: { pr: 0.3, reach: 0.25, fanin: 0.25, cx: 0.2 },
  /** Non-exported multiplier on `pr`. */
  privatePrFactor: 0.7,
  /** Reach score for direct entry handlers / main / tested subjects. */
  reachDirect: 1.0,
  /** Reach score within 2 call hops. */
  reachNear: 0.6,
  /** Max share of the module input taken by hot bodies. */
  maxShare: 0.25,
  /** Bodies longer than this are truncated to `longBodyHead` lines + `⋮`. */
  longBodyLines: 200,
  /** Head lines kept for long bodies. */
  longBodyHead: 80,
  /** Stop after this many consecutive candidates that do not fit. */
  maxConsecutiveSkips: 3,
} as const;

/** Repo pack part budgets in `claude-v5` tokens (spec §7.4) [仮]. */
export const REPO_PACK_BUDGET = {
  target: 10_000,
  tolerance: 0.15,
  cap: 12_000,
  /** First line (`# mitori.repopack/1 …`); counted in `module_tree`. */
  header: 60,
  moduleTree: 1_500,
  facts: 2_900,
  glossarySeed: 400,
  existingDocs: 800,
  /** Max lines per facts subsection. */
  lines: { entry: 6, routes: 40, cli: 30, env: 40, schema: 20, schemaFields: 12, scripts: 15, deps: 30, terms: 40, docs: 6, docHeadings: 8, modules: 60 },
  /** Max characters of one value before `…`. */
  valueMaxChars: 160,
} as const;

/**
 * Rationale comments (gen spec §5.2 `COMMENTS`, request I5). Applied case-insensitively to comment nodes in the Worker;
 * license headers and TODO lines are skipped.
 */
export const RATIONALE_COMMENT_RE = {
  source: String.raw`because|since|so that|instead of|rather than|we (use|chose|need)|note|hack|workaround|trade-?off|rationale|why|ため|なぜ|理由|代わりに|回避`,
  flags: "i",
} as const;

/**
 * Every line the indexer hands to gen (skeleton, hot bodies, rationale slices, repo pack) starts with one of these
 * (gen spec §5.1-5, request I1). `<digit>|` is the numbered-line form.
 */
export const PACKED_LINE_PREFIXES = ["=== ", "> ", "\u22EE"] as const;

/** CJK ranges counted at the `markdown_ja` ratio by the token estimator (spec §7.6). Inclusive UTF-16 code unit ranges. */
export const CJK_RANGES = [
  [0x3000, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
  [0xac00, 0xd7af],
] as const satisfies readonly (readonly [number, number])[];

/** Search / palette limits (spec §8). */
export const SEARCH_LIMITS = {
  ftsRows: 50_000,
  ftsChunkRows: 5_000,
  paletteFiles: 20_000,
  paletteSymbols: 25_000,
  paletteTotal: 45_000,
  graphFileNodes: 300,
  graphModuleLeavesBeforeParents: 40,
  graphEdgesPerNode: 3,
} as const;

/* ============================================================================
 * B. Ports and dependencies (injected by @mitori/server; implemented in @mitori/platform)
 * ========================================================================== */

/** Read-only filesystem port = core `FsReader` (CR-8 applied in R1). Paths are absolute. */
export type IndexerFs = FsReader;

/**
 * Calibration view = core `CalibrationSnapshot` (CR-7 applied; R1 CONS-24): the indexer applies ONLY the
 * `kind:*` chars/token factors. Per-call (intent × model) correction belongs to the caller's estimator
 * (gen / loop) via the ledger — `estimateTokens` never applies it (no double correction).
 */
export type IndexerCalibration = CalibrationSnapshot;

/** An exact token count of a single-kind text (anthropic-api `count_tokens`, `mitori doctor --calibrate`). */
export interface CalibrationSample {
  /** Tokenizer. */
  tokenizer: TokenizerId;
  /** Text kind. */
  kind: TextKind;
  /** UTF-16 code units of the text. */
  chars: number;
  /** CJK code units among them. */
  cjk: number;
  /** Exact tokens. */
  tokens: number;
  /** Where the count came from. */
  source: "count_tokens" | "probe";
}


/** Hardware facts used for pool sizing (spec §3.1) — moved to `@mitori/core` [CR m1-116]; re-exported. */
export type { HardwareInfo } from "@mitori/core";

/** Module identity seed recovered from a committed doc (`doc.index.json` modules; CR-1). */
export interface ModuleSeed {
  /** Module id. */
  id: ModuleId;
  /** Slug (file name of `doc/modules/<slug>.md`). */
  slug: string;
  /** Display name. */
  name: string;
  /** Parent id. */
  parent?: ModuleId;
  /** Representative member paths (≤ 32, PageRank-ranked, stored sorted). */
  reps: RepoPath[];
  /** Every member path of a leaf (doc.index.json `members`): the seeded warm start reproduces the partition (EX-01). */
  members?: RepoPath[];
}

/** Everything the indexer needs from the outside world. */
export interface IndexerDeps {
  /** Workspace being indexed. */
  ws: WorkspaceInfo;
  /** Workspace SQLite (tables prefixed `idx_`). Reads are direct; writes go through `write`. */
  db: SqlDb;
  /** Single-writer queue of the workspace. */
  write: WriteQueue;
  /** Git access (works for shadow repos via GIT_DIR/GIT_WORK_TREE). */
  git: GitReader;
  /** Filesystem (stat/read only). */
  fs: IndexerFs;
  /** Hashing. */
  hasher: Hasher;
  /** Logger (`idx`). */
  log: Logger;
  /** Clock. */
  clock: Clock;
  /** Parse worker pool factory (the server wires `packages/server/src/workers/parse.ts` → `createParseWorker`). */
  parsePool: (size: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse>;
  /** Hardware facts for pool sizing (`ServerDeps.hardware` = platform `hardwareInfo()`). */
  hardware: HardwareInfo;
  /** Settings accessor (include/exclude/deny globs, module overrides, secretScan). */
  settings: () => EffectiveSettings;
  /** SSE events (`scan.progress`, `scan.done`, `scan.failed`, `index.changed`, `map.updated`). */
  events: EventSink<SseEventPayload>;
  /** Secret scanner (core) applied to every packed / read text when `security.secretScan`; token `«redacted:secret»`. */
  secrets: SecretScanner;
  /** Token calibration (read-only; `kind:*` factors only). */
  calibration: () => IndexerCalibration;
  /** Forward validated calibration samples to @mitori/agent (which owns and persists the EMA). */
  calibrationSink: (sample: CalibrationSample) => void;
  /** Module seeds from a committed doc, used only when the index has no modules yet. Slugs are re-validated (SLUG_RE). */
  seeds: () => ModuleSeed[];
  /** Deterministic counters (`idx.*`). */
  metrics: Metrics;
}

/* ============================================================================
 * C. Scan / update API types
 * ========================================================================== */

/** Options of a full scan. */
export interface ScanOptions {
  /** Ignore caches (blob cache, structure cache) and re-parse everything. */
  force?: boolean;
  /** Stop after this stage (tests/benchmarks). */
  until?: ScanStage;
  /** Why the scan runs (logged; `git` = HEAD/index changed). */
  reason?: "open" | "manual" | "git" | "settings" | "bench";
  /** Cancellation. */
  signal?: Cancel;
}

/** Per-stage timings of the last scan (bench + logs; CR-13 proposes exposing `stages` in the API). */
export interface ScanTimings {
  /** S0a (enumeration + path rules + cache lookup) ms. */
  s0: number;
  /** Worker start (parallel) ms. */
  workersStart: number;
  /** S0b + S1 wall ms. */
  s1: number;
  /** S2 link ms. */
  s2: number;
  /** S3 ms. */
  s3: number;
  /** S4 ms. */
  s4: number;
  /** Total until `scan.done` ms. */
  total: number;
  /** Background persistence after `scan.done` ms (null while running). */
  persist: number | null;
  /** Background FTS build ms (null while running). */
  fts: number | null;
  /** Files parsed (cache misses). */
  filesParsed: number;
  /** Files served from the blob cache. */
  cacheHits: number;
  /** Workers used. */
  workers: number;
  /** Σ read ms in workers. */
  readMs: number;
  /** Σ parse ms in workers. */
  parseMs: number;
  /** Σ query ms in workers. */
  queryMs: number;
  /** Files that fell back to generic extraction (timeout / error / degraded). */
  degraded: number;
}

/**
 * A filesystem change reported by the watcher (leading 5 ms + max-wait 30 ms batching, spec §10.1). The kind is a
 * hint; `update()` decides by stat and index membership [CR m1-29]:
 * - an `add` of a path already in the index is a `change` (an editor's tmp-write + rename save arrives as
 *   `[delete tmp, add path]`): the delta carries the old blob, so the first update already marks claims stale;
 * - a `delete` of a path that exists again is a `change`; a `delete` of a path that is not an indexed file but a
 *   directory prefix of indexed files means "everything under `<path>/` is gone" (`mv a b` and moving a directory
 *   out of the tree arrive as ONE event for the directory; rename detection still pairs those files with the
 *   batch's `add`s by blob).
 */
export type FsChange =
  | {
      /** File-level change. */
      kind: "add" | "change" | "delete";
      /** Repo-relative path. */
      path: RepoPath;
      /** Bytes already read by the caller (optional; avoids a second read). */
      source?: Uint8Array;
    }
  | {
      /** `.git/index`, `HEAD`, refs changed (commit/checkout/pull) ⇒ warm scan. */
      kind: "git";
    };

/** Moved to `@mitori/core` at the M0 freeze [CR m0-1]; re-exported for compatibility. */
export type { SymbolChange } from "@mitori/core";

/** Moved to `@mitori/core` at the M0 freeze [CR m0-1]; re-exported for compatibility. */
export type { IndexDelta } from "@mitori/core";

/* ============================================================================
 * D. Query / result types
 * ========================================================================== */

/** File scope (spec §2.3). Only `main` contributes to route/cli/env main tables (IDX-D12). */
export type FileScope = "main" | "example" | "test" | "tooling";

/** File query. */
export interface FileQuery {
  /** Glob filter (picomatch). */
  glob?: string;
  /** Class filter. */
  classes?: FileClass[];
  /** Module filter (leaf; tests attached to the module included). */
  module?: ModuleId;
  /** Include excluded files. */
  includeExcluded?: boolean;
}

/** A file with indexer-internal detail (`FileEntry` is the public subset). */
export interface FileDetail extends FileEntry {
  /** Scope. */
  scope: FileScope;
  /** Grammar actually used (Flow ⇒ `tsx`), null for generic/text. */
  grammar: GrammarId | null;
  /** Display dialect for generic files (`java`, `shell`, `markdown` …). */
  dialect: string | null;
  /** Rule that classified the file. */
  rule: InventoryRuleId;
  /** Precise exclusion reason (includes `special`/`fixture`). */
  excludedExt?: IndexerExcludeReason;
  /** Tracked by git. */
  tracked: boolean;
  /** Worktree content differs from the index. */
  dirty: boolean;
  /** Extraction note. */
  note?: "parse_timeout" | "parse_error" | "degraded" | "unreadable";
  /** Extractor version used. */
  extractor?: ExtractorVersion;
}

/** Why a file is (not) part of the generation input — powers the UI's 「なぜ除外?」. */
export interface InventoryExplanation {
  /** Path. */
  path: RepoPath;
  /** Final class. */
  class: FileClass;
  /** Exclusion (precise). */
  excluded?: IndexerExcludeReason;
  /** Rule that decided. */
  rule: InventoryRuleId;
  /** Human-readable detail (English; UI maps rule ids to i18n keys `idx.rule.<id>`). */
  detail: string;
  /** Glob / attribute / threshold that matched. */
  matched?: string;
}

/** A symbol with indexer-internal detail. */
export interface SymbolDetail extends SymbolEntry {
  /** Ordinal within the file (source order). */
  ord: number;
  /** Doc text (≤ 600 chars; markers stripped). CR-3 proposes `doc?` on core `SymbolEntry`. */
  doc?: string;
  /** First doc line. */
  docStart?: LineNo;
  /** Last doc line. */
  docEnd?: LineNo;
  /** First body line. */
  bodyStart?: LineNo;
  /** Last body line. */
  bodyEnd?: LineNo;
  /** Decision-node count inside the body. */
  complexity: number;
  /** Python decorators / Rust attributes as written (≤ 4). */
  decorators?: string[];
}

/** Import kind. */
export type ImportKind = "static" | "dynamic" | "type" | "reexport" | "mod" | "asset";

/** An import statement as written (S1). */
export interface ImportRecord {
  /** Specifier as written (quotes removed; Python relative keeps the dots). */
  spec: string;
  /** Line. */
  line: LineNo;
  /** Kind. */
  kind: ImportKind;
  /** Imported names (≤ 32). */
  names: string[];
}

/** An import after resolution (S3). */
export interface ResolvedImport extends ImportRecord {
  /** Importing file. */
  from: RepoPath;
  /** Repo files it resolves to (included files only). */
  to: RepoPath[];
  /** External package / module / crate name. */
  external?: string;
  /** Standard library. */
  stdlib?: true;
}

/** A folded name reference (S1; one row per name × kind × qualifier). */
export interface RefRecord {
  /** Referenced name. */
  name: string;
  /** Reference kind. */
  kind: "call" | "new" | "type" | "jsx" | "qual";
  /** Qualifier for `qual` refs (import alias / path head). */
  qual?: string;
  /** Occurrences in the file. */
  count: number;
  /** First line. */
  firstLine: LineNo;
}

/** Config tool (spec §5.5). */
export type ConfigTool =
  | "npm" | "tsconfig" | "deno" | "bun" | "biome" | "eslint" | "prettier" | "vite" | "vitest" | "jest" | "webpack"
  | "rollup" | "babel" | "next" | "nuxt" | "svelte" | "astro" | "tailwind" | "postcss" | "wrangler" | "vercel"
  | "netlify" | "docker" | "compose" | "make" | "just" | "task" | "nix" | "pyproject" | "setuptools" | "tox"
  | "pytest" | "mypy" | "ruff" | "flake8" | "pip" | "pipenv" | "conda" | "gomod" | "gowork" | "cargo"
  | "rust-toolchain" | "gemfile" | "maven" | "gradle" | "git" | "editor" | "version-pin" | "ci" | "other";

/** Config role. */
export type ConfigRole = "build" | "deps" | "lint" | "format" | "test" | "typecheck" | "deploy" | "runtime" | "ci" | "editor" | "other";

/** A configuration file (CR-4 proposes a core `ConfigFact`). */
export interface ConfigEntry {
  /** Path. */
  path: RepoPath;
  /** Blob. */
  blob: GitOid;
  /** Tool. */
  tool: ConfigTool;
  /** Role. */
  role: ConfigRole;
}

/** Test file → subject mapping (spec §5.4). */
export interface TestMapping {
  /** Test file. */
  test: RepoPath;
  /** Subject files (≤ 2). */
  subjects: RepoPath[];
  /** How the subject was found. */
  via: "naming" | "imports" | "inline" | "none";
  /** Test case count. */
  cases: number;
}

/** A module with indexer-internal detail. */
export interface ModuleDetail extends ModuleInfo {
  /** Alive (false = tombstone kept for resurrection). */
  alive: boolean;
  /** Depth (1 = top level). */
  depth: number;
  /** Dominant directory (`.` for root). */
  dominantDir: string;
  /** Birth anchor path (seed of the deterministic id). */
  anchor: RepoPath;
  /** Body digest. */
  bodyDigest: Xxh3;
  /** Facts digest. */
  factsDigest: Xxh3;
  /** Tests digest. */
  testsDigest: Xxh3;
  /** Attached test files. */
  tests: RepoPath[];
  /** Split lineage. */
  splitFrom?: ModuleId;
  /** A single file larger than the leaf hard cap. */
  oversizeFile: boolean;
  /** Representative paths (≤ 32) for `doc.index.json` seeds (CR-1). */
  reps: RepoPath[];
  /** Born at. */
  bornAt: Iso8601;
}

/** Result of the last structure pass. */
export interface StructureInfo {
  /** Index digest it was computed from. */
  indexDigest: Xxh3;
  /** Resolution parameter in use. */
  gamma: number;
  /** Modularity of the leaf partition (γ = 1). */
  modularity: number;
  /** Modularity of the pure directory partition (comparison). */
  dirModularity: number;
  /** Leaf count. */
  leaves: number;
  /** Parent count (all levels). */
  parents: number;
  /** Strongly connected components with ≥ 2 modules. */
  cycles: ModuleId[][];
  /** Whether Leiden ran (false = incremental assignment only). */
  clustered: boolean;
  /** Computed at. */
  at: Iso8601;
}

/* ============================================================================
 * E. Packing types (S4)
 * ========================================================================== */

/** Moved to `@mitori/core` at the M0 freeze [CR m0-1]; re-exported for compatibility. */
export type { CodeSlice } from "@mitori/core";

/** Skeleton tiers (spec §7.1; only `sig` and `doc` keep line numbers and support citations). */
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
      /** All member files of a module (tests excluded). */
      kind: "module";
      /** Module. */
      module: ModuleId;
      /** Token budget; degradation steps of spec §7.2 apply when exceeded. */
      budget?: number;
    }
  | {
      /** Whole repo (l0 only — 1 declaration per line), ranked files first within `budget`. */
      kind: "repo";
      /** Token budget. */
      budget?: number;
    };

/** A rendered skeleton. */
export interface Skeleton {
  /** Tier. */
  tier: SkeletonTier;
  /** Text (deterministic, byte-stable for a given packKey). */
  text: string;
  /** Estimated tokens for the requested tokenizer. */
  tokens: number;
  /** Files covered. */
  files: RepoPath[];
  /** Files folded to `=== <path> (<n> declarations not shown)` by budget degradation (gen request I2). */
  omitted: RepoPath[];
  /** Per-file token counts (lets the caller re-fold) — in rendering order. */
  perFile: { path: RepoPath; tokens: number; folded: boolean }[];
  /** Secret redactions applied. */
  redactions: number;
  /** Cache key. */
  key: Xxh3;
}

/** Deterministic per-module input pieces for gen S5 (spec §7.2). */
export interface ModuleContext {
  /** Module. */
  module: ModuleInfo;
  /** Skeleton (tier `sig` by default). */
  skeleton: Skeleton;
  /** Hot bodies (Σ ≤ 25 % of the module input). */
  hot: CodeSlice[];
  /** `T <path>: <name>; …` lines. */
  tests: string;
  /** Module facts in repo-pack line format. */
  facts: string;
  /** `U <slug> <id>` / `B <slug> <id>` lines. */
  neighbors: string;
  /** Token breakdown. */
  tokens: { skeleton: number; hot: number; tests: number; facts: number; neighbors: number; total: number };
  /** Cache key = xxh3(packKey + module id + tier + budget). */
  key: Xxh3;
}

/** Options of `moduleContext()`. */
export interface ModuleContextOptions {
  /** Tokenizer of the target model. */
  tokenizer: TokenizerId;
  /** Total token budget for the module input. */
  budget: number;
  /** Skeleton tier (default `sig`). */
  tier?: SkeletonTier;
  /** Explicit hot-body budget (capped at 25 % of the module input). */
  hotBudget?: number;
}

/** Repo pack part names (`RepoPack.parts[].name`). */
export type RepoPackPart = "repo_map" | "module_tree" | "facts" | "glossary_seed" | "existing_docs";

/** Repo context pack (S4): the shared, cacheable prefix for every LLM call (~10k tokens). */
export interface RepoPack {
  /** Deterministic text (`mitori.repopack/1` tagged lines; byte-identical per packKey ⇒ prompt cache hits). */
  text: string;
  /** Estimated tokens. */
  tokens: number;
  /** Index digest it was built from. */
  indexDigest: Xxh3;
  /** packKey = xxh3(indexDigest, EXTRACTOR_SET_VERSION, settingsDigest, pack format). */
  key: Xxh3;
  /** Parts and their sizes (estimate breakdown). */
  parts: { name: RepoPackPart; tokens: number; lines: number; truncated: boolean }[];
  /** Secret redactions applied. */
  redactions: number;
}

/** Options of `repoPack()`. */
export interface RepoPackOptions {
  /** Tokenizer of the target model. */
  tokenizer: TokenizerId;
  /** Pad the MAP part with sig fragments up to this size (Haiku 4.5 needs ≥ 4,096 to cache). */
  minPrefixTokens?: number;
  /** Hard cap chosen by the caller (gen `repoPackMaxTokens`); MAP → TERMS → DOCS are trimmed to fit. Default 12k. */
  maxTokens?: number;
}

/** Cheap per-module statistics (gen request I3). */
export interface ModuleStats {
  /** Module. */
  module: ModuleId;
  /** Member files (non-test). */
  files: number;
  /** LOC. */
  loc: number;
  /** Symbols. */
  symbols: number;
  /** Exported symbols. */
  exportedSymbols: number;
  /** Test cases attached. */
  tests: number;
  /** Test files attached. */
  testFiles: number;
  /** Facts per kind located in member files (main scope). */
  facts: Partial<Record<FactKind, number>>;
  /** Outgoing module dependencies above the threshold (weight rounded to 2 decimals). */
  depsOut: { module: ModuleId; weight: number }[];
  /** Incoming module dependencies. */
  depsIn: { module: ModuleId; weight: number }[];
}

/** An entry point and the shortest module-graph path from it (gen request I4; spec §7.8). */
export interface FlowSeed {
  /** 1-based rank. */
  k: number;
  /** Entry flavour. */
  kind: "route" | "cli" | "entry";
  /** Short label (`GET /api/comments`, `crit review`, `cmd/crit`). */
  label: string;
  /** Location of the defining fact. */
  path: RepoPath;
  /** Line. */
  line: LineNo;
  /** Handler symbol when known. */
  handler?: SymbolKey;
  /** Module path (BFS, ≤ 6 hops). */
  modules: ModuleId[];
  /** One file per module along the path (call-reference chain where resolvable). */
  files: RepoPath[];
}

/** Graph export for diagrams (doc converts it to Diagram IR). */
export interface GraphData {
  /** Level. */
  level: "module" | "file";
  /** Nodes. */
  nodes: { id: string; label: string; module?: ModuleId; path?: RepoPath; rank: number; loc: number }[];
  /** Weighted edges (directory prior edges are never exported). */
  edges: { from: string; to: string; kind: GraphEdgeKind; weight: number }[];
}

/* ============================================================================
 * F. The indexer service
 * ========================================================================== */

/** The indexer service (one per workspace). All reads answer from the latest in-memory snapshot. */
export interface Indexer {
  /** Full scan S0→S4. Emits `scan.progress`/`scan.done`. Idempotent; concurrent calls share one run. */
  scan(opts?: ScanOptions): Promise<ScanSummaryView>;
  /** Incremental update for watcher batches. ≤ 15 ms per changed file on a warm Worker. Queued while a scan runs. */
  update(changes: FsChange[], signal?: Cancel): Promise<IndexDelta>;
  /** Keep (true) or release (false) the warm Worker; server calls it on SSE client connect/disconnect. */
  setActive(active: boolean): void;
  /** Current snapshot (null before the first scan). */
  snapshot(): RepoSnapshot | null;
  /**
   * Static repository profile for the S1 hero and header (`WorkspaceStatus.profile`; 0 tokens): remote, HEAD date +
   * tag (`GitReader.remoteUrl` / `headMeta`), license, toolchain, README excerpt and ≤ 4 LOC tiles, computed after S2
   * and refreshed by warm scans / when one of its source files changes. Null before the first scan [CR m1-26].
   */
  profile(): RepoProfile | null;
  /** Timings of the last scan. */
  lastTimings(): ScanTimings | null;
  /** Files. */
  files(q?: FileQuery): FileEntry[];
  /** One file (public view). */
  file(path: RepoPath): FileEntry | null;
  /** One file with internal detail. */
  fileDetail(path: RepoPath): FileDetail | null;
  /** Why a path is classified as it is. */
  explain(path: RepoPath): InventoryExplanation | null;
  /** Current blob of a path (null when missing or excluded). AnchorContext.currentBlob. */
  currentBlob(path: RepoPath): GitOid | null;
  /** Read a range at the CURRENT blob (or a given blob). Lines are 1-based inclusive. Secret-scanned. */
  read(path: RepoPath, range?: { start: LineNo; end: LineNo }, opts?: { blob?: GitOid; numbered?: boolean }): Promise<CodeSlice>;
  /**
   * Raw blob text (anchor engine uses it for old-vs-new diffs). Not secret-scanned (never leaves the daemon).
   * Reads the git object DB first, then the PIN STORE `idx_blob_text` (R1, CONS-13): when the indexer hashes a
   * dirty file it stores the content under its blob id (refcount 0, `last_ref_at` = now), so the second and later
   * saves of an uncommitted file still have the old text for Myers line mapping. Null only when neither has it.
   */
  blobText(blob: GitOid): Promise<string | null>;
  /** Keep blob texts alive while an anchor/claim/thread references them (refcount +1). */
  pinBlobs(blobs: readonly GitOid[]): Promise<void>;
  /** Release pins (refcount −1); rows with refcount 0 and `last_ref_at` older than 7 days are GC'd daily. */
  unpinBlobs(blobs: readonly GitOid[]): Promise<void>;
  /** Raw current text of a path (AnchorContext.currentText). Not secret-scanned (never leaves the daemon). Null when missing. */
  currentText(path: RepoPath): Promise<string | null>;
  /** Rename target recorded by the last updates (AnchorContext.renamedTo). */
  renamedTo(path: RepoPath): RepoPath | null;
  /** Symbols of a file. */
  symbols(path: RepoPath): SymbolEntry[];
  /** Symbols of a file with detail. */
  symbolDetails(path: RepoPath): SymbolDetail[];
  /**
   * Symbols of `path` as of an older `blob` (re-anchoring S2 expected position; loop→idx-2, CR m0-13): parses
   * `blobText(blob)` with the language of `path` on the warm Worker, cached per blob (LRU). `[]` for a language
   * without symbols; null only when the blob text is unavailable (pin missing, shallow clone).
   */
  symbolsAt(path: RepoPath, blob: GitOid): Promise<SymbolEntry[] | null>;
  // CR m1-35: `symbolsAt` answers `[]` without reading when `path` is excluded or text-profile (same classification as
  // `symbols(path)`; a deleted path is classified by name). `blobText`'s last resort (the current file with that blob)
  // skips excluded files; blob `""` ⇒ null, and `pinBlobs` / `unpinBlobs` ignore `""`. `scan()` and `update()` run in
  // call order (an update waits for a running scan and vice versa; a queued or running scan is shared, `force`
  // aborts it).
  /** Smallest symbol enclosing a range (citation stamping); ties → deepest. */
  enclosingSymbol(path: RepoPath, start: LineNo, end: LineNo): SymbolEntry | null;
  /** Lookup by key. */
  symbol(key: SymbolKey): SymbolEntry | null;
  /** Current range of a symbol (AnchorContext.symbolRange). */
  symbolRange(key: SymbolKey): { start: LineNo; end: LineNo; blob: GitOid } | null;
  /** Fuzzy symbol search (MCP `find_symbol`, Code peek "go to definition"). */
  findSymbols(query: string, limit: number, kinds?: SymbolKind[]): SymbolEntry[];
  /** Imports of a file after resolution. */
  imports(path: RepoPath): ResolvedImport[];
  /** Files importing / referencing a path (backlinks). */
  dependents(path: RepoPath): { path: RepoPath; kind: GraphEdgeKind; weight: number }[];
  /** Modules (alive; tree via parent/children). */
  modules(): ModuleInfo[];
  /** One module. */
  module(id: ModuleId): ModuleInfo | null;
  /** One module with detail (tombstones included). */
  moduleDetail(id: ModuleId): ModuleDetail | null;
  /** Module of a path (leaf), including attached tests. */
  moduleOf(path: RepoPath): ModuleId | null;
  /** Last structure pass. */
  structure(): StructureInfo | null;
  /** Graph at module or file level. */
  graph(level: "module" | "file", focus?: string): GraphData;
  /** Static facts (main scope unless `scope` given). */
  facts(kind?: FactKind, scope?: FileScope | "all"): Fact[];
  /** Configuration files. */
  configs(): ConfigEntry[];
  /** Test file → subject mapping. */
  tests(): TestMapping[];
  /**
   * Skeleton of a target. Model-bound outputs — `skeleton`, `moduleContext`, `hotBodies`, `flowBodies`,
   * `rationaleComments`, `repoPack` — render bidi controls, zero-width characters and BOM (U+202A–202E, U+2066–2069,
   * U+200B–200F, U+FEFF) as visible `\u{…}` escapes, line count unchanged (RT-16, Trojan Source); `read()`,
   * `currentText()` and `blobText()` stay raw (the UI and loop bundles escape themselves) [CR m1-34]. Module / repo
   * targets (§7.2 degradation) are WP-02's (`skeleton/`); `moduleContext`, `hotBodies` and `rationaleComments` are
   * WP-03's (`pack/`) [CR m1-27].
   */
  skeleton(target: SkeletonTarget, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton;
  /** "Hot bodies" for a module within a token budget (≤ 25 % of module input; spec §7.3). */
  hotBodies(module: ModuleId, budgetTokens: number, tokenizer: TokenizerId): CodeSlice[];
  /** Deterministic module input pieces for gen S5 (spec §7.2). */
  moduleContext(module: ModuleId, opts: ModuleContextOptions): ModuleContext;
  /** Repo context pack (S4). */
  repoPack(opts: RepoPackOptions): RepoPack;
  /** Seeds to persist into `doc.index.json` (CR-1): one per alive module. */
  moduleSeeds(): ModuleSeed[];
  /** Cheap per-module statistics (gen request I3). */
  moduleStats(module: ModuleId): ModuleStats | null;
  /**
   * Distinct main-scope source files that use each symbol (S1 references through the resolved imports; Go: `alias.N`
   * through the package import, or unqualified in the same package). Keys without a user are absent. Optional: the
   * static doc ranks §7's key types by it and falls back to file importers without it [CR rdoc-5].
   */
  symbolUsers?(keys: readonly SymbolKey[]): ReadonlyMap<SymbolKey, number>;
  /** Entry points with shortest module paths (gen request I4), main scope, ranked. */
  flowSeeds(limit?: number): FlowSeed[];
  /** Handler + call-chain bodies along a seed's path within a token budget (numbered, secret-scanned). */
  flowBodies(seed: FlowSeed, budgetTokens: number, tokenizer: TokenizerId): CodeSlice[];
  /** Rationale comments ±2 lines (gen request I5), file rank desc then line asc, ≤ `limit` (default 60). */
  rationaleComments(limit?: number): CodeSlice[];
  /** Server-side search (FTS5 trigram; 1–2 char queries and the pre-FTS window fall back to LIKE over palette items). */
  search(q: string, kinds: SearchKind[], limit: number): SearchHit[];
  /** Palette entries contributed by the index (files, symbols, modules); doc adds sections/terms. */
  paletteItems(): PaletteIndex["items"];
  /** Token estimate for arbitrary text: `kind:*` calibrated coefficients, CJK split (spec §7.6). No per-call factor (R1 CONS-24). */
  estimateTokens(text: string, kind: TextKind, tokenizer: TokenizerId): number;
  /** Feed an exact single-kind count (validated: chars ≥ 2,000, 0.25 < ratio < 4) to `deps.calibrationSink`. */
  calibrate(sample: CalibrationSample): void;
  /** Release workers and statements. */
  close(): Promise<void>;
}

// `createIndexer` → ./update/index.ts

// `INDEXER_MIGRATIONS` → ./update/index.ts

/* ============================================================================
 * G. Extension points
 * ========================================================================== */

/** Parsed project configuration kinds available to import resolution (spec §4.1). */
export interface ProjectConfigs {
  /** Nearest tsconfig/jsconfig after `extends`. */
  tsconfig: { dir: RepoPath; baseUrl?: RepoPath; paths: Record<string, string[]> };
  /** Nearest package.json. */
  packageJson: {
    dir: RepoPath;
    name?: string;
    main?: string;
    module?: string;
    exports?: unknown;
    imports?: unknown;
    workspaces: string[];
    deps: Record<string, { version: string; dev: boolean }>;
  };
  /** Owning go.mod. */
  gomod: { dir: RepoPath; module: string; replaces: Record<string, RepoPath> };
  /** Python roots (repo-wide). */
  pyroots: { roots: RepoPath[] };
  /** Owning Cargo crate. */
  cargo: { dir: RepoPath; crate: string; lib?: RepoPath; bins: RepoPath[]; members: string[] };
}

/** Context for import resolution (pure; in-memory path set, no fs). */
export interface ImportContext {
  /** True when a repo path exists (included, config or docs). */
  exists(path: RepoPath): boolean;
  /** Files directly inside a directory. */
  dirFiles(dir: RepoPath): readonly RepoPath[];
  /** Nearest/owning parsed config for `near` (file or directory), null when none. */
  config<K extends keyof ProjectConfigs>(kind: K, near: RepoPath): ProjectConfigs[K] | null;
  /** Workspace packages (name → dir) from package.json workspaces / pnpm-workspace.yaml / lerna.json. */
  workspacePackages(): ReadonlyMap<string, RepoPath>;
  /** Go: package files for an import path (non-test `.go` files) and their package symbol table. */
  goPackage(importPath: string): { dir: RepoPath; files: RepoPath[]; defines(name: string): RepoPath | null } | null;
  /** Rust: module path (`crate::a::b`) of a file, and the file of a module path. */
  rustModule(path: RepoPath): string | null;
  /** Rust: resolve a module path to its file. */
  rustFile(modulePath: string, crate: string): RepoPath | null;
}

/** Language plugin: grammar + queries + import resolution + test heuristics. */
export interface LanguagePlugin {
  /** Language id. */
  id: SourceLang;
  /** File extensions (lowercase, with dot; compound first, e.g. `.d.ts`). */
  extensions: readonly string[];
  /** Grammar id (asset name via {@link GRAMMARS}). */
  grammar: GrammarId;
  /** Tags query source (spec §3.5; `docs/design/specs/indexer/queries/<grammar>.scm`). */
  tagsQuery: string;
  /** Extractor version `<lang>@<grammarVer>+<q8>` (participates in every cache key). */
  version: ExtractorVersion;
  /** Resolve an import to repo files / external / stdlib (spec §4.2–4.5). */
  resolveImport(imp: ImportRecord, fromPath: RepoPath, ctx: ImportContext): Omit<ResolvedImport, keyof ImportRecord | "from">;
  /** Test-file heuristic (`*_test.go`, `test_*.py`, `*.test.ts`, …). */
  isTestFile(path: RepoPath): boolean;
  /** Generic names added to the shared `GENERIC_NAMES` (language builtins). */
  builtinNames: readonly string[];
}

/** Evidence attached to a fact candidate (checked at link time). */
export type FactEvidence = `import:${string}` | `bind:${string}` | `recv:${string}` | `path:${string}` | `dep:${string}` | `attr:${string}`;

/** A per-file fact candidate produced inside the Worker while the tree is alive. */
export interface FactCandidate {
  /** Detector id with version (`route.hono@1`). */
  detector: string;
  /** Fact kind. */
  kind: FactKind;
  /** Path. */
  path: RepoPath;
  /** Line. */
  line: LineNo;
  /** Kind-specific fields (strings/numbers/booleans/string lists only; never values of env/secrets). */
  data: Record<string, string | number | boolean | string[]>;
  /** Evidence for the guard. */
  evidence: FactEvidence[];
  /** Scope of the file. */
  scope: FileScope;
}

/** What a detector sees in the Worker. */
export interface FactExtractInput {
  /** File facts known before parsing. */
  file: { path: RepoPath; lang: SourceLang; class: FileClass; scope: FileScope };
  /** Decoded text. */
  text: string;
  /** web-tree-sitter `Tree` (opaque here; absent for `text` profile). Must not be retained. */
  tree?: unknown;
  /** Imports already extracted from the same tree. */
  imports: readonly ImportRecord[];
}

/** What a detector sees at link time (main thread). */
export interface FactLinkContext {
  /** Dependencies declared by the nearest manifest of a path (package names). */
  manifestDeps(path: RepoPath): ReadonlySet<string>;
  /** Resolve an import binding of a file to repo files. */
  resolve(path: RepoPath, spec: string): readonly RepoPath[];
  /**
   * Symbol defined in a file by name (handler stamping): the file, then (Go) its package directory, then the files it
   * imports. `callable` skips declarations that cannot be a handler (types, fields, modules) [gen #4c].
   */
  symbolAt(path: RepoPath, name: string, opts?: { callable?: boolean }): SymbolKey | null;
  /** Scope of a path. */
  scopeOf(path: RepoPath): FileScope;
}

/** Static fact detector: extract in the Worker, link on the main thread (spec §5.1). */
export interface FactDetector {
  /** Id with version, e.g. `route.hono@1`. */
  id: string;
  /** Kinds produced. */
  kinds: readonly FactKind[];
  /** Grammars / text kinds it runs on. */
  runsOn: readonly (GrammarId | "text")[];
  /** Cheap applicability check (extension / path / class). */
  appliesTo(file: FactExtractInput["file"]): boolean;
  /** Candidates of one file (Worker). */
  extract(input: FactExtractInput): FactCandidate[];
  /** Guard, compose (mount prefixes), stamp handlers, dedupe (main thread). */
  link(candidates: readonly FactCandidate[], ctx: FactLinkContext): Fact[];
}

/** Inventory rule (S0). Order fixed by {@link INVENTORY_RULE_ORDER}; first match wins. */
export interface InventoryRule {
  /** Rule id. */
  id: InventoryRuleId;
  /** `path` rules run on the main thread without reading; `content` rules run in the Worker. */
  phase: "path" | "content";
  /** Class assigned. */
  class: FileClass;
  /** Exclusion reason (if excluded). */
  exclude?: IndexerExcludeReason;
  /** Matcher. */
  match(input: {
    path: RepoPath;
    size: number;
    mode: string;
    attrs: { vendored?: boolean; generated?: boolean; documentation?: boolean };
    head?: Uint8Array;
    stats?: { lines: number; avgLineBytes: number };
  }): boolean;
}

/* ============================================================================
 * H. Worker protocol (S0b + S1; spec §3.3)
 * ========================================================================== */

/** Ports available inside a parse Worker (the server's worker entry provides them; no Bun API in the indexer). */
export interface ParseWorkerEnv {
  /** Read a whole file. */
  readFile(abs: string): Uint8Array;
  /** git blob oid of content (`blob <len>\0` framing). */
  gitBlob(data: Uint8Array, algo: "sha1" | "sha256"): GitOid;
  /** xxh3-64 hex. */
  xxh3(data: string | Uint8Array): Xxh3;
  /** Monotonic ms. */
  now(): number;
}

/** Worker init message. */
export interface ParseWorkerInit {
  /** `web-tree-sitter.wasm` bytes. */
  runtime: Uint8Array;
  /** Grammar wasm bytes (loaded lazily on first use). */
  grammars: Partial<Record<GrammarId, Uint8Array>>;
  /** Tags query sources per grammar (tsx = typescript + addendum). */
  queries: Partial<Record<GrammarId, string>>;
  /** Detector ids enabled in this build. */
  detectors: readonly string[];
  /** Repo hash algorithm. */
  objectFormat: "sha1" | "sha256";
  /** {@link INDEXER_FORMAT.extractorCode}. */
  extractorCode: number;
}

/** One file to process. */
export interface ParseItem {
  /** Repo path. */
  path: RepoPath;
  /** Absolute path (read by the Worker when `source` is absent). */
  abs: string;
  /** Size from stat. */
  size: number;
  /** Language. */
  lang: SourceLang;
  /** Grammar (null ⇒ generic / text). */
  grammar: GrammarId | null;
  /** Profile. */
  profile: ParseProfile;
  /** Blob from `ls-files -s` when clean; null ⇒ the Worker hashes. */
  knownBlob: GitOid | null;
  /** Bytes already read by the main thread (transferred). */
  source?: Uint8Array;
  /** Detector ids applicable to this file. */
  detectors: readonly string[];
  /** Provisional class from the path rules. */
  provisionalClass: FileClass;
  /** Scope from the path rules. */
  scope: FileScope;
  /** R03 include: skip the content rules R11–R13 [CR m1-23]. */
  skipContentRules?: boolean;
}

/** Batch request. */
export interface ParseBatchRequest {
  /** Batch id. */
  id: number;
  /** Items (≤ 64, byte-bounded; LPT order). */
  items: ParseItem[];
}

/** Result of one item. */
export type ParseItemResult =
  | {
      /** Content rule hit (R11–R13): not parsed. */
      status: "excluded";
      /** Path. */
      path: RepoPath;
      /** Blob. */
      blob: GitOid;
      /** Rule. */
      rule: "R11.binary_content" | "R12.minified_content" | "R13.generated_header";
      /** Physical lines (0 for binary). */
      lines: number;
    }
  | {
      /** Parsed (or text-extracted). */
      status: "ok";
      /** Path. */
      path: RepoPath;
      /** Blob. */
      blob: GitOid;
      /** Extractor version used (null for text profile). */
      extractor: ExtractorVersion | null;
      /** Physical lines. */
      lines: number;
      /** Non-blank, non-comment lines. */
      loc: number;
      /** CJK characters (token estimate split). */
      cjk: number;
      /** Symbols (path/blob/key filled by the main thread). */
      symbols: Omit<SymbolDetail, "path" | "blob" | "key">[];
      /** Imports as written. */
      imports: ImportRecord[];
      /** Folded references. */
      refs: RefRecord[];
      /** Test case names (test files). */
      tests: { name: string; line: LineNo }[];
      /** Fact candidates. */
      facts: FactCandidate[];
      /** Markdown headings (docs) or package/crate name (code). */
      headings?: { level: number; line: LineNo; text: string }[];
      /** Comment ranges matching {@link RATIONALE_COMMENT_RE}. */
      rationale: { start: LineNo; end: LineNo }[];
      /** ERROR/MISSING node count (partial trees are still used). */
      errors: number;
      /** Extraction note. */
      note?: "parse_timeout" | "parse_error" | "degraded";
      /** UTF-16 length of the decoded text (`FileEntry.tokensEst` without re-reading the file) [CR m1-23]. */
      chars: number;
      /** Language actually used (shebang refines `generic`) [CR m1-23]. */
      lang: SourceLang;
      /** Grammar actually used (Flow ⇒ `tsx`; null for generic / text) [CR m1-23]. */
      grammar: GrammarId | null;
      /**
       * Skeleton fragment bodies without the path-bound header line, rendered while the text was at hand (content
       * addressed by blob × extractor × tier, spec §7.5; `Indexer.skeleton()` is synchronous) [CR m1-23].
       */
      skeleton?: { l0: string; sig: string; doc: string };
    }
  | {
      /** Vanished or EACCES between stat and read (R00 `special`; no R11–R13 rule applies) [CR m1-23]. */
      status: "unreadable";
      /** Path. */
      path: RepoPath;
    };

/** Batch response. */
export interface ParseBatchResponse {
  /** Batch id. */
  id: number;
  /** Results in request order. */
  items: ParseItemResult[];
  /** Σ times in ms. */
  ms: { read: number; hash: number; parse: number; query: number; extract: number };
}

/** Worker-side message handler (the server's worker entry calls it from `onmessage`). Must `tree.delete()` before replying. */
export interface ParseWorkerHandler {
  /** Process one batch. */
  handle(req: ParseBatchRequest): Promise<ParseBatchResponse>;
  /** Release parser, queries and LRU trees. */
  dispose(): void;
}

// `createParseWorker` → ./parse/index.ts

/* ============================================================================
 * I. Pure helpers (exported for tests, the server and the bench harness)
 * ========================================================================== */

// `poolSize` → ./parse/index.ts

// `classifyByPath` → ./inventory/index.ts

// `computeIndexDigest` → ./inventory/index.ts

// `moduleIdFor` → ./structure/index.ts

// `slugify` → ./structure/index.ts

// `countCjk` → ./tokens/index.ts

// `estimateTokensRaw` → ./tokens/index.ts

// `TAGS_QUERIES` → ./lang/index.ts — `Readonly<Record<GrammarId, string>>`, byte-identical to the spec `.scm` [CR m1-30]

// `assertProject` → ./inventory/index.ts — `(root, home, fs: Pick<FsReader, "readdir">, force?) => void`, throws `E_WS_NOT_PROJECT` [CR m1-30]

// `notProjectReason` → ./inventory/index.ts — `(root, home, fs) => string | null` (UXP-23) [CR m1-30]
