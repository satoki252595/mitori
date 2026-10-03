/**
 * @mitori/gen public surface (ARCHITECTURE §3.3 rule 5): the contract + one re-export per sub-directory.
 * Created by WP-00a at the M0 freeze; afterwards only the integrator (WP-INT) edits this file (re-exports only).
 */
export * from "./contract.ts";
export * from "./engines/index.ts";
export * from "./incremental/index.ts";
export * from "./line/index.ts";
export * from "./ondemand/index.ts";
export * from "./orchestrator/index.ts";
export * from "./planner/index.ts";
export * from "./prompts/index.ts";
// CR-PENDING(WP-INT): provisional re-export of the WP-06 request R3 (cr-requests/WP-06.md) so the composition root can
// build `GenDeps.prompts`; the architect ratifies it (move into prompts/index.ts) or reverts it.
export { createPromptRenderer } from "./prompts/renderer.ts";
export * from "./session/index.ts";
export * from "./translate/index.ts";
export * from "./verify/index.ts";
