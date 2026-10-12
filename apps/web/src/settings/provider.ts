import { type DeepPartial, type GlobalSettings, PROVIDER_AUTH_IDS, type ProviderAuthId, type ReasoningEffort } from "@mitori/core";

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
    maxEstimatedUsd?: number | undefined;
    model?: string;
    repo?: string | undefined;
    baseUrl?: string;
    keyEnv?: string;
    inputPrice?: number | undefined;
    outputPrice?: number | undefined;
    /** Reasoning effort for providers whose CLI preset takes one (Muse, native Codex). */
    effort?: ReasoningEffort | undefined;
  },
  launcher?: LauncherCommand | undefined,
): string {
  if (!SETUP_PROVIDERS.includes(input.provider)) throw new Error("settings.providerInvalid");
  if (input.native && input.provider !== "codex") throw new Error("settings.providerInvalid");
  const args: string[] = [];
  const add = (flag: string, value: string) => {
    args.push(flag, shellQuote(value));
  };
  const model = input.model?.trim();
  if (model && (/\s/u.test(model) || [...model].some((c) => c.charCodeAt(0) < 32))) throw new Error("settings.providerInvalid");
  if ((["codex", "cursor", "antigravity"].includes(input.provider) && !input.native) || (input.provider === "grok" && !input.api)) {
    if (!input.repo?.trim() || [...input.repo].some((c) => c.charCodeAt(0) < 32)) throw new Error("settings.providerInvalid");
    add("--repo", input.repo.trim());
  } else {
    if (input.native) {
      if (input.maxEstimatedUsd === undefined || !Number.isFinite(input.maxEstimatedUsd) || input.maxEstimatedUsd <= 0)
        throw new Error("settings.providerInvalid");
      args.push("--native");
      add("--max-estimated-usd", String(input.maxEstimatedUsd));
    }
    if (input.provider === "grok") args.push("--api");
    let remoteApi = false;
    if (["ollama", "lmstudio", "openai"].includes(input.provider) && !model) throw new Error("settings.providerInvalid");
    if (model) add("--model", model);
    if (input.effort && (input.provider === "muse" || input.native)) {
      if (!EFFORTS.includes(input.effort)) throw new Error("settings.providerInvalid");
      add("--effort", input.effort);
    }
    if (["grok", "ollama", "lmstudio", "openai"].includes(input.provider)) {
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
    const needsPrices =
      input.provider === "openai" ||
      (input.provider === "codex" && !!model && model !== "gpt-6.1-sol") ||
      (input.provider === "muse" && !!model && model !== "muse-spark-1.3-contributor") ||
      (input.provider === "grok" && !!model && model !== "grok-4.7") ||
      (["ollama", "lmstudio"].includes(input.provider) && remoteApi) ||
      cloud;
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
