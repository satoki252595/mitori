/**
 * Runtime schema of the settings files (server spec §6.1: unknown keys ⇒ `E_CFG_INVALID`). The object specs are
 * typed against the core shapes (`fields` must name every key of the type), so a contract change that adds a
 * settings key fails `tsc` here until the schema follows.
 */
import type {
  BinaryPin,
  DataPolicyAck,
  EngineSettings,
  GateDeclaration,
  GlobalSettings,
  Limits,
  ModelDefaults,
  PrivacySettings,
  ReadingPath,
  RepoSettings,
  ReviewSettings,
  SchedulerSettings,
  SecuritySettings,
  UiSettings,
  WorkspaceOverrides,
} from "@mitori/core";

/** Keys that would reach prototypes through plain assignment (settings files are untrusted input). */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export type Spec =
  | { t: "bool" }
  | { t: "num"; min?: number; max?: number; int?: boolean }
  | { t: "str"; pattern?: RegExp; max?: number }
  | { t: "enum"; values: readonly (string | number | boolean | null)[] }
  | { t: "arr"; of: Spec; max?: number }
  | { t: "obj"; fields: Record<string, Spec>; optional: readonly string[] }
  | { t: "map"; of: Spec; key?: RegExp }
  /** `GateArg`: a literal string or `{var: "files" | "pkgs" | "tests"}`. */
  | { t: "gateArg" };

const bool: Spec = { t: "bool" };
const str: Spec = { t: "str", max: 4096 };
const num = (min?: number, max?: number, int = false): Spec => ({
  t: "num",
  ...(min === undefined ? {} : { min }),
  ...(max === undefined ? {} : { max }),
  int,
});
const int = (min?: number, max?: number): Spec => num(min, max, true);
const oneOf = (...values: (string | number | boolean | null)[]): Spec => ({ t: "enum", values });
const arr = (of: Spec, max = 1000): Spec => ({ t: "arr", of, max });
const map = (of: Spec, key?: RegExp): Spec => ({ t: "map", of, ...(key ? { key } : {}) });
function obj<T>(fields: { [K in keyof T]-?: Spec }, optional: readonly (keyof T & string)[] = []): Spec {
  return { t: "obj", fields: fields as Record<string, Spec>, optional };
}
/** Every key optional (partial files / overrides). */
function partialObj<T>(fields: { [K in keyof T]-?: Spec }): Spec {
  return { t: "obj", fields: fields as Record<string, Spec>, optional: Object.keys(fields) };
}

const MODEL: Spec = { t: "str", pattern: /^(claude-opus-5-5|claude-sonnet-5-5|claude-haiku-4-5|codex:[^\s]{1,100}|generic:[^\s]{1,100})$/ };
const ENGINE = oneOf("claude-cli", "session", "anthropic-api", "codex-cli", "generic");
const GEN_ENGINE = oneOf("claude-cli", "anthropic-api", "session", "generic");
const EFFORT = oneOf("overview", "standard", "complete");
const LANG = oneOf("ja", "en");
const READER = oneOf("newcomer", "standard", "expert");
const EXEC_PATH = oneOf("push", "pull", "copy");
const REASONING = oneOf("low", "medium", "high", "xhigh", "max");
const GLOB: Spec = { t: "str", max: 1024 };
const ISO: Spec = { t: "str", max: 64 };
const WS_KEY = /^ws_[0-9a-z]{12}$/;

const ui = obj<UiSettings>({
  lang: LANG,
  theme: oneOf("system", "light", "dark"),
  readerLevel: READER,
  singleKeyShortcuts: bool,
  keymap: map({ t: "str", max: 64 }),
  showUsd: bool,
  notifyOnDone: oneOf(true, false, null),
  openBrowser: bool,
  editor: oneOf("vscode", "cursor", "none"),
  defaultExecPath: EXEC_PATH,
});

