/** Human setup presets. No provider credentials or execution settings come from the repository. */
import {
  CLAUDE_MODEL_IDS,
  type DeepPartial,
  type EngineSettings,
  type GlobalSettings,
  MODEL_CATALOG,
  type ModelCatalogKey,
  type ModelId,
  type ReasoningEffort,
} from "@mitori/core";
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
  native?: boolean;
  /** `setup grok --cli` / `setup antigravity --cli`: use the CLI engine instead of the session. */
  cli?: boolean;
  maxEstimatedUsd?: number;
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

/** Priced entries of a catalog view, keyed by model slug (price-unknown models stay custom). */
function knownPrices(view: ModelCatalogKey): Record<string, NonNullable<EngineSettings["codex-cli"]["pricing"]>> {
  return Object.fromEntries(
    MODEL_CATALOG[view].models
      .filter((m) => m.pricing !== null)
      .map((m) => [m.id.split(":").at(-1) as string, m.pricing as NonNullable<EngineSettings["codex-cli"]["pricing"]>]),
  );
}

/** The catalog view a setup run configures (null for free-form providers and external sessions). */
function catalogView(input: Pick<SetupInput, "provider" | "api" | "cli" | "native">): ModelCatalogKey | null {
  if (input.provider === "claude") return "claude";
  if (input.provider === "codex" && input.native) return "codex";
  if (input.provider === "grok" && input.cli && !input.api) return "grok-cli";
  if (input.provider === "grok" && input.api && !input.cli) return "grok-api";
  if (input.provider === "muse") return "muse";
  if (input.provider === "antigravity" && input.cli) return "antigravity";
  return null;
}

/**
 * An explicit `--effort` must be one the listed model accepts (usage error naming the usable ones).
 * Unlisted models and omitted `--effort` keep the old behavior; `claude-haiku-4-5` ignores effort,
 * so an explicit `--effort` for it is rejected while stored defaults stay untouched.
 */
function checkEffort(input: Pick<SetupInput, "provider" | "api" | "cli" | "native" | "model" | "effort">): void {
  if (input.effort === undefined) return;
  const view = catalogView(input);
  if (view === null) return;
  const full = (input.model ?? MODEL_CATALOG[view].defaultModel.split(":").at(-1)) as string;
  const prefix = view === "claude" ? "" : view === "codex" ? "codex:" : view === "grok-cli" ? "grok:" : view === "antigravity" ? "antigravity:" : "generic:";
  const id = `${prefix}${full}`;
  const entry = MODEL_CATALOG[view].models.find((m) => m.id === id);
  if (!entry) return;
  if (entry.efforts.length === 0) throw usage(`model ${id} does not take --effort`, "mitori setup --help");
  if (!(entry.efforts as readonly string[]).includes(input.effort))
    throw usage(`model ${id} takes --effort ${(entry.efforts as readonly string[]).join("|")}`, "mitori setup --help");
}

