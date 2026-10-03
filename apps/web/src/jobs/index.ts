/**
 * @mitori/web — `jobs/` (owner: WP-10b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type JobState, type RouteDecision, unsupported } from "@mitori/core";
import type { StageRow, UiStatus } from "../contract.ts";

/** Job → UI status. */
export function jobStatus(state: JobState): UiStatus {
  return unsupported("web.jobStatus", state);
}

/** Build the planned rows for a route and the trusted gates that apply to its write scope. Pure. */
export function planStages(route: RouteDecision, gates: readonly { id: string; label: string }[]): StageRow[] {
  return unsupported("web.planStages", route, gates);
}
