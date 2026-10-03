// Escalation (spec §3.5, L9 "no unattended loop"):
//   • R2 (automatic): a patch job that cannot finish — `needs_more_context`, edits that still do not apply after one
//     REPAIR, gates that still fail after two — becomes an agent job for the same threads, but ONLY when the new
//     estimate needs no confirmation, fits `limits.jobMaxUsd`, and "spent so far + new estimate ≤ first estimate ×
//     ROUTER_LIMITS.autoEscalateSpendFactor". Otherwise the job fails with the `escalate` action (a human decides).
//   • R1 (final): an agent job that fails (gates after the repairs, protocol, budget) is never escalated by mitori —
//     the failure carries `escalate`; the Opus job it proposes needs the human's confirmation (`requiresConfirm`).
//   • Never: scope violations, deny globs, secrets, tampered dependencies (injection signals).
import { type Job, type JobId, MitoriError, type RouteReason, type ThreadId } from "@mitori/core";
import { ROUTER_LIMITS } from "../contract.ts";
import type { RunnerCore } from "../jobs/core.ts";
import type { JobPlan } from "../jobs/plan.ts";
import type { JobRecord } from "../jobs/store.ts";

/** Failure codes that are injection signals: no repair, no escalation. */
const NEVER: ReadonlySet<string> = new Set(["E_SCOPE_VIOLATION", "E_DENY_GLOB", "E_SECRET_DETECTED", "E_CANCELLED", "E_SHUTTING_DOWN"]);

/** The router history reason a failure of `job` adds (null: not an escalation input). */
export function escalationReason(job: Pick<Job, "route"> & { kind?: Job["kind"] }, err: MitoriError): RouteReason | null {
  // an external patch has no engine of mitori behind it: its author decides what to submit next
  if (NEVER.has(err.code) || job.kind === "external_patch") return null;
  if (job.route.mode === "agent") {
    return err.code === "E_GATE_FAILED" || err.code === "E_AGENT_PROTOCOL" || err.code === "E_BUDGET_EXCEEDED" || err.code === "E_AGENT_TIMEOUT"
      ? "agent_failed"
      : null;
  }
  if (job.route.mode !== "patch") return null;
  if (err.code === "E_PATCH_APPLY" || err.code === "E_PATCH_RANGE") return "patch_apply_failed";
  if (err.code === "E_GATE_FAILED") return "gates_failed_twice";
  if (err.code === "E_PRECONDITION" && (err.params as { reason?: unknown } | undefined)?.reason === "needs_more_context") return "needs_more_context";
  return null;
}

/** The failure, with `escalate` among its actions when the router has a next step for it. */
export function withEscalateAction(job: Pick<Job, "route"> & { kind?: Job["kind"] }, err: MitoriError): MitoriError {
  if (escalationReason(job, err) === null) return err;
  const given = typeof err.params?.actions === "string" ? err.params.actions.split(",").filter(Boolean) : ["retry", "copy_prompt"];
  if (given.includes("escalate")) return err;
  return new MitoriError(err.code, err.message, {
    ...(err.retryable !== undefined ? { retryable: err.retryable } : {}),
    params: { ...err.params, actions: ["escalate", ...given].join(",") },
  });
}

/** USD spent on these threads so far and the first estimate of their first job (the auto-escalation cap's inputs). */
export function spendOf(core: RunnerCore, threads: readonly ThreadId[]): { spent: number; first: number } {
  const seen = new Set<JobId>();
  let spent = 0;
  let first: { at: string; usd: number } | null = null;
  for (const t of threads)
    for (const rec of core.store.ofThread(t)) {
      if (seen.has(rec.job.id)) continue;
      seen.add(rec.job.id);
      spent += rec.job.usage?.apiUsd ?? 0;
      if (first === null || rec.job.createdAt < first.at) first = { at: rec.job.createdAt, usd: rec.job.estimate.apiUsd };
    }
  return { spent, first: first?.usd ?? 0 };
}

