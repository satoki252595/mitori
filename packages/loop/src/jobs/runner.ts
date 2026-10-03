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
import type { JobRunner } from "../contract.ts";
import { ACTIVE, type JobRunnerDeps, RunnerCore, Stop } from "./core.ts";
import { runAnswer, runPatch, runRevision } from "./pipeline.ts";
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
          const r = rec.job.failure ? HISTORY[rec.job.failure.code] : undefined;
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
          if (MitoriError.from(e).code === "E_CANCELLED" && core.get(id).job.state === "cancelled") return;
          await core.fail(id, e).catch((x: unknown) => deps.log.error("job failure not recorded", { job: id, error: MitoriError.from(x).message }));
        }
      } finally {
        core.live.delete(id);
      }
    })();
    core.live.set(id, { abort, done });
  }

  function pipeline(id: JobId, p: JobPlan): (signal: AbortSignal) => Promise<void> {
    if (p.mode === "patch") return (signal) => runPatch(core, id, p, signal);
    return (signal) => runAnswer(core, id, p, signal);
  }

  /** Only patch / answer / findings run here; agent mode and docpatch notes arrive with WP-08c. */
  function supported(p: JobPlan): void {
    if (p.mode === "agent")
      throw new MitoriError("E_UNSUPPORTED", "agent mode arrives with WP-08c", { params: { what: "loop.jobs.agent", actions: "copy_prompt,narrow_scope" } });
    if (p.route.decision.contract === "docpatch/1")
      throw new MitoriError("E_UNSUPPORTED", "a sent doc note (docpatch/1) arrives with WP-08c", {
        params: { what: "loop.jobs.docpatch", actions: "copy_prompt" },
      });
  }

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
      writeScope: p.mode === "patch" ? p.scope.writeScope : [],
      gates: [],
      proposals: [],
      promptVer: (p.mode === "patch" ? "loop.patch@1" : p.mode === "findings" ? "loop.findings@1" : "loop.answer@1") as Job["promptVer"],
      createdAt: deps.clock.iso(),
    };
    return {
      job: j,
      baseCommit: null,
      bundleTokens: p.estimate.inTokens,
      bundleBlobs: p.bundle.blobs,
      extra: { newFiles: p.scope.newFiles, ...(p.route.note ? { note: p.route.note } : {}) },
    };
  }

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
      const job = await deps.write("job.create", () =>
        deps.db.tx(() => {
          for (const t of p.threads) {
            const cur = deps.review.get(t.id);
            const ok = cur && (cur.state === "open" || (cur.state === "queued" && cur.batchRound !== undefined));
            if (!ok)
              throw new MitoriError("E_PRECONDITION", `thread ${t.id} cannot be dispatched (${cur?.state ?? "missing"})`, {
                params: { id: t.id, state: cur?.state ?? "missing" },
              });
          }
          core.store.insert(rec);
          // CR m1-73: Finish already dispatched its threads (queued + batchRound)
          for (const t of p.threads) if (deps.review.get(t.id)?.state === "open") core.threads.fire(t.id, "dispatch", "human");
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
      const req: JobReq = { kind: rec.job.kind, threads: rec.job.threads, engine: rec.job.engine };
      const saved = await core.update(id, "job.revise", (r) => {
        core.setState(r, "queued");
        r.job.attempt += 1;
        delete r.job.failure;
        for (const t of r.job.threads) core.threads.fire(t, "revise", "human", { message });
      });
      const p = await freshPlan(req);
      if (session) launch(id, (signal) => runRevision(core, id, p, session, message, signal));
      else launch(id, pipeline(id, p));
      return saved.job;
    },

    async retry(id, engine?: EngineId) {
      const rec = core.get(id);
      if (rec.job.state !== "failed")
        throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${rec.job.state}, not failed`, {
          params: { machine: "job", from: rec.job.state, to: "queued" },
        });
      const req: JobReq = { kind: rec.job.kind, threads: rec.job.threads, engine: engine ?? rec.job.engine };
      const p = await freshPlan(req);
      supported(p);
      const saved = await core.update(id, "job.retry", (r) => {
        core.setState(r, "queued");
        r.job.attempt += 1;
        r.job.engine = p.route.engine;
        r.job.route = p.route.decision;
        r.job.estimate = p.estimate;
        r.job.writeScope = p.mode === "patch" ? p.scope.writeScope : [];
        r.bundleBlobs = p.bundle.blobs;
        delete r.job.failure;
        for (const t of r.job.threads) core.threads.fire(t, "retry", "human");
      });
      launch(id, pipeline(id, p));
      return saved.job;
    },

    accept: (id, sel) => accept(core, id, sel),
    runGates: (id, gates) => runGates(core, id, gates),
    commit: (id, message) => commit(core, id, message),
    reject: (id, reason) => reject(core, id, reason),
    undo: (ck: CheckpointId, force) => undo(core, ck, force),

    async externalPatch() {
      throw new MitoriError("E_UNSUPPORTED", "external patches (MCP submit_patch) arrive with WP-08c", { params: { what: "loop.jobs.externalPatch" } });
    },
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
          const p = await freshPlan({ kind: rec.job.kind, threads: rec.job.threads, engine: rec.job.engine });
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
