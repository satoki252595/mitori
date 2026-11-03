import {
  type DeepPartial,
  type GlobalSettings,
  MODEL_CATALOG,
  type ModelCatalogKey,
  PROVIDER_AUTH_IDS,
  type ProviderAuthId,
  type ReasoningEffort,
} from "@mitori/core";

/** Generation's existing minimum turn deadline; an explicit value resets a previously saved override. */
const DEFAULT_TURN_MS = 120_000;

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export interface LauncherCommand {
  command: string;
  args: readonly string[];
}

/** Runtime metadata keeps copied commands usable from another terminal or agent's working directory. */
export function launcherPrefix(launcher?: LauncherCommand | undefined): string {
  return launcher ? [launcher.command, ...launcher.args].map(shellQuote).join(" ") : "bun run start --";
}

export { shellQuote };

/** One catalog model for the quick-setup `<select>` (plus the 「その他（手入力）」 entry the UI adds). */
export interface SetupModelOption {
  /** Full model id as stored in settings. */
  id: string;
  /** Display name. */
  displayName: string;
  /** Efforts this model accepts (empty = the engine ignores effort). */
  efforts: readonly ReasoningEffort[];
  /** Default effort (null when the model ignores effort). */
  defaultEffort: ReasoningEffort | null;
  /** False for 価格非公開 models (setup needs explicit prices). */
  priceKnown: boolean;
}

function catalogKeyFor(provider: SetupProvider, opts: { api?: boolean | undefined; cli?: boolean | undefined }): ModelCatalogKey | null {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "codex";
  if (provider === "muse") return "muse";
  if (provider === "grok" && opts.cli && !opts.api) return "grok-cli";
  if (provider === "grok" && opts.api && !opts.cli) return "grok-api";
  return null;
}

/** Catalog models of a quick-setup provider (empty for free-form providers and external sessions). */
export function setupModelOptions(provider: SetupProvider, opts: { api?: boolean; cli?: boolean }): SetupModelOption[] {
  const key = catalogKeyFor(provider, opts);
  if (key === null) return [];
  return MODEL_CATALOG[key].models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    efforts: m.efforts,
    defaultEffort: m.defaultEffort,
    priceKnown: m.pricing !== null,
  }));
}

/** Default model id of a quick-setup provider ("" for free-form providers). */
export function setupDefaultModel(provider: SetupProvider, opts: { api?: boolean; cli?: boolean }): string {
  const key = catalogKeyFor(provider, opts);
  return key === null ? "" : MODEL_CATALOG[key].defaultModel;
}

/**
 * Whether a quick-setup model slug has a known price (the CLI reads the same catalog:
 * priced entries need no `--in-price` / `--out-price`). Null for free-form providers
 * and external sessions (the old endpoint/cloud rules decide there); an empty slug selects
 * the provider default, and an unlisted slug is price-unknown.
 */
export function setupModelPriceKnown(
  provider: SetupProvider,
  opts: { api?: boolean | undefined; cli?: boolean | undefined },
  modelSlug: string | undefined,
): boolean | null {
  const key = catalogKeyFor(provider, opts);
  if (key === null) return null;
  const slug = modelSlug?.trim() || MODEL_CATALOG[key].defaultModel.split(":").at(-1);
  const prefix = key === "claude" ? "" : key === "codex" ? "codex:" : key === "grok-cli" ? "grok:" : "generic:";
  const entry = MODEL_CATALOG[key].models.find((m) => m.id === `${prefix}${slug}`);
  if (!entry) return false;
  return entry.pricing !== null;
}

/** `mitori setup ...` command re-registering a switched-to model with its prices (mirrors the server hint). */
export function switchSetupHint(modelId: string): string {
  const slug = modelId.split(":").at(-1) ?? modelId;
  if (modelId.startsWith("codex:")) return `mitori setup codex --native --model '${slug}' --max-estimated-usd <n> [--in-price <n> --out-price <n>]`;
  if (modelId.startsWith("grok:")) return `mitori setup grok --cli --model '${slug}' [--in-price <n> --out-price <n>]`;
  if (modelId === "generic:grok-4.7") return `mitori setup grok --api --model 'grok-4.7' --in-price <n> --out-price <n>`;
  if (modelId.startsWith("generic:muse-")) return `mitori setup muse --model '${slug}'`;
  if (modelId.startsWith("generic:")) return `mitori setup <provider> --model '${slug}' --in-price <n> --out-price <n>`;
  return `mitori setup claude --model '${slug}'`;
}

