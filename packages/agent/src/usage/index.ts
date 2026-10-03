/**
 * @mitori/agent — `usage/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type ClaudeModelId, unsupported } from "@mitori/core";
import type { UsageMeter } from "../contract.ts";

/** Create a meter. */
export function createUsageMeter(model: ClaudeModelId, estimateInTokens: number): UsageMeter {
  return unsupported("agent.createUsageMeter", model, estimateInTokens);
}

/** List-price USD for raw token counts (`PRICING`, `PRICING_VERSION`). Formula in spec §6.5.2. */
export { priceUsage } from "@mitori/core";
