/**
 * Web model/effort switch validation (WP39): `PATCH /settings` may change `models.*` and `reasoning.*`
 * only within already configured engines. Execution settings (`engines.*`, …) stay `E_FORBIDDEN_KEY`
 * via {@link checkSettingsPatch}; this module checks the switched-to values themselves. Pure.
 */
import {
  type EngineId,
  findCatalogModel,
  type GlobalSettings,
  MitoriError,
  type ModelDefaults,
  type ModelId,
  PRICING,
  type ReasoningEffort,
} from "@mitori/core";

/** Reasoning key → the model key it belongs to. */
const REASONING_MODEL: Record<keyof GlobalSettings["reasoning"], keyof ModelDefaults> = {
  answer: "answer",
  patch: "patch",
  agent: "agent",
  gen: "genModule",
  genOverview: "genOverview",
};

const engineOf = (id: ModelId): EngineId => {
  if (id.startsWith("codex:")) return "codex-cli";
  if (id.startsWith("grok:")) return "grok-cli";
  if (id.startsWith("generic:")) return "generic";
  return "claude-cli";
};

const setupHint = (engine: EngineId): string =>
  engine === "codex-cli"
    ? "run `mitori setup codex --native --model <slug> --max-estimated-usd <n> [--in-price <n> --out-price <n>]`"
    : engine === "grok-cli"
      ? "run `mitori setup grok --cli --model <id> [--in-price <n> --out-price <n>]`"
      : engine === "generic"
        ? "run `mitori setup <provider> --model <id> --in-price <n> --out-price <n>`"
        : "run `mitori setup claude --model <id>`";

/** Known API-equivalent prices for (engine, slug) in the current settings; undefined = 価格非公開. */
function knownPrice(current: GlobalSettings, engine: EngineId, slug: string): { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number } | undefined {
  if (engine === "claude-cli") {
    const p = (PRICING as Record<string, { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number }>)[slug];
    return p === undefined ? undefined : { inPerMTok: p.inPerMTok, outPerMTok: p.outPerMTok, cacheReadPerMTok: p.cacheReadPerMTok };
  }
  if (engine === "codex-cli" || engine === "grok-cli") {
    const cfg = current.engines[engine];
    return cfg.pricingByModel?.[slug] ?? (cfg.model === slug ? cfg.pricing : undefined);
  }
  return current.engines.generic.pricing;
}

/**
 * Refusal reasons the web settings page maps to i18n (`params.reason`); the message keeps
 * the English `mitori setup ...` hint for terminals, the web shows its own localized text.
 */
export type ModelSwitchReason = "engine-missing" | "model-unknown" | "price-unknown" | "effort-unsupported";

const invalid = (message: string, field: string, reason: ModelSwitchReason): MitoriError =>
  new MitoriError("E_INVALID_INPUT", message, { params: { field, reason } });

/**
 * Throw unless every changed `models.*` value is a listed model of its (configured) engine or a model
 * already in use, has known prices, and every changed `reasoning.*` value is usable by the
 * post-patch model of its role. `claude-haiku-4-5` ignores effort, so its stored reasoning is kept.
 */
export function checkModelSwitch(current: GlobalSettings, next: GlobalSettings): void {
  const changedReasoning = new Set<keyof GlobalSettings["reasoning"]>();
  for (const key of Object.keys(next.models) as (keyof ModelDefaults)[]) {
    if (next.models[key] === current.models[key]) continue;
    const id = next.models[key];
    const engine = engineOf(id);
    if (!current.engines[engine]?.enabled) throw invalid(`engine ${engine} is not configured`, `models.${key}`, "engine-missing");
    const slug = id.split(":").at(-1) as string;
    const found = findCatalogModel(id);
    if (!found && !(Object.values(current.models) as string[]).includes(id))
      throw invalid(`model ${id} is not a configured ${engine} model; ${setupHint(engine)}`, `models.${key}`, "model-unknown");
    if (knownPrice(current, engine, slug) === undefined)
      throw invalid(`model ${id} has no configured price; ${setupHint(engine)} with --in-price and --out-price`, `models.${key}`, "price-unknown");
    for (const [reasoning, model] of Object.entries(REASONING_MODEL) as [keyof GlobalSettings["reasoning"], keyof ModelDefaults][])
      if (model === key) changedReasoning.add(reasoning);
  }
  for (const key of Object.keys(next.reasoning) as (keyof GlobalSettings["reasoning"])[]) {
    if (next.reasoning[key] === current.reasoning[key] && !changedReasoning.has(key)) continue;
    const model = next.models[REASONING_MODEL[key]];
    const found = findCatalogModel(model);
    if (!found || found.entry.efforts.length === 0) continue;
    if (!(found.entry.efforts as readonly ReasoningEffort[]).includes(next.reasoning[key]))
      throw invalid(`model ${model} takes --effort ${(found.entry.efforts as readonly ReasoningEffort[]).join("|")}`, `reasoning.${key}`, "effort-unsupported");
  }
}
