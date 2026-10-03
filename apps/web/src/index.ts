/**
 * @mitori/web public surface (ARCHITECTURE §3.3 rule 5): the contract + one re-export per sub-directory.
 * Created by WP-00a at the M0 freeze; afterwards only the integrator (WP-INT) edits this file (re-exports only).
 */

export * from "./composer/index.ts";
export * from "./contract.ts";
export * from "./gen/index.ts";
export * from "./inbox/index.ts";
export * from "./jobs/index.ts";
export * from "./map/index.ts";
export * from "./palette/index.ts";
export * from "./proposals/index.ts";
export * from "./reader/index.ts";
export * from "./review/index.ts";
export * from "./settings/index.ts";
export * from "./shell/index.ts";
export * from "./stores/index.ts";
export * from "./threads/index.ts";
export * from "./trust/index.ts";
