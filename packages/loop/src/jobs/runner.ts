// `JobRunner` (spec §8, contract C8): plans and estimates, `create` within 100 ms (the pipeline runs detached),
// cancel / revise / retry, the review operations, details and events, and daemon-restart recovery (§7.11).
import {
  type CheckpointId,
  type CreateJobReq,
  type DocProposalView,
  type EngineId,
  type Estimate,
  type Job,
  type JobDetail,
  type JobId,
  type JobReq,
  type JobState,
  MitoriError,
  newId,
  type RouteReason,
  type ThreadDetail,
  type ThreadId,
} from "@mitori/core";
import { escalationReason, tryAutoEscalate, withEscalateAction } from "../agent/escalate.ts";
import { runAgent, runAgentConsentRepair, runAgentRevision } from "../agent/run.ts";
import type { JobRunner } from "../contract.ts";
import { externalPatch } from "../external/patch.ts";
import { ACTIVE, type JobRunnerDeps, RunnerCore, Stop } from "./core.ts";
import { consentRetry, runAnswer, runConsentRepair, runPatch, runRevision } from "./pipeline.ts";
import { type JobPlan, jobEstimate, type PlanDeps, planJob } from "./plan.ts";
import { accept, commit, reject, runGates, undo } from "./review-ops.ts";
import type { JobRecord } from "./store.ts";

/** Token drift between the confirmed estimate and a re-plan that still counts as the same job (spec §8). */
const DRIFT = 0.2;

/** The runner plus what `createLoop` and the tests need. */
export interface JobRunnerHandle extends JobRunner {
  /** A page of jobs, newest first (`GET /jobs`; not in the contract — CR-PENDING(loop-wiring) #3). */
  list(q: { state?: JobState; thread?: ThreadId; limit?: number; cursor?: string }): { items: Job[]; next: string | null };
  /** Resolves when every running pipeline has finished. */
  settle(): Promise<void>;
  /** Stop pipelines and close parked processes (daemon stop). */
  shutdown(): Promise<void>;
}

/** Failure reason codes ⇒ router history (escalation input, spec §3.5). */
const HISTORY: Partial<Record<string, RouteReason>> = {
  E_PATCH_RANGE: "patch_apply_failed",
  E_PATCH_APPLY: "patch_apply_failed",
  E_GATE_FAILED: "gates_failed_twice",
};

