/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/loop.ts` (§A) — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/anchor.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

/**
 * @file mitori — review → agent → code loop contract (packages `@mitori/anchor`, `@mitori/agent`, `@mitori/loop`).
 *
 * Status: DOMAIN CONTRACT (owner: loop spec). Prose spec: `docs/design/specs/loop.md` (section numbers in
 * comments below, e.g. "§1.3"). Types here are authoritative for the public surface of the three packages;
 * the spec is authoritative for algorithms. Values marked [仮] are provisional and measured per spec §14.1.
 *
 *   A. `@mitori/anchor` — one anchor engine for claims AND comments: capture, re-anchoring cascade
 *      (identity → snippet/symbol → Myers line map → TextQuote fuzzy → outdated; never deletes), overlap/stale.
 *      Depends on `@mitori/core` only (pure; all I/O via {@link AnchorContext}).
 *   B. `@mitori/agent`  — Agent Bridge: claude-cli lean spawn (invariants I1–I14), stream normalization,
 *      usage/meter, warm pool + parking (repair by continuation / --resume / cold), global scheduler,
 *      pricing, usage ledger, codex-cli (later), generic, anthropic-api adapters, contract tests.
 *   C. `@mitori/loop`   — threads/rounds/batch/carry-forward, MBF/1 bundles, deterministic router, output
 *      contracts + patch application, git safety (snapshot/worktree/refs/scope/accept/undo/GC/shadow/GitHub),
 *      gates + repair, job runner, Pull CLI contract, MCP tool catalogue, `mitori install`, secret scan.
 *
 * Boundary rules: `@mitori/loop` MUST NOT import `@mitori/gen` (the server wires post-accept doc sync through
 * {@link LoopDomainEvent}). `@mitori/gen` uses A and B only.
 *
 * Revision R1 (2026-10-03): loop spec §14.3 requests applied to core/api (`contracts/CR-LEDGER.md`); secret
 * scanning moved to core; git side repo (ADR-0012), gate sandbox/consent (ADR-0013), narrowed Pull skill
 * (SEC-04). Findings are tagged `[ID]` (docs/design/REVIEW-LOG.md).
 */

import type {
  AnchorHealth,
  BlockId,
  Cite,
  ClaimId,
  CodeAnchor,
  DiagramAnchor,
  DiagramRef,
  DocAnchor,
  GitOid,
  Hasher,
  IndexDelta,
  Iso8601,
  LineNo,
  ReanchorResult,
  RepoPath,
  SymbolKey,
  TextQuote,
  ThreadId,
  Xxh3,
} from "@mitori/core";

/* ============================================================================
 * A. @mitori/anchor  (spec §1)
 * ========================================================================== */

/* ---- A1. Normalization (shared with gen's Verifier; spec §1.1) ------------- */

/** Recorded in the doc manifest's extractor map so a change of the normalization invalidates snippet hashes. */
export const SNIPPET_NORMALIZATION = "ws-collapse@1" as const;

// `splitLines` → ./normalize/index.ts

// `normLine` → ./normalize/index.ts

// `snippetText` → ./normalize/index.ts

// `snippetHash` → ./normalize/index.ts

/**
 * Rules for the plain text a DocAnchor's quote/offset refer to (implemented by doc as `DocStore.blockText`
 * and by the web client on the rendered DOM; spec §1.1). Offsets are UTF-16 code units.
 */
export const ANCHOR_TEXT_RULES = {
  /** Source: text content of the server-rendered block HTML (ID comments already stripped). */
  source: "rendered-html-text",
  /** Elements whose text is excluded (citation chips, UI chrome). Glossary `abbr.mterm` text is kept. */
  excludeSelectors: [".mcite", "[data-mx]"],
  /** Code blocks contribute their text without line-number gutters, lines joined by "\n". */
  codeBlocks: "text-without-gutter",
  /** Whitespace runs (including newlines) collapse to one space; result trimmed. */
  collapseWhitespace: true,
  /** Doc text is NFC-normalized (human prose; absorbs IME differences). Code text is never normalized. */
  nfc: true,
} as const;

/** Anchor engine limits (spec §1.2–§1.6). */
export const ANCHOR_LIMITS = {
  /** TextQuote prefix/suffix length in characters (W3C convention). */
  quoteContextChars: 32,
  /** Max chars of `CodeAnchor.quote.exact` (cut at the last LF within the limit). */
  codeQuoteMaxChars: 256,
  /** Max chars of `DocAnchor.quote.exact`. */
  docQuoteMaxChars: 2000,
  /** Max bytes of the original text kept in `rev_anchor_snapshots`. */
  snapshotTextMaxBytes: 4096,
  /** Myers: maximum edit distance D for a whole file before the patience fallback. */
  myersMaxD: 2000,
  /** Myers: maximum D per segment between patience anchors; beyond it the segment is one replace hunk. */
  myersMaxDSegment: 500,
  /** Bitap pattern bits (diff-match-patch `Match_MaxBits`). */
  bitapMaxBits: 32,
  /** Bitap threshold (diff-match-patch `Match_Threshold`). */
  matchThreshold: 0.5,
  /** Bitap distance (diff-match-patch `Match_Distance`). */
  matchDistance: 1000,
  /** Minimum window similarity to accept a fuzzy quote match. */
  quoteAcceptSim: 0.75,
  /** Quote score at/above which the result is `moved`/`ok` rather than `fuzzy`. */
  quoteMovedScore: 0.95,
  /** Minimum score to re-home a doc anchor into a sibling block (D4). */
  docSiblingMinScore: 0.85,
  /** Minimum line survival ratio for a Myers-mapped range to stay `fuzzy` instead of falling to S4. */
  diffMinSurvival: 0.5,
  /** Cross-file snippet search only when the delta changes at most this many files. */
  crossFileMoveMaxChangedFiles: 50,
  /** Confidence recorded for a cross-file move found by snippet search. */
  crossFileMoveConfidence: 0.9,
  /** Selection/claim overlap needed to bind a doc selection to a claim: share of the selection, share of the claim. */
  claimBindOverlap: { ofSelection: 0.5, ofClaim: 0.3 },
} as const;

/* ---- A2. Line map (Myers O(ND), spec §1.4) ---------------------------------- */

/** An equal run of the edit script. */
export interface LineRun {
  /** First old line of the run (1-based). */
  oldStart: LineNo;
  /** First new line of the run (1-based). */
  newStart: LineNo;
  /** Run length in lines. */
  len: number;
}

/** A change hunk (unified-diff counting; pure insert ⇒ `oldLines = 0`, `oldStart` = line before the insert point). */
export interface LineHunk {
  /** Old start. */
  oldStart: LineNo;
  /** Old line count. */
  oldLines: number;
  /** New start. */
  newStart: LineNo;
  /** New line count. */
  newLines: number;
}

/** Old→new line mapping computed once per changed path and shared by all anchors on it. */
export interface LineMap {
  /** New line for an old line when it is equal-mapped; null when the line was changed/deleted. */
  map(oldLine: LineNo): LineNo | null;
  /** True when the equal-mapped line is also byte-identical (not only `normLine`-equal). */
  exact(oldLine: LineNo): boolean;
  /** Start mapping: equal-mapped target, or the containing hunk's `newStart` (range grows to cover the replacement). */
  mapStart(oldLine: LineNo): LineNo;
  /** End mapping: equal-mapped target, or `max(newStart, hunk.newStart + hunk.newLines - 1)`. */
  mapEnd(oldLine: LineNo, mappedStart: LineNo): LineNo;
  /** Equal runs. */
  runs: readonly LineRun[];
  /** Hunks (overlap tests). */
  hunks: readonly LineHunk[];
  /** Edit distance found. */
  d: number;
  /** True when the patience fallback was used for at least one segment. */
  fallback: boolean;
  /** Old/new line counts. */
  oldLines: number;
  /** New line count. */
  newLines: number;
}

/* ---- A3. Context, items, results -------------------------------------------- */

/** Ports the anchor engine needs. Built by the server from the indexer/doc; trivially fakeable in tests. */
export interface AnchorContext {
  /** Text of a blob (old content). Null when unavailable (pin missing) ⇒ the cascade skips S3. */
  blobText(blob: GitOid): Promise<string | null>;
  /** Current blob of a path (null when deleted). */
  currentBlob(path: RepoPath): GitOid | null;
  /** Current text of a path (null when deleted). */
  currentText(path: RepoPath): Promise<string | null>;
  /** Current range of a symbol (null when gone). */
  symbolRange(key: SymbolKey): { start: LineNo; end: LineNo; blob: GitOid } | null;
  /** Smallest enclosing symbol at the current blob (re-stamping after a move). */
  enclosingSymbol(path: RepoPath, start: LineNo, end: LineNo): SymbolKey | null;
  /** Rename map for this delta (old path → new path); cross-spec request to the indexer (`IndexDelta.renames`). */
  renamedTo(path: RepoPath): RepoPath | null;
  /** Paths added in this delta (cross-file move search, ≤ 50 changed files). */
  addedPaths(): readonly RepoPath[];
  /** Hasher. */
  hasher: Hasher;
}

/** Auxiliary capture-time data kept by the loop in `rev_anchor_snapshots` (never overwritten; spec §1.8). */
export interface AnchorSnapshot {
  /** Member. */
  member: "doc" | "code" | "diagram";
  /** `captured` = first capture; `last_ok` = last time the member re-anchored with health ok/moved. */
  kind: "captured" | "last_ok";
  /** Anchor member JSON at that time. */
  anchor: DocAnchor | CodeAnchor | DiagramAnchor;
  /** Original text (≤ 4 KiB) shown for outdated threads. */
  text?: string;
  /** `end - start` of a code anchor. */
  spanLines?: number;
  /** Start line of the enclosing symbol at capture (S2 expected position). */
  symStart?: LineNo;
  /** Diagram node label at capture. */
  label?: string;
  /** Diagram node ref at capture. */
  ref?: DiagramRef;
  /** When. */
  at: Iso8601;
}

/** Anything with a code anchor that must follow code changes (claims' cites and threads' code members). */
export type AnchoredItem =
  | {
      /** A claim citation. */
      kind: "cite";
      /** Owning claim. */
      owner: ClaimId;
      /** Index within the claim's cites. */
      index: number;
      /** Cite. */
      cite: Cite;
    }
  | {
      /** A thread's code member (doc-primary threads re-derive their code member from the claim instead). */
      kind: "thread";
      /** Thread. */
      owner: ThreadId;
      /** Code anchor. */
      anchor: CodeAnchor;
      /** Capture-time auxiliary data (spanLines, symStart). */
      snapshot?: Pick<AnchorSnapshot, "spanLines" | "symStart">;
    };

/** Per-item outcome of a batch re-anchoring pass. */
export interface ReanchorItemResult {
  /** Health/method/confidence + new and previous anchor (new = previous when outdated). */
  result: ReanchorResult<CodeAnchor | Cite>;
  /** True when the old range overlapped a hunk (claim ⇒ stale; thread ⇒ stale unless it is the change's own thread). */
  overlapped: boolean;
  /** The cascade step that produced the result (S1..S5; spec §1.3). */
  step: "S1" | "S2" | "S3" | "S4" | "S5";
}

/** Batch re-anchoring report (same order as the input items). */
export interface ReanchorReport {
  /** Results. */
  results: ReanchorItemResult[];
  /** Counts by health. */
  counts: Record<AnchorHealth, number>;
  /** Paths for which a line map was computed. */
  mapped: RepoPath[];
  /** Wall time. */
  ms: number;
}

/** Fuzzy quote match. */
export interface QuoteMatch {
  /** Start offset (UTF-16). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Score in [0,1] (1 = prefix+exact+suffix exact match). */
  score: number;
}

/** Input of a doc-member re-anchor (block text changed or block removed; spec §1.6.1). */
export interface DocReanchorInput {
  /** Anchor before. */
  anchor: DocAnchor;
  /** Current anchor text of the same block (null when the block was deleted). */
  blockText: string | null;
  /** Current block hash (null when deleted). */
  blockHash: Xxh3 | null;
  /** Sibling blocks of the same section (D4). */
  siblings: { block: BlockId; text: string; hash: Xxh3 }[];
  /** Claims of the (new) block with their quote spans in `blockText`, for re-binding `claim`. */
  claims: { id: ClaimId; start: number; end: number }[];
}

/** Input of a diagram-member re-anchor (spec §1.6.2). */
export interface DiagramReanchorInput {
  /** Anchor before. */
  anchor: DiagramAnchor;
  /** Capture-time label/ref. */
  snapshot: Pick<AnchorSnapshot, "label" | "ref">;
  /** Current diagram nodes (null when the diagram is gone). */
  nodes: { id: string; label: string; ref?: DiagramRef }[] | null;
  /** Current edge ids. */
  edges: string[];
}

/** The anchor engine. Budgets: 10k-line remap ≤ 50 ms; 1k anchors over 3 changed files ≤ 100 ms. */
export interface AnchorEngine {
  /** Capture a code anchor from a selection (blob, symbol, snippet hash, quote with 32-char context; §1.2.2). */
  codeAnchor(path: RepoPath, start: LineNo, end: LineNo, text: string, blob: GitOid, symbol?: SymbolKey, charRange?: { from: number; to: number }): CodeAnchor;
  /** Capture a doc anchor from a selection inside a block's anchor text (§1.2.1). `claims` give quote spans for binding. */
  docAnchor(block: BlockId, blockText: string, blockHash: Xxh3, selStart: number, selEnd: number, claims?: { id: ClaimId; start: number; end: number }[]): DocAnchor;
  /** Verify a client-sent TextQuote against the server-computed anchor text (§1.2.1-6). */
  verifyDocQuote(blockText: string, quote: TextQuote): boolean;
  /** Line map between two texts (Myers linear-space + patience fallback; §1.4). */
  lineMap(oldText: string, newText: string): LineMap;
  /** Re-anchor many code anchors after an index delta (S0–S5; never throws, never drops). */
  reanchor(items: AnchoredItem[], delta: IndexDelta, ctx: AnchorContext): Promise<ReanchorReport>;
  /** Re-anchor a doc member (D1–D4). */
  reanchorDoc(input: DocReanchorInput): ReanchorResult<DocAnchor>;
  /** Re-anchor a diagram member. */
  reanchorDiagram(input: DiagramReanchorInput): ReanchorResult<DiagramAnchor>;
  /** Fuzzy quote search (diff-match-patch style), nearest to `hint` (§1.5). */
  findQuote(text: string, quote: TextQuote, hint?: number): QuoteMatch | null;
  /** Overlap test of an old range against hunks (§1.7: insert strictly inside counts, boundary inserts do not). */
  overlaps(start: LineNo, end: LineNo, hunks: readonly LineHunk[]): boolean;
}

// `createAnchorEngine` → ./engine/index.ts
