/**
 * @mitori/agent — `ledger/` (owner: WP-05). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */

/**
 * Usage ledger factory [CR m1-2]: `deps.db` = state.sqlite (reads, `AGENT_MIGRATIONS` applied), every insert /
 * upsert runs inside `deps.stateWrite` (the daemon-wide writer) [CONS-03]; `random` = UsageRecordId, `clock` =
 * summary ranges (daemon-local days), `log` = price-mismatch warnings (AGT-U-028).
 */
export { createUsageLedger } from "./ledger.ts";