/** Explicit prices for known presets; custom remote models cannot silently inherit another model's rates. */
export function setupPatch(input: SetupInput): DeepPartial<GlobalSettings> {
  const { provider } = input;
  if (input.native && provider !== "codex") throw usage("--native is supported for Codex only");
  if (input.cli && ((provider !== "grok" && provider !== "antigravity") || input.api))
    throw usage("--cli selects the Grok Build CLI or Antigravity CLI engine (not with --api)");
  checkEffort(input);
  if (provider === "antigravity" && input.cli && !input.api) {
    const model = input.model ?? "gemini-3.8-flash";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,91}$/.test(model)) throw usage("invalid Antigravity model id");
    // WP40: higher published estimates (no official table confirmed, 2026-11-04): Flash in 1.5 /
    // out 7.5 (cache read 0.15); Argon in 4 / out 20 (cache read 0.2). thinking is billed as output.
    const known = knownPrices("antigravity");
    const pricing = input.pricing ?? known[model];
    if (!pricing || !Object.values(pricing).every((n) => Number.isFinite(n) && n >= 0))
      throw usage("other Antigravity models need --in-price and --out-price (USD per million tokens)");
    // Keep the other known price on the engine so switching models needs no re-setup.
    const pricingByModel = Object.fromEntries(Object.entries(known).filter(([slug]) => slug !== model));
    // --effort omitted ⇒ low (fast; the host decides whether measurements change this)
    const effort = input.effort ?? "low";
    return {
      defaultEngine: "antigravity-cli",
      defaultGenEngine: "antigravity-cli",
      ui: { defaultExecPath: "push" },
      engines: {
        "antigravity-cli": {
          enabled: true,
          binary: input.binary ?? "agy",
          model,
          pricing,
          ...(Object.keys(pricingByModel).length ? { pricingByModel } : {}),
          turnMs: 1_200_000,
        },
      },
      models: models(`antigravity:${model}`),
      reasoning: { answer: effort, patch: effort, agent: effort, gen: effort, genOverview: effort },
    };
  }
  if (provider === "codex" && input.native) {
    const model = input.model ?? "gpt-6.1-sol";
    const maxEstimatedSpendUsd = input.maxEstimatedUsd;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,91}$/.test(model)) throw usage("invalid Codex model id");
    if (maxEstimatedSpendUsd === undefined || !Number.isFinite(maxEstimatedSpendUsd) || maxEstimatedSpendUsd <= 0)
      throw usage("Codex native needs --max-estimated-usd N; native reasoning has no hard spending cap");
    // Standard API-equivalent prices; subscription billing is provider-owned.
    // gpt-5.6 pair: OpenAI 2026-07-30 revision (cache read = 0.1× input); gpt-6-luna has no public price.
    const known = knownPrices("codex");
    const pricing = input.pricing ?? known[model];
    // Keep the other known prices on the engine so switching models needs no re-setup.
    const pricingByModel = Object.fromEntries(Object.entries(known).filter(([slug]) => slug !== model));
    if (!pricing || !Object.values(pricing).every((n) => Number.isFinite(n) && n >= 0) || (pricing.inPerMTok === 0 && pricing.outPerMTok === 0))
      throw usage("custom Codex models need nonzero --in-price and --out-price");
    const effort = input.effort ?? "high";
    return {
      defaultEngine: "codex-cli",
      defaultGenEngine: "codex-cli",
      ui: { defaultExecPath: "push" },
      engines: {
        "codex-cli": {
          enabled: true,
          binary: input.binary ?? "codex",
          model,
          pricing,
          ...(Object.keys(pricingByModel).length ? { pricingByModel } : {}),
          maxEstimatedSpendUsd,
        },
      },
      models: models(`codex:${model}`),
      reasoning: { answer: effort, patch: effort, agent: effort, gen: effort, genOverview: effort },
    };
  }
  if (provider === "grok" && input.cli && !input.api) {
    const model = input.model ?? "grok-4.7-build-fast";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,91}$/.test(model)) throw usage("invalid Grok model id");
    // Preset prices are the inverse of grok's own reported USD (not an official price table, WP36h):
    // build-fast ≈ in 4 / out 12, grok-4.7 ≈ in 2 / out 6 (USD per million tokens, host-measured 2026-11-03).
    const known = knownPrices("grok-cli");
    const pricing = input.pricing ?? known[model];
    if (!pricing || !Object.values(pricing).every((n) => Number.isFinite(n) && n >= 0))
      throw usage("other Grok CLI models need --in-price and --out-price (USD per million tokens)");
    // Keep the other known price on the engine so switching models needs no re-setup.
    const pricingByModel = Object.fromEntries(Object.entries(known).filter(([slug]) => slug !== model));
    // --effort omitted ⇒ low (medium+ reasons for 10+ minutes per task on the measured calls, WP36h)
    const effort = input.effort ?? "low";
    return {
      defaultEngine: "grok-cli",
      defaultGenEngine: "grok-cli",
      ui: { defaultExecPath: "push" },
      engines: {
        "grok-cli": {
          enabled: true,
          binary: input.binary ?? "grok",
          model,
          pricing,
          ...(Object.keys(pricingByModel).length ? { pricingByModel } : {}),
          turnMs: 1_200_000,
        },
      },
      models: models(`grok:${model}`),
      reasoning: { answer: effort, patch: effort, agent: effort, gen: effort, genOverview: effort },
    };
  }
  if (SESSION_PROVIDERS.has(provider) && !input.api && !input.cli)
    return { defaultEngine: "session", defaultGenEngine: "session", engines: { session: { enabled: true } }, ui: { defaultExecPath: "copy" } };
  if (provider === "claude") {
    const model = input.model ?? "claude-sonnet-5-5";
    if (!(CLAUDE_MODEL_IDS as readonly string[]).includes(model)) throw usage("unsupported Claude model id", "mitori setup --help");
    return {
      defaultEngine: "claude-cli",
      defaultGenEngine: "claude-cli",
      ui: { defaultExecPath: "push" },
      models: models(model as ModelId),
      engines: {
        "claude-cli": { enabled: true, binary: input.binary ?? "claude", inheritUserSettings: false, envPassthrough: [], warmPool: 0, persistSessions: false },
      },
      // --effort omitted ⇒ high on all five scopes (WP36c)
      reasoning: {
        answer: input.effort ?? "high",
        patch: input.effort ?? "high",
        agent: input.effort ?? "high",
        gen: input.effort ?? "high",
        genOverview: input.effort ?? "high",
      },
    };
  }
  const local = provider === "ollama" || provider === "lmstudio";
  const model = input.model ?? (provider === "muse" ? "muse-spark-1.3-contributor" : provider === "grok" ? "grok-4.7" : "");
  if (!/^\S{1,92}$/u.test(model) || [...model].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    throw usage("name your installed/available model with --model <id>", "mitori setup --help");
  const cloud = local && /(?:[:-]cloud)$/i.test(model);
  if (cloud && !input.pricing) throw usage("cloud models need explicit --in-price and --out-price; choose an installed local model");
  // Fixed-model prices come from the catalog (same values, moved not changed).
  const musePrice = MODEL_CATALOG.muse.models.find((m) => m.id === "generic:muse-spark-1.3-contributor")?.pricing ?? undefined;
  const grokApiPrice = MODEL_CATALOG["grok-api"].models.find((m) => m.id === "generic:grok-4.7")?.pricing ?? undefined;
  const pricing =
    input.pricing ??
    (local
      ? { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 }
      : provider === "muse" && model === "muse-spark-1.3-contributor"
        ? musePrice
        : provider === "grok" && model === "grok-4.7"
          ? grokApiPrice
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

const priceCell = (p: { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number } | null, lang: "ja" | "en"): string =>
  p === null ? (lang === "ja" ? "価格非公開" : "price unknown") : `${p.inPerMTok}/${p.outPerMTok}/${p.cacheReadPerMTok}`;

const VIEW_LEAD: Record<ModelCatalogKey, { ja: string; en: string }> = {
  claude: { ja: "Claude Codeで使うモデルの一覧", en: "Models for Claude Code" },
  codex: { ja: "Codexで直接実行するモデルの一覧", en: "Models for direct Codex runs" },
  "grok-cli": { ja: "Grok Build CLIで直接実行するモデルの一覧", en: "Models for direct Grok Build CLI runs" },
  "grok-api": { ja: "Grok APIで使うモデルの一覧", en: "Models for the Grok API" },
  muse: { ja: "Museで使うモデルの一覧", en: "Models for Muse" },
  antigravity: { ja: "Antigravity CLIで直接実行するモデルの一覧", en: "Models for direct Antigravity CLI runs" },
};

/**
 * `setup <provider> --list-models`: the selectable models, usable efforts, defaults and prices.
 * TTY 不要、設定は変えない。Free-form providers and external sessions get a guidance line instead.
 */
export function listModelsTable(provider: Provider, opts: { api?: boolean; cli?: boolean }, lang: "ja" | "en"): string {
  const lines: string[] = [];
  const view: ModelCatalogKey | null =
    provider === "claude"
      ? "claude"
      : provider === "codex"
        ? "codex"
        : provider === "muse"
          ? "muse"
          : provider === "grok" && opts.cli && !opts.api
            ? "grok-cli"
            : provider === "grok" && opts.api && !opts.cli
              ? "grok-api"
              : // the Antigravity CLI list is the only model list (the session uses the external tool's model)
                provider === "antigravity"
                ? "antigravity"
                : null;
  if (view === null) {
    if (lang === "ja")
      lines.push(
        provider === "grok"
          ? "Grok Buildのセッションは外部ツールのモデルを使います。一覧は `setup grok --cli --list-models`（CLI）か `setup grok --api --list-models`（API）で出ます。"
          : `${provider}に決まったモデル一覧はありません。--model で手元のモデル名を指定してください。`,
      );
    else
      lines.push(
        provider === "grok"
          ? "A Grok Build session uses the external tool's own model. List CLI models with `setup grok --cli --list-models` or the API model with `setup grok --api --list-models`."
          : `${provider} has no fixed model list. Name an installed model with --model.`,
      );
    return `${lines.join("\n")}\n`;
  }
  const catalog = MODEL_CATALOG[view];
  const defaults =
    lang === "ja" ? `（既定: ${catalog.defaultModel} / ${catalog.defaultEffort}）` : ` (defaults: ${catalog.defaultModel} / ${catalog.defaultEffort})`;
  lines.push(`${VIEW_LEAD[view][lang]}${defaults}`);
  lines.push(
    lang === "ja" ? "モデル | 使えるeffort | 価格USD/百万token（入力/出力/キャッシュ読み）" : "model | usable efforts | price USD/MTok (in/out/cache-read)",
  );
  for (const m of catalog.models) lines.push(`${m.id} | ${(m.efforts as readonly string[]).join("|") || "-"} | ${priceCell(m.pricing, lang)}`);
  return `${lines.join("\n")}\n`;
}
