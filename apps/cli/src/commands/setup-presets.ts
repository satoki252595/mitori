/** Human setup presets. No provider credentials or execution settings come from the repository. */
import type { DeepPartial, EngineSettings, GlobalSettings, ModelId, ReasoningEffort } from "@mitori/core";
import { usage } from "./io.ts";

export const PROVIDERS = ["claude", "muse", "grok", "ollama", "lmstudio", "openai", "codex", "cursor", "antigravity"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const SESSION_PROVIDERS = new Set<Provider>(["codex", "cursor", "antigravity", "grok"]);

// ADR-0015 profile; kept equal to the adapter's required flags, never the auto-updating Muse launcher.
const MUSE_ARGS = [
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
export interface SetupInput {
  provider: Provider;
  api?: boolean;
  binary?: string;
  model?: string;
  baseUrl?: string;
  keyEnv?: string;
  effort?: ReasoningEffort;
  pricing?: EngineSettings["generic"]["pricing"];
}

function models(model: ModelId): GlobalSettings["models"] {
  return { answer: model, patch: model, agent: model, genModule: model, genOverview: model, genLeaf: model, judge: model, rewrite: model, escalate: model };
}

/** Explicit prices for known presets; custom remote models cannot silently inherit another model's rates. */
export function setupPatch(input: SetupInput): DeepPartial<GlobalSettings> {
  const { provider } = input;
  if (SESSION_PROVIDERS.has(provider) && !input.api)
    return { defaultEngine: "session", defaultGenEngine: "session", engines: { session: { enabled: true } }, ui: { defaultExecPath: "copy" } };
  if (provider === "claude") {
    const model = input.model ?? "claude-sonnet-5-5";
    if (!["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"].includes(model)) throw usage("unsupported Claude model id", "mitori setup --help");
    return {
      defaultEngine: "claude-cli",
      defaultGenEngine: "claude-cli",
      ui: { defaultExecPath: "push" },
      models: models(model as ModelId),
      engines: {
        "claude-cli": { enabled: true, binary: input.binary ?? "claude", inheritUserSettings: false, envPassthrough: [], warmPool: 0, persistSessions: false },
      },
    };
  }
  const local = provider === "ollama" || provider === "lmstudio";
  const model = input.model ?? (provider === "muse" ? "muse-spark-1.3-contributor" : provider === "grok" ? "grok-4.7" : "");
  if (!/^\S{1,92}$/u.test(model) || [...model].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    throw usage("name your installed/available model with --model <id>", "mitori setup --help");
  const cloud = local && /(?:[:-]cloud)$/i.test(model);
  if (cloud && !input.pricing) throw usage("cloud models need explicit --in-price and --out-price; choose an installed local model");
  const pricing =
    input.pricing ??
    (local
      ? { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 }
      : provider === "muse" && model === "muse-spark-1.3-contributor"
        ? { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 }
        : provider === "grok" && model === "grok-4.7"
          ? { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 }
          : undefined);
  if (!pricing) throw usage("custom remote models need --in-price and --out-price (USD per million tokens)");
  if (!Object.values(pricing).every((n) => Number.isFinite(n) && n >= 0)) throw usage("prices must be finite non-negative numbers");
  if (cloud && pricing.inPerMTok === 0 && pricing.outPerMTok === 0) throw usage("cloud models need nonzero --in-price or --out-price");
  const effort = input.effort ?? (provider === "muse" ? "max" : "high");
  const generic: EngineSettings["generic"] =
    provider === "muse"
      ? { enabled: true, argv: [input.binary ?? "", ...MUSE_ARGS], protocol: "muse-jsonl", pricing, turnMs: 600_000 }
      : {
          enabled: true,
          argv: [],
          protocol: "openai-chat",
          pricing,
          turnMs: 600_000,
          api: {
            baseUrl:
              input.baseUrl ??
              (provider === "grok"
                ? "https://api.x.ai/v1"
                : provider === "ollama"
                  ? "http://localhost:11434/v1"
                  : provider === "lmstudio"
                    ? "http://localhost:1234/v1"
                    : ""),
            ...(input.keyEnv ? { keyEnv: input.keyEnv } : provider === "grok" ? { keyEnv: "XAI_API_KEY" } : {}),
          },
        };
  if (provider === "muse" && !generic.argv[0]?.startsWith("/")) throw usage("Muse needs a native binary path; use --binary /absolute/path/muse-bin-version");
  if (generic.protocol === "openai-chat") {
    let url: URL;
    try {
      url = new URL(generic.api?.baseUrl ?? "");
    } catch {
      throw usage("--base-url must be an absolute URL ending in /v1");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && loopback && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\//.test(generic.api?.baseUrl ?? ""))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.replace(/\/+$/, "").endsWith("/v1")
    )
      throw usage("API URLs need /v1, HTTPS remotely, and no embedded credentials/query/hash");
    if (!loopback && (!generic.api?.keyEnv || (pricing.inPerMTok === 0 && pricing.outPerMTok === 0)))
      throw usage("remote APIs need --key-env and nonzero prices");
    if (local && !loopback && !input.pricing) throw usage("local presets need a loopback URL; specify prices for a remote API");
  }
  return {
    defaultEngine: "generic",
    defaultGenEngine: "generic",
    ui: { defaultExecPath: "push" },
    engines: { generic },
    models: models(`generic:${model}`),
    reasoning: { answer: effort, patch: effort, agent: effort, gen: effort, genOverview: effort },
  };
}