/** Build the job runner of one workspace. */
export function createJobRunner(deps: JobRunnerDeps, plan: Omit<PlanDeps, "review" | "history">): JobRunnerHandle {
  const core = new RunnerCore(deps);
  const planDeps: PlanDeps = {
    ...plan,
    review: deps.review,
    history: (threads: readonly ThreadDetail[]) => {
      const out: RouteReason[] = [];
      for (const t of threads)
        for (const rec of core.store.ofThread(t.id)) {
          const f = rec.job.failure;
          if (!f) continue;
          // an agent job's failure is the final escalation's input (R1), whatever its code (spec §3.5)
          const r =
            rec.job.route.mode === "agent"
              ? (escalationReason(rec.job, new MitoriError(f.code, f.message)) ?? undefined)
              : f.code === "E_PRECONDITION" && /needs more context/.test(f.message)
                ? "needs_more_context"
                : HISTORY[f.code];
          if (r) out.push(r);
        }
      return out;
    },
  };

  async function freshPlan(req: JobReq): Promise<JobPlan> {
    const p = await planJob(planDeps, req);
    core.remember(p);
    return p;
  }

  /** What the bundle is made of besides the index: a thread's intent, anchor and human text, and the context adjustments. */
  const threadSig = (t: ThreadDetail): string => JSON.stringify([t.intent, t.anchor, t.messages.map((m) => [m.by, m.body])]);
  const contextSig = (r: JobReq): string => JSON.stringify([r.context ?? null, r.mode ?? null, r.model ?? null, r.engine ?? null]);
  /** The remembered plan still describes what a create would send (live finding: a draft saved after its estimate). */
  function inputsUnchanged(known: JobPlan, req: CreateJobReq): boolean {
    if (contextSig(known.req) !== contextSig(req)) return false;
    return known.threads.every((t) => {
      const now = deps.review.get(t.id);
      return now !== null && threadSig(now) === threadSig(t);
    });
  }

  /** The plan a create confirms: the remembered one while the index and the inputs are unchanged, else a re-plan within ±20 %. */
  async function planFor(req: CreateJobReq): Promise<JobPlan> {
    const known = core.plans.get(req.estimateId);
    const digest = deps.indexer.snapshot()?.indexDigest ?? null;
    const fresh = known && known.digest === digest && Date.parse(known.estimate.expiresAt) > deps.clock.now() && inputsUnchanged(known, req);
    if (known && fresh) return known;
    const p = await freshPlan(req);
    if (known) {
      const before = known.estimate.inTokens + known.estimate.outTokens;
      const after = p.estimate.inTokens + p.estimate.outTokens;
      if (Math.abs(after - before) > before * DRIFT || (p.estimate.requiresConfirm && req.confirm !== true))
        throw new MitoriError("E_CONFLICT", "the estimate changed; confirm the new one", { params: { estimateId: p.id, tokens: after } });
    }
    return p;
  }

  /** Detach a pipeline. */
  function launch(id: JobId, fn: (signal: AbortSignal) => Promise<void>): void {
    const abort = new AbortController();
    const done = (async () => {
      try {
        await fn(abort.signal);
      } catch (e) {
        if (!(e instanceof Stop)) {
          const err = MitoriError.from(e);
          if (err.code === "E_CANCELLED" && core.get(id).job.state === "cancelled") return;
          // spec §3.5: R2 hands the threads to an agent job when the cap allows; else the failure offers `escalate`
          const next = abort.signal.aborted
            ? null
            : await tryAutoEscalate(escalation, id, err).catch((x: unknown) => {
                deps.log.warn("auto-escalation failed", { job: id, error: MitoriError.from(x).message });
                return null;
              });
          if (next === null) {
            const rec = core.store.get(id);
            await core
              .fail(id, rec ? withEscalateAction(rec.job, err) : err)
              .catch((x: unknown) => deps.log.error("job failure not recorded", { job: id, error: MitoriError.from(x).message }));
          }
        }
      } finally {
        core.live.delete(id);
      }
    })();
    core.live.set(id, { abort, done });
  }

  function pipeline(id: JobId, p: JobPlan): (signal: AbortSignal) => Promise<void> {
    if (p.mode === "patch") return (signal) => runPatch(core, id, p, signal);
    if (p.mode === "agent") return (signal) => runAgent(core, id, p, signal);
    return (signal) => runAnswer(core, id, p, signal);
  }

  /** A sent doc note (docpatch/1) is not run by the job runner yet. */
  function supported(p: JobPlan): void {
    if (p.route.decision.contract === "docpatch/1")
      throw new MitoriError("E_UNSUPPORTED", "a sent doc note (docpatch/1) arrives with WP-08c", {
        params: { what: "loop.jobs.docpatch", actions: "copy_prompt" },
      });
  }

  /** What a request adds to its threads (persisted on the job; null when nothing). */
  const reqExtra = (r: JobReq): NonNullable<JobRecord["extra"]["req"]> | null => {
    const out: NonNullable<JobRecord["extra"]["req"]> = {};
    if (r.context && ((r.context.add?.length ?? 0) > 0 || (r.context.remove?.length ?? 0) > 0)) out.context = r.context;
    if (r.mode !== undefined) out.mode = r.mode;
    if (r.model !== undefined) out.model = r.model;
    if (r.budgetTokens !== undefined) out.budgetTokens = r.budgetTokens;
    return Object.keys(out).length > 0 ? out : null;
  };
  /** The request a re-plan of a job uses (revise / retry / repair after consent / escalation / recovery). */
  const replanReq = (rec: JobRecord, engine?: EngineId): JobReq => ({
    kind: rec.job.kind,
    threads: rec.job.threads,
    engine: engine ?? rec.job.engine,
    ...(rec.extra.req ?? {}),
  });

  /** The write scope a job of `p` locks and is post-checked against (answers write nothing). */
  const writesOf = (p: JobPlan) => (p.mode === "patch" || p.mode === "agent" ? p.scope.writeScope : []);
  const promptVerOf = (p: JobPlan) =>
    (p.mode === "patch"
      ? "loop.patch@1"
      : p.mode === "agent"
        ? "loop.agent@1"
        : p.mode === "findings"
          ? "loop.findings@1"
          : "loop.answer@1") as Job["promptVer"];

  function newRecord(p: JobPlan, attempt = 1): JobRecord {
    const j: Job = {
      id: newId("job", deps.random) as JobId,
      ws: deps.ws.key,
      kind: p.kind,
      threads: p.threads.map((t) => t.id),
      engine: p.route.engine,
      route: p.route.decision,
      state: "queued",
      attempt,
      estimate: p.estimate as Estimate,
      writeScope: writesOf(p),
      gates: [],
      proposals: [],
      promptVer: promptVerOf(p),
      createdAt: deps.clock.iso(),
    };
    const req = reqExtra(p.req);
    return {
      job: j,
      baseCommit: null,
      bundleTokens: p.estimate.inTokens,
      bundleBlobs: p.bundle.blobs,
      extra: { newFiles: p.scope.newFiles, ...(p.route.note ? { note: p.route.note } : {}), ...(req ? { req } : {}) },
    };
  }

  /** A ready job whose consented gate run tampered with the dependencies: cancelled, threads back to `open`. */
  async function discardTampered(id: JobId, err: MitoriError): Promise<void> {
    const saved = await core
      .update(id, "job.tampered", (r) => {
        if (r.job.state !== "ready") return;
        core.setState(r, "cancelled");
        r.job.failure = { code: err.code, message: err.message.slice(0, 300), actions: ["copy_prompt"] };
        for (const t of r.job.threads) {
          core.threads.fire(t, "cancel", "system");
          core.threads.say(
            t,
            id,
            "system",
            "system",
            `検査の実行中に依存ディレクトリまたはジョブの作業ツリーが書き換えられたため、この変更を破棄しました（${err.code}）。`,
          );
        }
        core.store.unlock(id);
      })
      .catch(() => null);
    core.parking.release(id);
    if (saved?.job.worktree) await deps.git.removeWorktree(id).catch(() => {});
    await core.flushEvents(id);
  }

  /** R2 hand-over ports (agent/escalate.ts). */
  const escalation = {
    core,
    plan: async (job: Job, reason: RouteReason) => {
      const p = await planJob({ ...planDeps, history: (t) => [...planDeps.history(t), reason] }, replanReq(core.get(job.id)));

      core.remember(p);
      return p;
    },
    record: (p: JobPlan) => newRecord(p),
    launch: (id: JobId, p: JobPlan) => launch(id, pipeline(id, p)),
  };

  const runner: JobRunnerHandle = {
    async estimate(req) {
      return jobEstimate(await freshPlan(req));
    },

    async create(req) {
      const p = await planFor(req);
      supported(p);
      if (p.estimate.requiresConfirm && req.confirm !== true)
        throw new MitoriError("E_PRECONDITION", "this job needs a confirmed estimate", {
          params: { estimateId: p.id, reasons: p.estimate.confirmReasons.join(",") },
        });
      const rec = newRecord(p);
      // the human's escalation of a failed thread (spec §3.5 R1/R2 "escalate"): an agent job, failed → queued (retry)
      const escalating = p.mode === "agent";
      const job = await deps.write("job.create", () =>
        deps.db.tx(() => {
          for (const t of p.threads) {
            const cur = deps.review.get(t.id);
            const ok = cur && (cur.state === "open" || (cur.state === "queued" && cur.batchRound !== undefined) || (escalating && cur.state === "failed"));
            if (!ok)
              throw new MitoriError("E_PRECONDITION", `thread ${t.id} cannot be dispatched (${cur?.state ?? "missing"})`, {
                params: { id: t.id, state: cur?.state ?? "missing" },
              });
          }
          if (escalating) {
            const from = p.threads
              .flatMap((t) => core.store.ofThread(t.id))
              .filter((r) => r.job.state === "failed")
              .sort((a, b) => (a.job.createdAt < b.job.createdAt ? 1 : -1))[0];
            if (from && p.threads.every((t) => deps.review.get(t.id)?.state === "failed")) rec.job.escalatedFrom = from.job.id;
          }
          core.store.insert(rec);
          // CR m1-73: Finish already dispatched its threads (queued + batchRound)
          for (const t of p.threads) {
            const state = deps.review.get(t.id)?.state;
            if (state === "open") core.threads.fire(t.id, "dispatch", "human");
            else if (state === "failed") core.threads.fire(t.id, "retry", "human");
          }
          deps.events.emit({ type: "job.upsert", job: rec.job });
          core.threads.touch(rec.job.threads);
          return rec.job;
        }),
      );
      core.phase(job.id, "queued");
      launch(job.id, pipeline(job.id, p));
      return job;
    },

    async cancel(id) {
      const rec = core.get(id);
      if (rec.job.state === "ready") throw new MitoriError("E_PRECONDITION", "a ready job is rejected, not cancelled", { params: { job: id } });
      if (!ACTIVE.includes(rec.job.state))
        throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${rec.job.state}`, { params: { machine: "job", from: rec.job.state, to: "cancelled" } });
      const saved = await core.update(id, "job.cancel", (r) => {
        core.setState(r, "cancelled");
        for (const t of r.job.threads) core.threads.fire(t, "cancel", "human");
        core.store.unlock(id);
      });
      core.live.get(id)?.abort.abort();
      core.closeProposals(saved.job);
      core.notifyUnlock();
      core.parking.release(id);
      if (saved.job.worktree) await deps.git.removeWorktree(id).catch(() => {});
      await core.flushEvents(id);
      return saved.job;
    },

    async revise(id, message) {
      const rec = core.get(id);
      if (rec.job.state !== "ready")
        throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${rec.job.state}, not ready`, {
          params: { machine: "job", from: rec.job.state, to: "queued" },
        });
      if (message.trim() === "") throw new MitoriError("E_INVALID_INPUT", "a revision needs a message");
      const session = core.parking.take(id);
      const req: JobReq = replanReq(rec);
      const saved = await core.update(id, "job.revise", (r) => {
        core.setState(r, "queued");
        r.job.attempt += 1;
        delete r.job.failure;
        for (const t of r.job.threads) core.threads.fire(t, "revise", "human", { message });
      });
      const p = await freshPlan(req);
      // the same mode as the ready job (a revision continues its conversation / worktree; spec §6.6.3)
      if (rec.job.route.mode === "agent" && p.mode === "agent") launch(id, (signal) => runAgentRevision(core, id, p, session, message, signal));
      else if (rec.job.route.mode === "patch" && p.mode === "patch") launch(id, (signal) => runRevision(core, id, p, session, message, signal));
      else {
        if (session) void session.close().catch(() => {});
        launch(id, pipeline(id, p));
      }
      return saved.job;
    },

    async retry(id, engine?: EngineId) {
      const rec = core.get(id);
      if (rec.job.state !== "failed")
        throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${rec.job.state}, not failed`, {
          params: { machine: "job", from: rec.job.state, to: "queued" },
        });
      const req: JobReq = replanReq(rec, engine);
      const p = await freshPlan(req);
      supported(p);
      // a retry never runs the final escalation on its own: that goes through `create` with `confirm` (spec §3.5: Opus
      // is a proposal). Other confirm reasons keep the retry behaviour they had.
      if (p.estimate.confirmReasons.includes("escalation"))
        throw new MitoriError("E_PRECONDITION", "this retry needs a confirmed estimate: escalate with a confirmation", {
          params: { estimateId: p.id, reasons: p.estimate.confirmReasons.join(","), actions: "escalate" },
        });
      const saved = await core.update(id, "job.retry", (r) => {
        core.setState(r, "queued");
        r.job.attempt += 1;
        r.job.engine = p.route.engine;
        r.job.route = p.route.decision;
        r.job.estimate = p.estimate;
        r.job.writeScope = writesOf(p);
        r.job.promptVer = promptVerOf(p);
        r.bundleBlobs = p.bundle.blobs;
        delete r.job.failure;
        for (const t of r.job.threads) core.threads.fire(t, "retry", "human");
      });
      launch(id, pipeline(id, p));
      return saved.job;
    },

    accept: (id, sel) => accept(core, id, sel),
    async runGates(id, gates) {
      let ran: Job;
      try {
        ran = await runGates(core, id, gates);
      } catch (e) {
        const err = MitoriError.from(e);
        // RT-31: a consented gate rewrote a linked dependency tree, or left the job worktree tampered with (its `.git`,
        // a symlinked directory) — the job must not stay acceptable
        const reason = (err.params as { reason?: unknown } | undefined)?.reason;
        if (reason === "dependency_changed" || reason === "worktree_tampered") await discardTampered(id, err);
        throw err;
      }
      // ADR-0013 4: the repair loop waited for this consent — a failing consented gate gets a REPAIR turn (bounded
      // by `limits.repairMaxAttempts` over the job's attempts; the new diff waits for consent again)
      const rec = core.get(id);
      const retry = ran.state === "ready" && ran.kind === "fix" ? consentRetry(rec) : null;
      if (!retry || rec.job.attempt > deps.settings().global.limits.repairMaxAttempts) return ran;
      const p = await freshPlan(replanReq(rec)).catch(() => null);
      if (!p || p.mode !== rec.job.route.mode) return ran;
      const session = core.parking.take(id);
      const saved = await core.update(id, "job.consent_repair", (r) => {
        core.setState(r, "queued");
        for (const t of r.job.threads) core.threads.fire(t, "revise", "human");
      });
      if (p.mode === "agent") launch(id, (signal) => runAgentConsentRepair(core, id, p, session, retry, signal));
      else launch(id, (signal) => runConsentRepair(core, id, p, session, retry, signal));
      return saved.job;
    },
    commit: (id, message) => commit(core, id, message),
    reject: (id, reason) => reject(core, id, reason),
    undo: (ck: CheckpointId, force) => undo(core, ck, force),

    externalPatch: (req, agent) => externalPatch({ core, plan, launch }, req, agent),
    async pullRequest() {
      throw new MitoriError("E_UNSUPPORTED", "pull requests arrive with WP-08c", { params: { what: "loop.jobs.pullRequest" } });
    },

    get(id) {
      const rec = core.store.get(id);
      if (!rec) return null;
      const views: DocProposalView[] = [];
      for (const pid of rec.job.proposals) {
        const p = deps.doc.proposals().find((x) => x.id === pid);
        if (!p) continue;
        const html = deps.renderMessage(p.md);
        // CR-PENDING(WP-08b): no word-diff renderer port in LoopDeps; the proposal HTML stands in for the diff
        views.push({ ...p, html, diffHtml: html });
      }
      const detail: JobDetail = { ...rec.job, diff: rec.extra.diff ?? [], proposalViews: views, events: core.events(id), bundleTokens: rec.bundleTokens };
      return detail;
    },

    events(id, after) {
      const all = core.events(id);
      return after === undefined ? all : all.slice(Math.max(0, after));
    },

    async recover() {
      const out = { requeued: [] as JobId[], failed: [] as JobId[], kept: [] as JobId[] };
      // interrupted accepts first: the journal tells applied, unapplied and mixed apart
      for (const row of deps.git.journal.writing()) {
        const how = await deps.git.recoverAccept(row.id).catch(() => "rolled_back" as const);
        if (how === "completed") {
          await core
            .update(row.job, "job.recover.accepted", (r) => {
              if (r.job.state === "ready" || r.job.state === "partially_accepted") {
                core.setState(r, "accepting");
                core.setState(r, "accepted");
                r.job.checkpoint = row.id;
              }
            })
            .catch(() => {});
        }
      }
      for (const rec of core.store.inStates(["queued", "waiting_lock"])) {
        await deps.write("job.recover.unlock", () => core.store.unlock(rec.job.id));
        try {
          const p = await freshPlan(replanReq(rec));
          supported(p);
          launch(rec.job.id, pipeline(rec.job.id, p));
          out.requeued.push(rec.job.id);
        } catch (e) {
          await core.fail(rec.job.id, e);
          out.failed.push(rec.job.id);
        }
      }
      for (const rec of core.store.inStates(["preparing", "running", "gating", "repairing"])) {
        await core.fail(rec.job.id, new MitoriError("E_INTERNAL", "daemon restart", { retryable: true, params: { actions: "retry" } }));
        out.failed.push(rec.job.id);
      }
      for (const rec of core.store.inStates(["ready", "partially_accepted"])) {
        out.kept.push(rec.job.id);
        await deps.write("job.recover.unlock", () => core.store.unlock(rec.job.id));
        const file = `${deps.home}/repos/${deps.ws.key}/jobs/${rec.job.id}/events.ndjson`;
        if (deps.fs.stat(file)?.isFile) {
          const text = new TextDecoder().decode(await deps.fs.read(file));
          core.setEvents(
            rec.job.id,
            text
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l) as never),
          );
        }
      }
      await deps.git.gc([...out.requeued, ...out.kept]).catch((e: unknown) => deps.log.warn("git gc failed", { error: MitoriError.from(e).message }));
      return out;
    },

    list(q) {
      const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
      const offset = q.cursor ? Math.max(0, Number.parseInt(q.cursor, 10) || 0) : 0;
      const rows = core.store.page({ ...(q.state ? { state: q.state } : {}), ...(q.thread ? { thread: q.thread } : {}), limit: limit + 1, offset });
      const more = rows.length > limit;
      return { items: (more ? rows.slice(0, limit) : rows).map((r) => r.job), next: more ? String(offset + limit) : null };
    },

    async settle() {
      while (core.live.size > 0) await Promise.all([...core.live.values()].map((l) => l.done));
    },

    async shutdown() {
      for (const l of core.live.values()) l.abort.abort();
      await runner.settle();
      await core.parking.closeAll();
    },
  };
  return runner;
}