/** Why an R2 plan may NOT run without a human (null = it may). */
export function autoBlocker(core: RunnerCore, plan: JobPlan, threads: readonly ThreadId[]): string | null {
  const limits = core.deps.settings().global.limits;
  if (plan.mode !== "agent") return `the router chose ${plan.mode}`;
  if (plan.estimate.requiresConfirm || plan.route.decision.requiresConfirm) return "the escalation needs a confirmation";
  if (plan.estimate.apiUsd > limits.jobMaxUsd) return `the estimate $${plan.estimate.apiUsd.toFixed(3)} is over limits.jobMaxUsd`;
  const { spent, first } = spendOf(core, threads);
  const cap = first * ROUTER_LIMITS.autoEscalateSpendFactor;
  if (spent + plan.estimate.apiUsd > cap)
    return `spent $${spent.toFixed(3)} + estimate $${plan.estimate.apiUsd.toFixed(3)} > ${ROUTER_LIMITS.autoEscalateSpendFactor}× the first estimate ($${cap.toFixed(3)})`;
  return null;
}

/** Hooks of the runner the hand-over needs. */
export interface EscalationPorts {
  core: RunnerCore;
  /** Plan the same request with one more router history reason. */
  plan(job: Job, reason: RouteReason): Promise<JobPlan>;
  /** A queued record for a plan (the runner's `newRecord`). */
  record(plan: JobPlan): JobRecord;
  /** Start the pipeline of a new job. */
  launch(id: JobId, plan: JobPlan): void;
}

/**
 * Try R2 for a failing patch job. On success the failed job is closed WITHOUT failing its threads (they stay
 * `running`) and a new agent job (`escalatedFrom`) takes them over; returns that job's id. Null ⇒ the caller fails
 * the job as usual (with `escalate` among the actions when there is a next step).
 */
export async function tryAutoEscalate(ports: EscalationPorts, id: JobId, err: MitoriError): Promise<JobId | null> {
  const { core } = ports;
  const rec = core.store.get(id);
  if (!rec) return null;
  const reason = escalationReason(rec.job, err);
  if (reason === null || reason === "agent_failed") return null;
  let plan: JobPlan;
  try {
    plan = await ports.plan(rec.job, reason);
  } catch (e) {
    core.deps.log.info("escalation: no agent plan", { job: id, error: MitoriError.from(e).message });
    return null;
  }
  const blocker = autoBlocker(core, plan, rec.job.threads);
  if (blocker !== null) {
    core.deps.log.info("escalation: needs a human", { job: id, why: blocker });
    return null;
  }
  const next = ports.record(plan);
  next.job.escalatedFrom = id;
  next.job.attempt = 1;
  core.emit(id, { t: "error", code: err.code, message: err.message, retryable: false, at: core.deps.clock.now() });
  const why: Record<string, string> = {
    needs_more_context: "パッチでは文脈が足りませんでした",
    patch_apply_failed: "パッチを当てられませんでした",
    gates_failed_twice: "検査が2回の修復で通りませんでした",
  };
  let ok = false;
  await core.deps.write("job.escalate", () =>
    core.deps.db.tx(() => {
      const cur = core.store.get(id);
      if (!cur || !["preparing", "running", "gating", "repairing", "queued", "waiting_lock"].includes(cur.job.state)) return;
      core.setState(cur, "failed");
      cur.job.failure = { code: err.code, message: err.message.slice(0, 300), actions: ["retry", "copy_prompt"] };
      core.store.save(cur);
      core.store.unlock(id);
      core.store.insert(next);
      for (const t of cur.job.threads)
        core.threads.say(
          t,
          id,
          "system",
          "system",
          `${why[reason] ?? "パッチモードで完了できませんでした"}。エージェントモード（${next.job.id}）に切り替えます。`,
        );
      core.deps.events.emit({ type: "job.upsert", job: cur.job });
      core.deps.events.emit({ type: "job.upsert", job: next.job });
      core.threads.touch(cur.job.threads);
      ok = true;
    }),
  );
  if (!ok) return null;
  core.notifyUnlock();
  core.parking.release(id);
  if (rec.job.worktree) await core.deps.git.removeWorktree(id).catch(() => {});
  await core.flushEvents(id);
  core.phase(next.job.id, "queued", `${id} から昇格（${reason}）`);
  ports.launch(next.job.id, plan);
  return next.job.id;
}
