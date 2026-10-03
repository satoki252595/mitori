/**
 * @mitori/agent — `normalize/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { ClaudeModelId, Usage } from "@mitori/core";
import type { ClaudeStreamEvent, EngineMode, InitExpectation, StreamNormalizer } from "../contract.ts";
import { createNormalizer } from "./normalizer.ts";
import { usageFromResult } from "./result.ts";

/** Create a normalizer for one process (keeps the previous cumulative `total_cost_usd` for deltas). */
export function createClaudeNormalizer(opts: { mode: EngineMode; expect: InitExpectation; worktree?: string }): StreamNormalizer {
  return createNormalizer(opts);
}

/** Map a `result` event to core `Usage` (`reportedUsd` = cumulative cost − previous cumulative cost in the same process). */
export function usageFromClaudeResult(ev: Extract<ClaudeStreamEvent, { type: "result" }>, model: ClaudeModelId, prevTotalCostUsd: number): Usage {
  return usageFromResult(ev, model, prevTotalCostUsd);
}
