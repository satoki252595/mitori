/**
 * @mitori/agent — `usage/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { ClaudeModelId } from "@mitori/core";
import type { UsageMeter } from "../contract.ts";
import { createMeter } from "./meter.ts";

/** Create a meter. */
export function createUsageMeter(model: ClaudeModelId, estimateInTokens: number): UsageMeter {
  return createMeter(model, estimateInTokens);
}

/** List-price USD for raw token counts (`PRICING`, `PRICING_VERSION`). Formula in spec §6.5.2. */
export { priceUsage } from "@mitori/core";
