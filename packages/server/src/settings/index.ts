/**
 * @mitori/server — `settings/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import {
  DEFAULT_DENY_GLOBS,
  type EffectiveSettings,
  EXEC_SETTING_KEYS,
  type Glob,
  type GlobalSettings,
  type RepoSettings,
  type Sha256,
  type TrustRecord,
  type TrustState,
  type WorkspaceInfo,
  type WorkspaceOverrides,
} from "@mitori/core";
import { getPath, isPlainObject, leafPaths } from "./merge.ts";
import { gateFromDeclaration, parseRepoSettings, repoTrustHash } from "./repo.ts";

/**
 * Built-in defaults of the global settings (the WP-00 golden; budgets in bench/budgets/*.json mirror the limits).
 * USD caps are WP-09's call (CR m0-22): job $2, generation run $10 (gen spec §4), day $30 [仮].
 */
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  schemaVersion: 1,
  ui: {
    lang: "ja",
    theme: "system",
    readerLevel: "standard",
    singleKeyShortcuts: true,
    keymap: {},
    showUsd: false,
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
    "anthropic-api": { enabled: false, keySource: "env", envVar: "ANTHROPIC_API_KEY", useBatch: true, monthlyCapUsd: 0 },
    "codex-cli": { enabled: false, binary: "codex", model: "" },
    generic: { enabled: false, argv: [] },
  },
  models: {
    answer: "claude-sonnet-5-5",
    patch: "claude-sonnet-5-5",
    agent: "claude-sonnet-5-5",
    genModule: "claude-sonnet-5-5",
    genOverview: "claude-opus-5-5",
    genLeaf: "claude-haiku-4-5",
    judge: "claude-sonnet-5-5",
    rewrite: "claude-sonnet-5-5",
    escalate: "claude-opus-5-5",
  },
  reasoning: { answer: "low", patch: "low", agent: "medium", gen: "low", genOverview: "medium" },
  pins: {},
  limits: {
    confirmAboveTokens: 100_000,
    jobMaxUsd: 2,
    genRunMaxUsd: 10,
    dailyMaxUsd: 30,
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

/** The doc directory in effect, as a repo-relative glob root (null when it lives outside the tree). */
function docDirGlob(info: WorkspaceInfo, overrides: WorkspaceOverrides): Glob | null {
  const dir = (overrides.docDir ?? info.docDir).replace(/\/+$/, "");
  if (dir === "" || dir === "." || dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir)) return null;
  return `${dir.replace(/^\.\//, "")}/**`;
}

/**
 * Resolve effective settings: defaults ← global ← workspace override ← repo (only keys whose SETTING_SCOPES row
 * includes `repo`; others go to `ignoredRepoKeys` + `notice.settings.ignoredRepoKeys`). `denyGlobs` =
 * DEFAULT_DENY_GLOBS ∪ global.security.denyGlobs ∪ repo.denyGlobs ∪ `<docDir>/**`; gates/rules need trust. Pure.
 */
export function resolveSettings(input: {
  global: GlobalSettings;
  overrides: WorkspaceOverrides;
  repoRaw: unknown;
  info: WorkspaceInfo;
  trust: (item: TrustRecord["item"], hash: Sha256) => TrustState;
  sandbox: EffectiveSettings["gateSandbox"];
}): EffectiveSettings & { repoParsed: RepoSettings } {
  const { repo: repoParsed, ignored } = parseRepoSettings(input.repoRaw);
  const repo: RepoSettings = { ...repoParsed };
  const trusted = (item: "gates" | "rules") => {
    const hash = repoTrustHash(repoParsed, item);
    return hash !== null && input.trust(item, hash) === "trusted";
  };
  const gatesTrusted = trusted("gates");
  if (!gatesTrusted) delete repo.gates;
  if (!trusted("rules")) delete repo.rules;
  const docDir = docDirGlob(input.info, input.overrides);
  const denyGlobs = [
    ...new Set<Glob>([...DEFAULT_DENY_GLOBS, ...input.global.security.denyGlobs, ...(repoParsed.denyGlobs ?? []), ...(docDir === null ? [] : [docDir])]),
  ];
  return {
    global: input.global,
    repo,
    overrides: input.overrides,
    ignoredRepoKeys: ignored,
    denyGlobs,
    trustedGates: gatesTrusted ? (repoParsed.gates ?? []).map(gateFromDeclaration) : [],
    gateSandbox: input.sandbox,
    repoParsed,
  };
}

/** Validate a `PATCH /settings` patch: any path under EXEC_SETTING_KEYS ⇒ `E_FORBIDDEN_KEY` (decreases of `limits.*` allowed). Pure. */
export function checkSettingsPatch(patch: unknown, current: GlobalSettings): { ok: true } | { ok: false; paths: string[] } {
  if (!isPlainObject(patch)) return { ok: false, paths: ["*"] };
  const forbidden = new Set<string>();
  for (const { path, value } of leafPaths(patch)) {
    const key = EXEC_SETTING_KEYS.find((k) => path === k || path.startsWith(`${k}.`) || k.startsWith(`${path}.`));
    if (key === undefined) continue;
    if (key === "limits" && path.startsWith("limits.")) {
      const cur = getPath(current, path);
      if (typeof value === "number" && typeof cur === "number" && Number.isFinite(value) && value <= cur) continue;
    }
    forbidden.add(path);
  }
  return forbidden.size === 0 ? { ok: true } : { ok: false, paths: [...forbidden].sort() };
}
