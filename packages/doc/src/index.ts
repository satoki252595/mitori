/**
 * @mitori/doc public surface (ARCHITECTURE §3.3 rule 5): the contract + one re-export per sub-directory.
 * Created by WP-00a at the M0 freeze; afterwards only the integrator (WP-INT) edits this file (re-exports only).
 */

export * from "./codec/index.ts";
export * from "./contract.ts";
export * from "./export/index.ts";
// CR-PENDING(WP-INT): provisional re-exports of the WP-04 request "worker-side halves of highlighting and ELK layout"
// (cr-requests/WP-04.md) for the compute Worker entry and the ELK pool adapter; ratify (sub-directory index) or revert.
export { elkLayout } from "./layout/elk.ts";
export * from "./layout/index.ts";
export * from "./render/index.ts";
export { createHighlight } from "./render/shiki.ts";
export * from "./store/index.ts";
