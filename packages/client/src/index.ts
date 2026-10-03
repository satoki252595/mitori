/**
 * @mitori/client public surface (ARCHITECTURE §3.3 rule 5): the contract + one re-export per sub-directory.
 * Created by WP-00a at the M0 freeze; afterwards only the integrator (WP-INT) edits this file (re-exports only).
 */
export * from "./http/index.ts";
export * from "./sse/index.ts";
