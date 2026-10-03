/** Per-prompt model / effort / output-target / timing rules (gen spec §3.4, §5.3, §9.2–§9.5). Pure. */
import { type ClaudeModelId, type EffectiveSettings, type EngineId, type GenStage, type ModelId, PRICING, type ReasoningEffort } from "@mitori/core";
import { GEN_ESTIMATE_PARAMS, GEN_PROMPTS, type GenModelKey, type GenPromptId, type PlannedTask } from "../contract.ts";
import { baseMode, isFilesMode } from "../prompts/files.ts";

/** §3.4 stage weights (early overview 9 / S5 5 / S6 4 / S6o 3 / S7 2 / S8 1). */
export function stageWeight(t: Pick<PlannedTask, "stage" | "prompt" | "mode">): number {
  if (t.prompt === "gen.overview" && t.mode === "early") return 9;
  const w: Partial<Record<GenStage, number>> = { S5: 5, S6: 4, S6o: 3, S7: 2, S8: 1 };
  return w[t.stage] ?? 0;
}

/** Dispatch order key (§3.4): boost desc, stage weight desc, topoOrder asc, rank desc, id asc. Negative = a first. */
export function compareTasks(a: PlannedTask & { boost?: number }, b: PlannedTask & { boost?: number }): number {
  return (
    (b.boost ?? 0) - (a.boost ?? 0) ||
    stageWeight(b) - stageWeight(a) ||
    a.topoOrder - b.topoOrder ||
    b.rank - a.rank ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Model key of a prompt in a mode (mode overrides the spec; `apiModelKey` on anthropic-api). */
export function modelKeyOf(prompt: GenPromptId, mode: string | undefined, engine: EngineId): GenModelKey {
  const spec = GEN_PROMPTS[prompt];
  const m = mode
    ? (spec as { modes?: Readonly<Record<string, { modelKey?: GenModelKey; apiModelKey?: GenModelKey }>> }).modes?.[baseMode(mode) ?? mode]
    : undefined;
  if (engine === "anthropic-api" && m?.apiModelKey) return m.apiModelKey;
  return m?.modelKey ?? spec.modelKey;
}

/** Full model id + effort for a task (settings `models.*`, `reasoning.gen` / `reasoning.genOverview`). */
export function modelOf(
  prompt: GenPromptId,
  mode: string | undefined,
  engine: EngineId,
  s: EffectiveSettings,
): { model: ModelId; effort: ReasoningEffort | null } {
  const key = modelKeyOf(prompt, mode, engine);
  const model = s.global.models[key];
  const spec = GEN_PROMPTS[prompt];
  const modeEffort = mode
    ? (spec as { modes?: Readonly<Record<string, { effort?: ReasoningEffort | null }>> }).modes?.[baseMode(mode) ?? mode]?.effort
    : undefined;
  let effort: ReasoningEffort | null = modeEffort !== undefined ? modeEffort : spec.effort;
  if (key === "genOverview") effort = s.global.reasoning.genOverview;
  else if (key === "genModule") effort = s.global.reasoning.gen;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5") effort = null;
  return { model, effort };
}

/** Max output tokens of a prompt mode (§5.3). */
export function maxOutOf(prompt: GenPromptId, mode: string | undefined): number {
  const spec = GEN_PROMPTS[prompt];
  const m = mode ? (spec as { modes?: Readonly<Record<string, { maxOut?: number }>> }).modes?.[baseMode(mode) ?? mode] : undefined;
  return m?.maxOut ?? spec.maxOut;
}

/** Visible output target O_t (§5.3) from the tail tokens I and a count (labels per call / max terms). */
export function outTarget(prompt: GenPromptId, mode: string | undefined, tail: number, count = 0): number {
  const o = GEN_ESTIMATE_PARAMS.outTargets;
  switch (prompt) {
    case "gen.module":
      return Math.round(Math.min(o.moduleMax, Math.max(o.moduleBase, o.moduleBase + o.moduleSlope * tail)));
    case "gen.parent":
      return o.parent;
    case "gen.overview":
      return mode === "early" ? o.overviewEarly : o.overviewFinal;
    case "gen.flows":
      return o.flows;
    case "gen.datamodel":
      return o.datamodel;
    case "gen.quality":
      return o.quality;
    case "gen.decisions":
      return o.decisions;
    case "gen.risks":
      return o.risks;
    case "gen.glossary":
      return o.perTerm * count;
    case "gen.questions":
      return o.questions;
    case "gen.labels":
      return o.perLabel * count;
    case "gen.deepdive":
      return isFilesMode(mode) ? Math.round(o.filesSlope * tail + o.perFile * count) : o.deepdiveTopic;
    case "gen.judge":
      return o.perJudgedClaim * count;
    case "doc.sync":
      return Math.round(o.syncFactor * tail);
    case "doc.simplify":
      return Math.round(o.simplifyFactor * tail);
    case "doc.translate":
      return Math.round(o.translateJaToEn * tail);
  }
}

const isClaude = (m: ModelId): m is ClaudeModelId => m in PRICING;

/** Thinking tokens Θ = a + b·O (Haiku on the API: none). */
export function thinkingOf(model: ModelId, effort: ReasoningEffort | null, out: number, engine: EngineId): number {
  if (!isClaude(model) || effort === null) return 0;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5" && !GEN_ESTIMATE_PARAMS.apiHaikuThinking) return 0;
  const table = GEN_ESTIMATE_PARAMS.thinking[model] as Partial<Record<ReasoningEffort, readonly [number, number]>>;
  const ab = table[effort] ?? Object.values(table)[0] ?? ([0, 0] as const);
  return Math.round(ab[0] + ab[1] * out);
}

/** Time to first token (s). */
export function ttftOf(model: ModelId, effort: ReasoningEffort | null, engine: EngineId): number {
  if (!isClaude(model)) return 4;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5") return GEN_ESTIMATE_PARAMS.apiHaikuTtftSec;
  const table = GEN_ESTIMATE_PARAMS.ttftSec[model] as Partial<Record<ReasoningEffort, number>>;
  return (effort ? table[effort] : undefined) ?? Object.values(table)[0] ?? 4;
}

/** Output tokens/s. */
export function speedOf(model: ModelId): number {
  if (!isClaude(model)) return 100;
  return GEN_ESTIMATE_PARAMS.outTokPerSec[model] ?? PRICING[model].outTokPerSec;
}

/** Engine start-up σ (s). */
export function startupOf(engine: EngineId): number {
  const s = GEN_ESTIMATE_PARAMS.startupSec as Partial<Record<EngineId, number>>;
  return s[engine] ?? GEN_ESTIMATE_PARAMS.startupSec["claude-cli"];
}

/** Fan-out group of a task for planning (same system prompt × model × effort). */
export function groupOf(t: Pick<PlannedTask, "prompt" | "model" | "effort">): string {
  return `${GEN_PROMPTS[t.prompt].system}|${t.model}|${t.effort ?? "-"}`;
}
