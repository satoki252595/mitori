import type { BinaryPin, GlobalSettings, Iso8601 } from "@mitori/core";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A claude pin pointing at a fake binary (tests never run a real claude). */
export const TEST_CLAUDE_PIN: BinaryPin = {
  path: "/opt/test/bin/claude",
  realpath: "/opt/test/bin/claude",
  sha256: "0".repeat(64),
  version: "2.1.288 (Claude Code)",
  pinnedAt: "2026-01-01T00:00:00.000Z" as Iso8601,
};

/** Complete global settings with the spec defaults (tests override what they need). */
export function testSettings(over: DeepPartial<GlobalSettings> = {}): GlobalSettings {
  const base: GlobalSettings = {
    schemaVersion: 1,
    ui: {
      lang: "ja",
      theme: "system",
      readerLevel: "standard",
      singleKeyShortcuts: true,
      keymap: {},
      showUsd: true,
      notifyOnDone: null,
      openBrowser: true,
      editor: "vscode",
      defaultExecPath: "push",
    },
    defaultEngine: "claude-cli",
    defaultGenEngine: "claude-cli",
    defaultEffort: "standard",
    defaultDocLang: "ja",
    engines: {
      "claude-cli": { enabled: true, binary: "claude", inheritUserSettings: false, envPassthrough: [], warmPool: 0, persistSessions: false },
      session: { enabled: true },
      "anthropic-api": { enabled: false, keySource: "env", envVar: "ANTHROPIC_API_KEY", useBatch: false, monthlyCapUsd: 0 },
      "codex-cli": { enabled: false, binary: "codex", model: "gpt-5-codex" },
      generic: { enabled: false, argv: [] },
    },
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
    reasoning: { answer: "low", patch: "low", agent: "medium", gen: "low", genOverview: "medium" },
    pins: { claude: TEST_CLAUDE_PIN },
    limits: {
      confirmAboveTokens: 100_000,
      jobMaxUsd: 1,
      genRunMaxUsd: 5,
      dailyMaxUsd: 10,
      stopAtBudgetFraction: 0.8,
      repairMaxAttempts: 2,
      patchMaxLines: 120,
      patchMaxFiles: 2,
      bundleDefaultTokens: 4000,
      bundleMaxTokens: 12_000,
      agentMaxInputTokens: 30_000,
    },
    scheduler: {
      concurrency: 3,
      maxConcurrency: 8,
      yieldAtFiveHour: 0.8,
      warmFirstFanout: true,
      backoffBaseMs: 2000,
      backoffMaxMs: 60_000,
      reserveInteractive: 1,
      interactiveBurst: 1,
      subscriptionMaxConcurrency: 3,
      runWindowSpendPause: 0.3,
    },
    review: { autoResolveOnAccept: true, autoAcceptDocUpdates: false, autoCommit: false, commitTrailers: true },
    security: { denyGlobs: [], secretScan: true, allowNonLoopback: false, gateSandbox: "auto" },
    privacy: { dataPolicyAck: {}, logContent: false, keepRawStreams: false },
    workspaces: {},
  };
  return merge(base, over) as GlobalSettings;
}

function merge(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (typeof a !== "object" || a === null || Array.isArray(a) || typeof b !== "object" || b === null || Array.isArray(b)) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
  return out;
}
