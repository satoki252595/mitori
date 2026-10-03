/** Inbox row → status vocabulary (thread display state, job state, or the item kind). Pure. */
import type { InboxItem, JobState, ThreadState } from "@mitori/core";
import type { UiStatus } from "../contract.ts";
import { jobStatus } from "../jobs/index.ts";
import { threadStatus } from "../threads/index.ts";
import { needsChoice } from "./view.ts";

const JOB_STATES: ReadonlySet<string> = new Set([
  "queued",
  "waiting_lock",
  "preparing",
  "running",
  "gating",
  "repairing",
  "ready",
  "accepting",
  "accepted",
  "partially_accepted",
  "rejected",
  "done",
  "failed",
  "cancelled",
  "reverted",
]);

export function itemStatus(it: InboxItem): UiStatus {
  const st = it.displayState ?? it.state;
  if (it.kind === "thread") {
    if (needsChoice(it)) return "needs_choice";
    if (st === "outdated") return "outdated";
    return threadStatus({ state: st as ThreadState, anchorHealth: "ok", intent: it.intent ?? "note", stale: false });
  }
  if (it.kind === "job") return JOB_STATES.has(st) ? jobStatus(st as JobState) : "queued";
  if (it.kind === "proposal") return it.state === "pending" ? "ready" : it.state === "accepted" ? "applied" : "rejected";
  if (it.kind === "trust") return it.state === "pending" ? "needs_input" : it.state === "trusted" ? "applied" : "rejected";
  if (it.kind === "gen_run") return st === "failed" ? "failed" : st === "done" ? "applied" : "running";
  return "stale";
}
