/** Per-prompt model / effort / output-target / timing rules (gen spec §3.4, §5.3, §9.2–§9.5). Pure. */
import {
  type ClaudeModelId,
  type EffectiveSettings,
  type EngineId,
  type GenStage,
  type ModelId,
  PRICING,
  profileFor,
  type ReasoningEffort,
  THINKING_BUDGET_TOKENS,
} from "@mitori/core";
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
  const prof = profileFor(s.global, engine);
  const model = prof.models[key];
  const spec = GEN_PROMPTS[prompt];
  const modeEffort = mode
    ? (spec as { modes?: Readonly<Record<string, { effort?: ReasoningEffort | null }>> }).modes?.[baseMode(mode) ?? mode]?.effort
    : undefined;
  let effort: ReasoningEffort | null = modeEffort !== undefined ? modeEffort : spec.effort;
  if (key === "genOverview") effort = prof.reasoning.genOverview;
  else if (key === "genModule") effort = prof.reasoning.gen;
  if (engine === "generic" || engine === "codex-cli" || engine === "grok-cli" || engine === "antigravity-cli")
    effort = key === "genOverview" ? prof.reasoning.genOverview : prof.reasoning.gen;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5") effort = null;
  return { model, effort };
}

/**
 * Plan tasks with the model/effort of another engine (WP41): the estimate card prices every
 * registered engine with its own `profileFor` values instead of the planning engine's.
 */
export function tasksForEngine(tasks: readonly PlannedTask[], engine: EngineId, s: EffectiveSettings): PlannedTask[] {
  return tasks.map((t) => {
    if (t.cached) return { ...t };
    const { model, effort } = modelOf(t.prompt, t.mode, engine, s);
    return { ...t, model, effort };
  });
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

/**
 * Fixed thinking budget of one call (WP36b): 0 when effort is omitted (e.g. Haiku on the API).
 * Grok rewrites the whole body inside its reasoning on rule-heavy prompts (host-measured
 * 2026-11-03, WP36h): low 10,749 / medium — (20 min, unfinished) / high 64,045 reasoning
 * tokens, so grok-cli reserves low 12,000 / medium 64,000 / high 64,000; xhigh/max keep WP36b.
 */
export function thinkingBudget(effort: ReasoningEffort | null, engine?: EngineId): number {
  if (effort === null) return 0;
  if (engine === "grok-cli") {
    if (effort === "low") return 12_000;
    if (effort === "medium" || effort === "high") return 64_000;
  }
  return THINKING_BUDGET_TOKENS[effort];
}

/** Thinking tokens Θ = a + b·O (Haiku on the API: none). */
export function thinkingOf(model: ModelId, effort: ReasoningEffort | null, out: number, engine: EngineId): number {
  if (!isClaude(model) || effort === null) return 0;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5" && !GEN_ESTIMATE_PARAMS.apiHaikuThinking) return 0;
  const table = GEN_ESTIMATE_PARAMS.thinking[model] as Partial<Record<ReasoningEffort, readonly [number, number]>>;
  const ab = table[effort] ?? Object.values(table)[0] ?? ([0, 0] as const);
  return Math.round(ab[0] + ab[1] * out);
}

/**
 * Other providers report no token timing, and their reasoning is not in `thinking`, so time is derived from what was
 * measured end to end (2026-10-12: Muse Spark high median 86 s per module chapter over 68 tasks, Codex high 92 s for
 * 4.5k output tokens): high efforts ≈ 40 tok/s after ≈ 10 s, lighter efforts proportionally faster.
 */
const reasoningHeavy = (effort: ReasoningEffort | null) => effort === "high" || effort === "xhigh" || effort === "max";

/** Time to first token (s). */
export function ttftOf(model: ModelId, effort: ReasoningEffort | null, engine: EngineId): number {
  if (!isClaude(model)) return reasoningHeavy(effort) ? 10 : 5;
  if (engine === "anthropic-api" && model === "claude-haiku-4-5") return GEN_ESTIMATE_PARAMS.apiHaikuTtftSec;
  const table = GEN_ESTIMATE_PARAMS.ttftSec[model] as Partial<Record<ReasoningEffort, number>>;
  return (effort ? table[effort] : undefined) ?? Object.values(table)[0] ?? 4;
}

/**
 * Grok output speed (tokens/s) for estimates and timeouts (WP36f): host-measured ≈ 60 tok/s
 * (5,167 output tokens in 86 s on the WP36f backend-tools-off probe); planning stays at 50.
 */
export const GROK_OUTPUT_TOKENS_PER_SEC = 50;

/** Default grok-cli turn cap (ms): low takes ~120 s, high ~570 s on the measured calls (WP36h). */
export const GROK_DEFAULT_TURN_MS = 1_200_000;

/**
 * One grok call's timeout: 3× the estimate, at least 900 s (a low call alone runs ~355 s,
 * WP36h), at most the turn cap (the caller passes the settings `turnMs`,
 * defaulting to `GROK_DEFAULT_TURN_MS`).
 */
export function grokTimeoutMs(estimateSeconds: number, turnCapMs: number): number {
  return Math.min(turnCapMs, Math.max(900_000, 3 * estimateSeconds * 1000));
}

/** Output tokens/s. */
export function speedOf(model: ModelId, effort: ReasoningEffort | null = null, engine?: EngineId): number {
  if (engine === "grok-cli") return GROK_OUTPUT_TOKENS_PER_SEC;
  if (!isClaude(model)) return reasoningHeavy(effort) ? 40 : effort === "medium" ? 60 : 80;
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
