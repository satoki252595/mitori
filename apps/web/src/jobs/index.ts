/**
 * @mitori/web — `jobs/` (owner: WP-10b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { JobState, RouteDecision } from "@mitori/core";
import { STAGE_PLANS, type StageRow, type UiStatus } from "../contract.ts";

const BY_STATE = {
  queued: "queued",
  waiting_lock: "waiting_lock",
  preparing: "running",
  running: "running",
  gating: "gating",
  repairing: "repairing",
  ready: "ready",
  // the accept is being written: still the review the user is looking at (the button says 「採用中…」)
  accepting: "ready",
  accepted: "applied",
  partially_accepted: "partially_applied",
  rejected: "rejected",
  // answer-mode jobs end in `done`: the thread got its answer
  done: "answered",
  failed: "failed",
  cancelled: "cancelled",
  reverted: "reverted",
} as const satisfies Record<JobState, UiStatus>;

/** Job → UI status. */
export function jobStatus(state: JobState): UiStatus {
  return BY_STATE[state];
}

/**
 * Build the planned rows for a route and the trusted gates that apply to its write scope. Pure. The `accept` row is
 * already done (the card itself is the receipt, ux.md §6.4); `gate` expands to one row per gate (none ⇒ no row).
 */
export function planStages(route: RouteDecision, gates: readonly { id: string; label: string }[]): StageRow[] {
  const rows: StageRow[] = [];
  for (const key of STAGE_PLANS[route.mode]) {
    if (key === "gate") {
      for (const g of gates) rows.push({ key, gate: g.id, state: "planned", detail: g.label });
    } else rows.push(key === "accept" ? { key, state: "done", atMs: 0 } : { key, state: "planned" });
  }
  return rows;
}
