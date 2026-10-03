import type {
  Anchor,
  BlockId,
  ClaimId,
  EffectiveSettings,
  FileEntry,
  Message,
  MessageAuthor,
  MessageId,
  MessageView,
  RepoPath,
  SourceLang,
  TextQuote,
  ThreadDetail,
  ThreadId,
  ThreadIntent,
} from "@mitori/core";

// Test-only builders for WP-08a: threads, anchors, file entries and settings with the spec defaults.

export const NOW = "2026-10-03T00:00:00.000Z";

export function codeAnchor(path: RepoPath, start: number, end: number, extra: Partial<NonNullable<Anchor["code"]>> = {}): Anchor {
  return { primary: "code", code: { path, start, end, blob: "0".repeat(40), snippet: "0".repeat(16), ...extra } };
}

export function docAnchor(block: BlockId, opts: { claim?: ClaimId; quote?: TextQuote; hash?: string } = {}): Anchor {
  return {
    primary: "doc",
    doc: { block, blockHash: opts.hash ?? "9f3c2a10aaaaaaaa", ...(opts.claim ? { claim: opts.claim } : {}), ...(opts.quote ? { quote: opts.quote } : {}) },
  };
}

export function msg(by: MessageAuthor, body: string, round = 1, kind: Message["kind"] = by === "human" ? "comment" : "answer", id = 1): MessageView {
  return { id: `m_${String(id).padStart(10, "0")}` as MessageId, thread: "th_00000001", by, kind, body, round, createdAt: NOW, html: "" };
}

export function thread(over: Partial<ThreadDetail> & { id?: ThreadId; intent?: ThreadIntent; ask?: string } = {}): ThreadDetail {
  const { ask, ...rest } = over;
  const id = (rest.id ?? "th_00000001") as ThreadId;
  return {
    id,
    anchor: codeAnchor("src/a.ts", 1, 10),
    anchorHealth: "ok",
    stale: false,
    intent: "change",
    state: "open",
    round: 1,
    version: 1,
    title: "t",
    jobs: [],
    createdAt: NOW,
    updatedAt: NOW,
    messages: ask === undefined ? [] : [{ ...msg("human", ask), thread: id }],
    jobViews: [],
    ...rest,
  };
}

export function entry(path: RepoPath, over: Partial<FileEntry> = {}): FileEntry {
  const lang = (
    /\.go$/.test(path) ? "go" : /\.tsx?$/.test(path) ? "typescript" : /\.py$/.test(path) ? "python" : /\.rs$/.test(path) ? "rust" : "generic"
  ) as SourceLang;
  return {
    path,
    blob: "1".repeat(40),
    size: 1000,
    lang,
    class: /(_test\.go|\.test\.ts|test_.*\.py)$/.test(path) ? "test" : "source",
    lines: 100,
    loc: 80,
    tokensEst: 800,
    ...over,
  };
}

/** Settings with the spec defaults (limits §3.4, models, reasoning); only what the loop reads is filled. */
export function settings(
  over: { deny?: string[]; limits?: Partial<EffectiveSettings["global"]["limits"]>; docLang?: "ja" | "en"; secretScan?: boolean; rules?: RepoPath[] } = {},
): EffectiveSettings {
  const global = {
    schemaVersion: 1,
    defaultDocLang: over.docLang ?? "ja",
    models: {
      answer: "claude-sonnet-5-5",
      patch: "claude-sonnet-5-5",
      agent: "claude-sonnet-5-5",
      genModule: "claude-sonnet-5-5",
      genOverview: "claude-opus-5-5",
      genLeaf: "claude-haiku-4-5",
      judge: "claude-haiku-4-5",
      rewrite: "claude-sonnet-5-5",
      escalate: "claude-opus-5-5",
    },
    reasoning: { answer: "low", patch: "low", agent: "medium", gen: "medium", genOverview: "medium" },
    limits: {
      confirmAboveTokens: 100_000,
      jobMaxUsd: 0.5,
      genRunMaxUsd: 5,
      dailyMaxUsd: 10,
      stopAtBudgetFraction: 0.8,
      repairMaxAttempts: 2,
      patchMaxLines: 120,
      patchMaxFiles: 2,
      bundleDefaultTokens: 4000,
      bundleMaxTokens: 12000,
      agentMaxInputTokens: 30000,
      ...over.limits,
    },
    security: { denyGlobs: [], secretScan: over.secretScan ?? true, allowNonLoopback: false, gateSandbox: "auto" },
  };
  return {
    global,
    repo: { schemaVersion: 1, ...(over.rules ? { rules: over.rules } : {}) },
    overrides: {},
    ignoredRepoKeys: [],
    denyGlobs: over.deny ?? [],
    trustedGates: [],
    gateSandbox: "none",
  } as unknown as EffectiveSettings;
}