/** Server model-switch refusal reasons (`params.reason` of the `E_INVALID_INPUT` error) to i18n keys. */
export function switchErrorKey(reason: string | undefined): string {
  switch (reason) {
    case "price-unknown":
      return "settings.switchPriceUnknown";
    case "engine-missing":
      return "settings.switchEngineMissing";
    case "model-unknown":
      return "settings.switchModelUnknown";
    case "effort-unsupported":
      return "settings.switchBadEffort";
    default:
      return "settings.providerInvalid";
  }
}

/** Default effort of a quick-setup provider (Claude high, Codex high, Grok low, Muse max, others high). */
export function setupDefaultEffort(provider: SetupProvider): ReasoningEffort {
  if (provider === "muse") return "max";
  if (provider === "grok") return "low";
  return "high";
}

/**
 * Models the settings-page switcher can offer: catalog models of the enabled engines, plus models
 * already in use (custom entries stay selectable so a switch never strands the current value).
 */
export function switchableModels(settings: GlobalSettings): SetupModelOption[] {
  const views: ModelCatalogKey[] = [];
  if (settings.engines["claude-cli"]?.enabled) views.push("claude");
  if (settings.engines["codex-cli"]?.enabled) views.push("codex");
  if (settings.engines["grok-cli"]?.enabled) views.push("grok-cli");
  if (settings.engines.generic?.enabled) views.push("muse", "grok-api");
  const out: SetupModelOption[] = [];
  const seen = new Set<string>();
  for (const view of views)
    for (const m of MODEL_CATALOG[view].models) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, displayName: m.displayName, efforts: m.efforts, defaultEffort: m.defaultEffort, priceKnown: m.pricing !== null });
    }
  for (const id of Object.values(settings.models)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, displayName: id, efforts: EFFORTS, defaultEffort: null, priceKnown: true });
  }
  return out;
}

export function providerAuthCommand(provider: ProviderAuthId, launcher?: LauncherCommand | undefined): string {
  if (!PROVIDER_AUTH_IDS.includes(provider)) throw new Error("settings.providerInvalid");
  return `${launcherPrefix(launcher)} auth ${provider}`;
}

/** The existing CLI owns execution settings; single quotes keep JSON argv literal in a POSIX shell. */
export function genericProviderCommand(patch: DeepPartial<GlobalSettings>, launcher?: LauncherCommand | undefined): string {
  return `${launcherPrefix(launcher)} config set engines.generic ${shellQuote(JSON.stringify(patch.engines?.generic))}`;
}

/** Efforts the setup CLI accepts (`mitori setup --effort`). */
export const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
export const SETUP_PROVIDERS = ["claude", "muse", "grok", "ollama", "lmstudio", "openai", "codex", "cursor", "antigravity"] as const;
export type SetupProvider = (typeof SETUP_PROVIDERS)[number];

/**
 * Engines the advanced details select offers directly. The CLI engines stay guided-only: their
 * models and execution settings are set through the guided commands above, never PATCHed here.
 */
export const ADVANCED_ENGINES = ["claude-cli", "anthropic-api", "session", "generic"] as const;

/**
 * Keep the guided Grok model on its mode's default when toggling API/CLI: the API preset bills
 * grok-4.7 while the CLI runs grok-4.7-build-fast, and sending the CLI default with --api needs
 * explicit prices so the command builder rejects it. A custom model is left alone.
 */
export function syncGrokGuidedModel(current: string, opts: { api: boolean; cli: boolean }): string {
  const model = current.trim();
  if (opts.api && !opts.cli && model === "grok-4.7-build-fast") return "grok-4.7";
  if (opts.cli && !opts.api && model === "grok-4.7") return "grok-4.7-build-fast";
  return current;
}

