/**
 * @mitori/loop — `router/` (owner: WP-08a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { EffectiveSettings, Result, ThreadDetail } from "@mitori/core";
import type { RouteOutcome } from "../contract.ts";
import { type RouteInputExt, routeDecision } from "./route.ts";
import { deriveScope, type ScopeCtx, type ScopeResult } from "./scope.ts";

export { isSensitiveJob } from "./sensitive.ts";

/**
 * Write-scope derivation (spec §3.3). Deterministic; never decided by a model. `ctx.sectionOfBlock` is an optional
 * extension (CR-PENDING(WP-08a)) for the doc_edit module fallback.
 */
export function deriveWriteScope(threads: ThreadDetail[], ctx: ScopeCtx): Result<ScopeResult> {
  return deriveScope(threads, ctx);
}

/**
 * Pure router (spec §3). Errors: E_INVALID_INPUT (R0/R8/override), E_PRECONDITION (R7, scope), E_DENY_GLOB, E_UNSUPPORTED,
 * E_AGENT_CAPABILITY; the suggested next actions travel in `error.params.actions` (comma-separated).
 * `input.primary` is an optional extension (CR-PENDING(WP-08a)): which anchor member a sent note was written on.
 */
export function route(input: RouteInputExt, settings: EffectiveSettings): Result<RouteOutcome> {
  return routeDecision(input, settings);
}
