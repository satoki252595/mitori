/**
 * Web model/effort switch validation (WP39): `PATCH /settings` may change `models.*` and `reasoning.*`
 * only within already configured engines. Execution settings (`engines.*`, …) stay `E_FORBIDDEN_KEY`
 * via {@link checkSettingsPatch}; this module checks the switched-to values themselves. Pure.
 */
import {
  type EngineId,
  engineForModel,
  findCatalogModel,
  type GlobalSettings,
  MitoriError,
  type ModelDefaults,
  type ModelId,
  modelFitsEngine,
  PRICING,
  REASONING_MODEL,
  type ReasoningEffort,
} from "@mitori/core";

/** Reasoning key → the model key it belongs to. */
const REASONING_MODEL_LOCAL = REASONING_MODEL;

const setupHint = (engine: EngineId): string =>
  engine === "codex-cli"
    ? "run `mitori setup codex --native --model <slug> --max-estimated-usd <n> [--in-price <n> --out-price <n>]`"
    : engine === "grok-cli"
      ? "run `mitori setup grok --cli --model <id> [--in-price <n> --out-price <n>]`"
      : engine === "antigravity-cli"
        ? "run `mitori setup antigravity --cli --model <id> [--in-price <n> --out-price <n>]`"
        : engine === "generic"
          ? "run `mitori setup <provider> --model <id> --in-price <n> --out-price <n>`"
          : "run `mitori setup claude --model <id>`";

/** Known API-equivalent prices for (engine, slug) in the current settings; undefined = 価格非公開. */
function knownPrice(current: GlobalSettings, engine: EngineId, slug: string): { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number } | undefined {
  if (engine === "claude-cli" || engine === "anthropic-api") {
    const p = (PRICING as Record<string, { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number }>)[slug];
    return p === undefined ? undefined : { inPerMTok: p.inPerMTok, outPerMTok: p.outPerMTok, cacheReadPerMTok: p.cacheReadPerMTok };
  }
  if (engine === "codex-cli" || engine === "grok-cli" || engine === "antigravity-cli") {
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

/** One changed model value: engine configured, listed or in use, priced. */
function checkModelValue(current: GlobalSettings, id: ModelId, field: string, engine: EngineId): void {
  // Claude の素 id は claude-cli と anthropic-api で共有する (profileFor と同じ名前空間)
  const enabled =
    engine === "claude-cli" || engine === "anthropic-api"
      ? current.engines["claude-cli"]?.enabled === true || current.engines["anthropic-api"]?.enabled === true
      : current.engines[engine]?.enabled === true;
  if (!enabled) throw invalid(`engine ${engine} is not configured`, field, "engine-missing");
  if (!modelFitsEngine(id, engine)) throw invalid(`model ${id} is not a ${engine} model`, field, "model-unknown");
  const slug = id.split(":").at(-1) as string;
  const found = findCatalogModel(id);
  // generic には決まったモデル一覧が無い (ollama・LM Studio・任意 API)。engine の価格があれば
  // 一覧に無いモデルも受け付ける (価格は engine 単位なので price-unknown にはならない)。
  const genericPriced = engine === "generic" && current.engines.generic.pricing !== undefined;
  if (!found && !genericPriced && !(Object.values(current.models) as string[]).includes(id))
    throw invalid(`model ${id} is not a configured ${engine} model; ${setupHint(engine)}`, field, "model-unknown");
  if (knownPrice(current, engine, slug) === undefined)
    throw invalid(`model ${id} has no configured price; ${setupHint(engine)} with --in-price and --out-price`, field, "price-unknown");
}

/** One changed reasoning value: usable by the post-patch model of its role. */
function checkReasoningValue(next: GlobalSettings, key: keyof GlobalSettings["reasoning"], field: string): void {
  const model = next.models[REASONING_MODEL_LOCAL[key]];
  const found = findCatalogModel(model);
  if (!found || found.entry.efforts.length === 0) return;
  if (!(found.entry.efforts as readonly ReasoningEffort[]).includes(next.reasoning[key]))
    throw invalid(`model ${model} takes --effort ${(found.entry.efforts as readonly ReasoningEffort[]).join("|")}`, field, "effort-unsupported");
}

/**
 * Throw unless every changed `models.*` / `engineProfiles.*.*` value is a listed model of its (configured)
 * engine or a model already in use, has known prices, and every changed `reasoning.*` value is usable by the
 * post-patch model of its role. `claude-haiku-4-5` ignores effort, so its stored reasoning is kept.
 * `genLeaf` (anthropic-api Batch 専用) の検証は `models.*` の側で行い、プロファイル側では触れない。
 */
export function checkModelSwitch(current: GlobalSettings, next: GlobalSettings): void {
  const changedReasoning = new Set<keyof GlobalSettings["reasoning"]>();
  for (const key of Object.keys(next.models) as (keyof ModelDefaults)[]) {
    if (next.models[key] === current.models[key]) continue;
    checkModelValue(current, next.models[key], `models.${key}`, engineForModel(next.models[key]));
    for (const [reasoning, model] of Object.entries(REASONING_MODEL_LOCAL) as [keyof GlobalSettings["reasoning"], keyof ModelDefaults][])
      if (model === key) changedReasoning.add(reasoning);
  }
  for (const [engine, profile] of Object.entries(next.engineProfiles ?? {}) as [EngineId, NonNullable<GlobalSettings["engineProfiles"][EngineId]>][]) {
    const prev = current.engineProfiles?.[engine];
    for (const [role, id] of Object.entries(profile.models ?? {}) as [keyof ModelDefaults, ModelId][]) {
      if (prev?.models?.[role] === id) continue;
      checkModelValue(current, id, `engineProfiles.${engine}.models.${role}`, engine);
    }
    for (const [reasoning, effort] of Object.entries(profile.reasoning ?? {}) as [keyof GlobalSettings["reasoning"], ReasoningEffort][]) {
      if (prev?.reasoning?.[reasoning] === effort) continue;
      const model = profile.models?.[REASONING_MODEL_LOCAL[reasoning]] ?? next.models[REASONING_MODEL_LOCAL[reasoning]];
      const found = findCatalogModel(model);
      if (!found || found.entry.efforts.length === 0) continue;
      if (!(found.entry.efforts as readonly ReasoningEffort[]).includes(effort))
        throw invalid(
          `model ${model} takes --effort ${(found.entry.efforts as readonly ReasoningEffort[]).join("|")}`,
          `engineProfiles.${engine}.reasoning.${reasoning}`,
          "effort-unsupported",
        );
    }
  }
  for (const key of Object.keys(next.reasoning) as (keyof GlobalSettings["reasoning"])[]) {
    if (next.reasoning[key] === current.reasoning[key] && !changedReasoning.has(key)) continue;
    checkReasoningValue(next, key, `reasoning.${key}`);
  }
}