const engines = obj<EngineSettings>({
  "claude-cli": obj<EngineSettings["claude-cli"]>({
    enabled: bool,
    binary: str,
    inheritUserSettings: bool,
    envPassthrough: arr({ t: "str", pattern: /^[A-Za-z_][A-Za-z0-9_]{0,127}$/ }, 64),
    warmPool: oneOf(0, 1, 2),
    persistSessions: bool,
  }),
  session: obj<EngineSettings["session"]>({ enabled: bool }),
  "anthropic-api": obj<EngineSettings["anthropic-api"]>({
    enabled: bool,
    keySource: oneOf("env", "keychain"),
    envVar: { t: "str", pattern: /^[A-Za-z_][A-Za-z0-9_]{0,127}$/ },
    useBatch: bool,
    monthlyCapUsd: num(0),
  }),
  "codex-cli": obj<EngineSettings["codex-cli"]>({ enabled: bool, binary: str, model: { t: "str", max: 128 } }),
  generic: obj<EngineSettings["generic"]>(
    {
      enabled: bool,
      argv: arr(str, 64),
      protocol: oneOf("text", "muse-jsonl"),
      pricing: obj<NonNullable<EngineSettings["generic"]["pricing"]>>({ inPerMTok: num(0), outPerMTok: num(0), cacheReadPerMTok: num(0) }),
      turnMs: int(1_000, 3_600_000),
    },
    ["protocol", "pricing", "turnMs"],
  ),
});

const models = obj<ModelDefaults>({
  answer: MODEL,
  patch: MODEL,
  agent: MODEL,
  genModule: MODEL,
  genOverview: MODEL,
  genLeaf: MODEL,
  judge: MODEL,
  rewrite: MODEL,
  escalate: MODEL,
});

const limits = obj<Limits>({
  confirmAboveTokens: int(0),
  jobMaxUsd: num(0),
  genRunMaxUsd: num(0),
  dailyMaxUsd: num(0),
  stopAtBudgetFraction: num(0, 1),
  repairMaxAttempts: int(0, 10),
  patchMaxLines: int(1),
  patchMaxFiles: int(1),
  bundleDefaultTokens: int(100),
  bundleMaxTokens: int(100),
  agentMaxInputTokens: int(1000),
});

const scheduler = obj<SchedulerSettings>({
  concurrency: int(1, 8),
  maxConcurrency: int(1, 8),
  yieldAtFiveHour: num(0, 1),
  warmFirstFanout: bool,
  backoffBaseMs: int(0),
  backoffMaxMs: int(0),
  reserveInteractive: int(0, 8),
  interactiveBurst: int(0, 8),
  subscriptionMaxConcurrency: int(1, 8),
  runWindowSpendPause: num(0, 1),
});

const review = obj<ReviewSettings>({ autoResolveOnAccept: bool, autoAcceptDocUpdates: bool, autoCommit: bool, commitTrailers: bool });
const security = obj<SecuritySettings>({ denyGlobs: arr(GLOB), secretScan: bool, allowNonLoopback: bool, gateSandbox: oneOf("auto", "require", "off") });
const ack = obj<DataPolicyAck>({ at: ISO, shownAt: ISO, plan: { t: "str", max: 64 } });
const privacy = obj<PrivacySettings>({
  dataPolicyAck: map(ack, /^(claude-cli|session|anthropic-api|codex-cli|generic)$/),
  logContent: bool,
  keepRawStreams: bool,
});
const pin = obj<BinaryPin>(
  { path: str, realpath: str, sha256: { t: "str", pattern: /^[0-9a-f]{64}$/ }, version: { t: "str", max: 256 }, pinnedAt: ISO, by: oneOf("first-run", "user") },
  ["by"], // CR m1-65
);

/** `WorkspaceOverrides` (every key optional). */
export const OVERRIDES_SPEC: Spec = partialObj<WorkspaceOverrides>({
  docDir: { t: "str", max: 1024 },
  defaultEngine: ENGINE,
  defaultGenEngine: GEN_ENGINE,
  defaultEffort: EFFORT,
  include: arr(GLOB),
  exclude: arr(GLOB),
  readerLevel: READER,
  defaultExecPath: EXEC_PATH,
  inheritUserSettings: oneOf(false),
});

/** `~/.mitori/config.json`. */
export const GLOBAL_SPEC: Spec = obj<GlobalSettings>({
  schemaVersion: oneOf(1),
  ui,
  defaultEngine: ENGINE,
  defaultGenEngine: GEN_ENGINE,
  defaultEffort: EFFORT,
  defaultDocLang: LANG,
  engines,
  models,
  reasoning: obj<GlobalSettings["reasoning"]>({ answer: REASONING, patch: REASONING, agent: REASONING, gen: REASONING, genOverview: REASONING }),
  pins: map(pin, /^(claude|git|gh|codex)$/),
  limits,
  scheduler,
  review,
  security,
  privacy,
  workspaces: map(OVERRIDES_SPEC, WS_KEY),
});