/** Keep endpoint validation aligned with the API adapter, before generating any executable command. */
function apiSettings(baseUrl: string, keyEnv: string | undefined): { baseUrl: string; keyEnv?: string } {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\//.test(baseUrl))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/+$/, "").endsWith("/v1") ||
    (keyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(keyEnv)) ||
    (!local && !keyEnv)
  )
    throw new Error("settings.providerInvalid");
  return { baseUrl, ...(keyEnv ? { keyEnv } : {}) };
}

/** A guided preset still registers execution settings in the human's terminal, never through PATCH /settings. */
export function providerSetupCommand(
  input: {
    provider: SetupProvider;
    api?: boolean;
    native?: boolean;
    /** Grok Build CLI engine instead of the session (`setup grok --cli`). */
    cli?: boolean;
    maxEstimatedUsd?: number | undefined;
    model?: string;
    repo?: string | undefined;
    baseUrl?: string;
    keyEnv?: string;
    inputPrice?: number | undefined;
    outputPrice?: number | undefined;
    /** Reasoning effort for providers whose CLI preset takes one (Muse, native Codex, Grok CLI). */
    effort?: ReasoningEffort | undefined;
  },
  launcher?: LauncherCommand | undefined,
): string {
  if (!SETUP_PROVIDERS.includes(input.provider)) throw new Error("settings.providerInvalid");
  if (input.native && input.provider !== "codex") throw new Error("settings.providerInvalid");
  if (input.cli && input.provider !== "grok") throw new Error("settings.providerInvalid");
  if (input.cli && input.api) throw new Error("settings.providerInvalid");
  const args: string[] = [];
  const add = (flag: string, value: string) => {
    args.push(flag, shellQuote(value));
  };
  const model = input.model?.trim();
  if (model && (/\s/u.test(model) || [...model].some((c) => c.charCodeAt(0) < 32))) throw new Error("settings.providerInvalid");
  if ((["codex", "cursor", "antigravity"].includes(input.provider) && !input.native) || (input.provider === "grok" && !input.api && !input.cli)) {
    if (!input.repo?.trim() || [...input.repo].some((c) => c.charCodeAt(0) < 32)) throw new Error("settings.providerInvalid");
    add("--repo", input.repo.trim());
  } else {
    if (input.native) {
      if (input.maxEstimatedUsd === undefined || !Number.isFinite(input.maxEstimatedUsd) || input.maxEstimatedUsd <= 0)
        throw new Error("settings.providerInvalid");
      args.push("--native");
      add("--max-estimated-usd", String(input.maxEstimatedUsd));
    }
    if (input.provider === "grok" && input.cli) args.push("--cli");
    else if (input.provider === "grok") args.push("--api");
    let remoteApi = false;
    if (["ollama", "lmstudio", "openai"].includes(input.provider) && !model) throw new Error("settings.providerInvalid");
    if (model) add("--model", model);
    if (input.effort && (input.provider === "claude" || input.provider === "muse" || input.native || (input.provider === "grok" && input.cli))) {
      if (!EFFORTS.includes(input.effort)) throw new Error("settings.providerInvalid");
      add("--effort", input.effort);
    }
    if (["grok", "ollama", "lmstudio", "openai"].includes(input.provider) && !(input.provider === "grok" && input.cli)) {
      const baseUrl =
        input.baseUrl?.trim() ||
        ({ grok: "https://api.x.ai/v1", ollama: "http://127.0.0.1:11434/v1", lmstudio: "http://127.0.0.1:1234/v1" } as Record<string, string>)[input.provider];
      const keyEnv = input.keyEnv?.trim() || (input.provider === "grok" ? "XAI_API_KEY" : undefined);
      if (!baseUrl) throw new Error("settings.providerInvalid");
      const api = apiSettings(baseUrl, keyEnv);
      remoteApi = !["localhost", "127.0.0.1", "[::1]"].includes(new URL(api.baseUrl).hostname);
      add("--base-url", api.baseUrl);
      if (api.keyEnv) add("--key-env", api.keyEnv);
    }
    const cloud = ["ollama", "lmstudio"].includes(input.provider) && /(?:[:-]cloud)$/i.test(model ?? "");
    // Priced catalog entries need no explicit prices (same list the CLI reads); price-unknown
    // entries and custom slugs do. Free-form providers keep the old endpoint/cloud rules.
    const priceKnown = setupModelPriceKnown(input.provider, { api: input.api, cli: input.cli }, model);
    const needsPrices =
      input.provider === "openai" || priceKnown === false || (priceKnown === null && ((["ollama", "lmstudio"].includes(input.provider) && remoteApi) || cloud));
    if (needsPrices || input.inputPrice !== undefined || input.outputPrice !== undefined) {
      if (
        ![input.inputPrice, input.outputPrice].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0) ||
        ((remoteApi || cloud) && input.inputPrice === 0 && input.outputPrice === 0)
      )
        throw new Error("settings.providerInvalid");
      add("--in-price", String(input.inputPrice));
      add("--out-price", String(input.outputPrice));
    }
  }
  return `${launcherPrefix(launcher)} setup ${input.provider}${args.length ? ` ${args.join(" ")}` : ""}`;
}

