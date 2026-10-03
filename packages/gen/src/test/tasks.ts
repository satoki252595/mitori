/** Hand-built planned tasks for renderer / validator tests. */
import type { GenTarget, GenTaskId, ModelId, SectionId } from "@mitori/core";
import type { GenPromptId, PlannedTask } from "../contract.ts";

/** A planned task with zero estimates. */
export function plannedTask(prompt: GenPromptId, target: GenTarget, sections: SectionId[], over: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: "gt_0000000001" as GenTaskId,
    stage: prompt === "gen.module" ? "S5" : prompt === "gen.parent" || prompt === "gen.labels" ? "S6" : "S6o",
    prompt,
    target,
    sections,
    deps: [],
    softDeps: [],
    model: "claude-sonnet-5-5" as ModelId,
    effort: "low",
    lane: "background",
    topoOrder: 0,
    rank: 0,
    cacheKey: null,
    cached: false,
    estimate: { prefix: 0, tail: 0, out: 0, thinking: 0, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0, seconds: 0 },
    phase: 1,
    ...over,
  };
}