const gate = obj<GateDeclaration>({
  id: { t: "str", pattern: /^[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_.@/-]{1,128}$/ },
  kind: oneOf("format", "lint", "typecheck", "test", "build", "custom"),
  argvTemplate: arr({ t: "gateArg" }, 64),
  appliesTo: arr(GLOB, 64),
});
const SECTION: Spec = { t: "str", max: 256 };
const BLOCK: Spec = { t: "str", pattern: /^b_[0-9a-z]{8}$/ };
const readingPath = obj<ReadingPath>({
  id: { t: "str", max: 64 },
  title: { t: "str", max: 200 },
  audience: oneOf("newcomer", "dev", "reviewer", "pm", "sre"),
  steps: arr(obj<ReadingPath["steps"][number]>({ section: SECTION, blocks: arr(BLOCK, 2000) }, ["blocks"]), 200),
  readingSec: int(0),
});
type GlossarySeed = NonNullable<RepoSettings["glossary"]>[number];
const glossarySeed = obj<GlossarySeed>(
  { term: { t: "str", max: 200 }, yomi: { t: "str", max: 200 }, en: { t: "str", max: 200 }, definition: { t: "str", max: 4000 } },
  ["yomi", "en"],
);
type ModuleOverride = NonNullable<RepoSettings["modules"]>[string];

/** Value specs of the repo-scoped keys (`<docDir>/config.json`). */
export const REPO_SPEC: { [K in Exclude<keyof RepoSettings, "schemaVersion">]-?: Spec } = {
  docLang: LANG,
  effortHint: EFFORT,
  include: arr(GLOB),
  exclude: arr(GLOB),
  denyGlobs: arr(GLOB),
  readingPaths: arr(readingPath, 100),
  glossary: arr(glossarySeed, 5000),
  modules: map(
    obj<ModuleOverride>({ name: { t: "str", max: 200 }, slug: { t: "str", max: 64 }, mergeInto: { t: "str", max: 1024 } }, ["name", "slug", "mergeInto"]),
  ),
  gates: arr(gate, 64),
  rules: arr({ t: "str", max: 1024 }, 64),
};

/**
 * Validate `value` against `spec`. `partial`: missing object keys are fine (files, patches). Returns the dotted
 * paths of every violation (unknown key, wrong type, out of range).
 */
export function validate(value: unknown, spec: Spec, opts: { partial: boolean } = { partial: false }, path = ""): string[] {
  const at = (k: string) => (path === "" ? k : `${path}.${k}`);
  const fail = [path === "" ? "*" : path];
  switch (spec.t) {
    case "gateArg": {
      if (typeof value === "string") return value.length <= 8192 ? [] : fail;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail;
      const v = (value as { var?: unknown }).var;
      return Object.keys(value).length === 1 && (v === "files" || v === "pkgs" || v === "tests") ? [] : fail;
    }
    case "bool":
      return typeof value === "boolean" ? [] : fail;
    case "num":
      if (typeof value !== "number" || !Number.isFinite(value)) return fail;
      if (spec.int && !Number.isInteger(value)) return fail;
      if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return fail;
      return [];
    case "str":
      if (typeof value !== "string" || value.length > (spec.max ?? 4096)) return fail;
      return spec.pattern && !spec.pattern.test(value) ? fail : [];
    case "enum":
      return spec.values.includes(value as never) ? [] : fail;
    case "arr":
      if (!Array.isArray(value) || value.length > (spec.max ?? 1000)) return fail;
      return value.flatMap((v, i) => validate(v, spec.of, { partial: false }, at(String(i))));
    case "map": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail;
      const out: string[] = [];
      for (const [k, v] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(k) || (spec.key && !spec.key.test(k))) out.push(at(k));
        else out.push(...validate(v, spec.of, opts, at(k)));
      }
      return out;
    }
    case "obj": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail;
      const out: string[] = [];
      const rec = value as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        const field = Object.hasOwn(spec.fields, k) ? spec.fields[k] : undefined;
        if (!field) out.push(at(k));
        else if (v === undefined) continue;
        else out.push(...validate(v, field, opts, at(k)));
      }
      if (!opts.partial) for (const k of Object.keys(spec.fields)) if (!(k in rec) && !spec.optional.includes(k)) out.push(at(k));
      return out;
    }
  }
}