/** Build a settings patch; argv is an array, never a shell command string. */
export function genericProviderPatch(input: {
  model: string;
  argv: string;
  reasoning: ReasoningEffort;
  protocol: "text" | "muse-jsonl" | "openai-chat";
  baseUrl?: string;
  keyEnv?: string;
  pricing: { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number };
  turnMs?: number;
}): DeepPartial<GlobalSettings> {
  if (!/^generic:\S+$/u.test(input.model) || [...input.model].some((c) => c.charCodeAt(0) < 32)) throw new Error("settings.providerInvalid");
  const argv: unknown = input.protocol === "openai-chat" ? [] : JSON.parse(input.argv);
  if (
    !Array.isArray(argv) ||
    (input.protocol !== "openai-chat" && (!argv.length || typeof argv[0] !== "string" || !argv[0].trim())) ||
    !argv.every((v) => typeof v === "string" && !v.includes("\0"))
  )
    throw new Error("settings.providerInvalid");
  if (!Object.values(input.pricing).every((v) => Number.isFinite(v) && v >= 0)) throw new Error("settings.providerInvalid");
  if (input.turnMs !== undefined && (!Number.isInteger(input.turnMs) || input.turnMs < 1_000 || input.turnMs > 3_600_000))
    throw new Error("settings.providerInvalid");
  const model = input.model as `generic:${string}`;
  const api = input.protocol === "openai-chat" ? apiSettings(input.baseUrl?.trim() ?? "", input.keyEnv?.trim() || undefined) : undefined;
  if (
    api &&
    (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(api.baseUrl).hostname) || /(?:[:-]cloud)$/i.test(input.model)) &&
    input.pricing.inPerMTok === 0 &&
    input.pricing.outPerMTok === 0
  )
    throw new Error("settings.providerInvalid");
  return {
    defaultEngine: "generic",
    defaultGenEngine: "generic",
    engines: {
      generic: { enabled: true, argv, protocol: input.protocol, ...(api ? { api } : {}), pricing: input.pricing, turnMs: input.turnMs ?? DEFAULT_TURN_MS },
    },
    models: { answer: model, patch: model, agent: model, genModule: model, genOverview: model, genLeaf: model, judge: model, rewrite: model, escalate: model },
    reasoning: { answer: input.reasoning, patch: input.reasoning, agent: input.reasoning, gen: input.reasoning, genOverview: input.reasoning },
  };
}

/** Muse's argv excludes the auto-updating launcher; the adapter also disables personal context / reminder hooks. */
export const MUSE_ARGS = [
  "exec",
  "--json",
  "--model",
  "{model}",
  "--reasoning-effort",
  "{effort}",
  "--prompt-file",
  "{promptFile}",
  "--workspace",
  "{emptyCwd}",
  "--worktree",
  "off",
  "--disable-shell",
  "--disable-write",
  "--disable-web-tools",
  "--no-foreign-personal-context",
  "--no-session-log",
  "--max-model-steps",
  "1",
  "--approval-mode",
  "untrusted",
  "--approval-judge",
  "off",
];
