/**
 * @mitori/agent — `normalize/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type ClaudeModelId, type Usage, unsupported } from "@mitori/core";
import type { ClaudeStreamEvent, EngineMode, InitExpectation, StreamNormalizer } from "../contract.ts";

/** Create a normalizer for one process (keeps the previous cumulative `total_cost_usd` for deltas). */
export function createClaudeNormalizer(opts: { mode: EngineMode; expect: InitExpectation; worktree?: string }): StreamNormalizer {
  return unsupported("agent.createClaudeNormalizer", opts);
}

/** Map a `result` event to core `Usage` (`reportedUsd` = cumulative cost − previous cumulative cost in the same process). */
export function usageFromClaudeResult(ev: Extract<ClaudeStreamEvent, { type: "result" }>, model: ClaudeModelId, prevTotalCostUsd: number): Usage {
  return unsupported("agent.usageFromClaudeResult", ev, model, prevTotalCostUsd);
}
