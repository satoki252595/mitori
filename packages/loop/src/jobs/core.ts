// Shared state of one workspace's job runner: ports, the job store, thread effects, the event log, the write-slot
// update helper, failure handling and file locks. The pipelines (pipeline.ts) and the review operations
// (review-ops.ts) build on it.
import type { AgentScheduler } from "@mitori/agent";
import type { AnchorEngine } from "@mitori/anchor";
import {
  type Anchor,
  type AnchorInput,
  assertTransition,
  type Clock,
  type EffectiveSettings,
  type EngineStatus,
  type ErrorCode,
  type EventSink,
  type FsReader,
  type Hasher,
  type JobEvent,
  type JobFailure,
  type JobId,
  type JobPhase,
  type JobState,
  type Logger,
  type Metrics,
  MitoriError,
  type Random,
  type RepoPath,
  type SafeWriter,
  type SecretScanner,
  type Sha256,
  type SqlDb,
  type SseEventPayload,
  type ThreadId,
  type WorkspaceInfo,
  type WriteQueue,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import type { BundleBuilder, CapturedAnchor, GateRunner, LoopDomainEvent, ReviewEngine } from "../contract.ts";
import { GIT_LIMITS } from "../contract.ts";
import type { GitSafetyHandle } from "../git/safety.ts";
import { Parking } from "./engine.ts";
import type { JobPlan } from "./plan.ts";
import { type JobRecord, JobStore } from "./store.ts";
import { JobThreads } from "./threads.ts";

/** Everything the job runner needs (LoopDeps + the composed loop parts). */
export interface JobRunnerDeps {
  ws: WorkspaceInfo;
  db: SqlDb;
  write: WriteQueue;
  random: Random;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  settings: () => EffectiveSettings;
  engines: () => EngineStatus[];
  scheduler: AgentScheduler;
  indexer: Indexer;
  doc: DocStore;
  anchors: AnchorEngine;
  hasher: Hasher;
  secrets: SecretScanner;
  events: EventSink<SseEventPayload>;
  domain: EventSink<LoopDomainEvent>;
  home: string;
  sandbox: "sandbox-exec" | "bwrap" | "none";
  trust: (item: "gates" | "rules" | "git_config", hash: Sha256) => "trusted" | "denied" | "pending";
  renderMessage: (md: string) => string;
  review: ReviewEngine;
  bundles: BundleBuilder;
  git: GitSafetyHandle;
  gates: GateRunner;
  fs: FsReader;
  safeWrite: SafeWriter;
  /** Async anchor capture (findings ⇒ draft threads). */
  capture(input: AnchorInput, previous: Anchor | null): Promise<CapturedAnchor>;
}

/** Job states a pipeline may still advance from. */
export const ACTIVE: readonly JobState[] = ["queued", "waiting_lock", "preparing", "running", "gating", "repairing"];
/** States after which the job never runs again. */
const TERMINAL: ReadonlySet<JobState> = new Set(["rejected", "done", "failed", "cancelled", "reverted"]);
/** Events kept per job (`JobDetail.events`). */
const EVENTS_MAX = 200;

/** Default suggested actions per failure code. */
function actionsFor(code: ErrorCode, params: Record<string, unknown> | undefined): JobFailure["actions"] {
  const given = typeof params?.actions === "string" ? (params.actions.split(",").filter(Boolean) as JobFailure["actions"]) : [];
  if (given.length > 0) return given;
  if (code === "E_SCOPE_VIOLATION" || code === "E_DENY_GLOB") return ["narrow_scope"];
  if (code === "E_PATCH_RANGE" || code === "E_PATCH_APPLY") return ["retry", "escalate"];
  if (code.startsWith("E_AGENT_") || code === "E_BUDGET_EXCEEDED") return ["retry", "other_engine", "copy_prompt"];
  if (code === "E_UNSUPPORTED") return ["copy_prompt"];
  return ["retry"];
}

/** A pipeline met a cancelled job: stop quietly. */
export class Stop extends Error {}

/** The runner core. */
export class RunnerCore {
  readonly store: JobStore;
  readonly threads: JobThreads;
  readonly parking = new Parking();
  /** Plans by estimate id (≤ 64). */
  readonly plans = new Map<string, JobPlan>();
  /** Running pipelines. */
  readonly live = new Map<JobId, { abort: AbortController; done: Promise<void> }>();
  private readonly log = new Map<JobId, JobEvent[]>();
  private readonly lockWaiters = new Set<() => void>();
  /** Gate / git_config trust hashes a `trust.request` was already sent for. */
  readonly asked = new Set<string>();

  constructor(readonly deps: JobRunnerDeps) {
    this.store = new JobStore(deps.db, deps.ws.key);
    this.threads = new JobThreads({ review: deps.review, db: deps.db, random: deps.random, clock: deps.clock, events: deps.events, renderMessage: deps.renderMessage });
  }

  remember(plan: JobPlan): void {
    this.plans.set(plan.id, plan);
    while (this.plans.size > 64) this.plans.delete(this.plans.keys().next().value as string);
  }

  /* ---- events --------------------------------------------------------------------------------------------- */

  emit(job: JobId, e: JobEvent): void {
    const list = this.log.get(job) ?? [];
    list.push(e);
    if (list.length > EVENTS_MAX) list.splice(0, list.length - EVENTS_MAX);
    this.log.set(job, list);
    this.deps.events.emit({ type: "job.event", job, event: e });
  }

  phase(job: JobId, phase: JobPhase, detail?: string): void {
    const e: JobEvent = { t: "phase", phase, at: this.deps.clock.now() };
    if (detail) e.detail = detail;
    this.emit(job, e);
  }

  events(job: JobId): JobEvent[] {
    return [...(this.log.get(job) ?? [])];
  }

  /** Restore the log of a job (recover after a restart). */
  setEvents(job: JobId, events: JobEvent[]): void {
    this.log.set(job, events.slice(-EVENTS_MAX));
  }

  /** Persist the event log as `~/.mitori/repos/<ws>/jobs/<id>/events.ndjson` (best effort). */
  async flushEvents(job: JobId): Promise<void> {
    const list = this.log.get(job);
    if (!list || list.length === 0) return;
    try {
      await this.deps.safeWrite.write(this.deps.home, `repos/${this.deps.ws.key}/jobs/${job}/events.ndjson`, `${list.map((e) => JSON.stringify(e)).join("\n")}\n`, "home");
    } catch (e) {
      this.deps.log.warn("job events not persisted", { job, error: MitoriError.from(e).message });
    }
  }

  /* ---- state ---------------------------------------------------------------------------------------------- */

  get(id: JobId): JobRecord {
    const rec = this.store.get(id);
    if (!rec) throw new MitoriError("E_NOT_FOUND", `job ${id} not found`, { params: { id } });
    return rec;
  }

  /** `rec.job.state = to` after the core table allowed it (timestamps follow). */
  setState(rec: JobRecord, to: JobState): void {
    assertTransition({ machine: "job", from: rec.job.state, to });
    rec.job.state = to;
    if (TERMINAL.has(to)) rec.job.finishedAt = this.deps.clock.iso();
  }

  /**
   * Mutate one job inside the write slot (with the thread effects `fn` fires, atomically), save, publish
   * `job.upsert` and the threads' summaries. A pipeline update on a cancelled job throws {@link Stop}.
   */
  update(id: JobId, label: string, fn: (rec: JobRecord) => void, opts: { pipeline?: boolean } = {}): Promise<JobRecord> {
    return this.deps.write(label, () =>
      this.deps.db.tx(() => {
        const rec = this.get(id);
        if (opts.pipeline && !ACTIVE.includes(rec.job.state)) throw new Stop(`job ${id} is ${rec.job.state}`);
        fn(rec);
        this.store.save(rec);
        this.deps.events.emit({ type: "job.upsert", job: rec.job });
        this.threads.touch(rec.job.threads);
        return rec;
      }),
    );
  }

  /** Fail an active job: failure info, threads → failed, a system message, locks released, worktree dropped. */
  async fail(id: JobId, err: unknown): Promise<void> {
    if (err instanceof Stop) return;
    const e = MitoriError.from(err);
    this.emit(id, { t: "error", code: e.code, message: e.message, retryable: e.retryable ?? false, at: this.deps.clock.now() });
    let rec: JobRecord;
    try {
      rec = await this.update(id, "job.fail", (r) => {
        if (!ACTIVE.includes(r.job.state)) throw new Stop("not active");
        this.setState(r, "failed");
        const failure: JobFailure = { code: e.code, message: e.message.slice(0, 300), actions: actionsFor(e.code, e.params as Record<string, unknown> | undefined) };
        r.job.failure = failure;
        for (const t of r.job.threads) {
          if (this.threads.fire(t, "fail", "system")) this.threads.say(t, id, "system", "system", `ジョブが失敗しました（${e.code}）: ${failure.message}`);
        }
        this.store.unlock(id);
      });
    } catch (x) {
      if (x instanceof Stop) return;
      throw x;
    }
    this.notifyUnlock();
    this.parking.release(id);
    if (rec.job.worktree) await this.deps.git.removeWorktree(id).catch(() => {});
    await this.flushEvents(id);
  }

  /* ---- file locks (spec §7.10) ---------------------------------------------------------------------------- */

  /** Take every write-scope path (waiting in `waiting_lock` while another job holds one; ≤ 15 min). */
  async lock(id: JobId, paths: readonly RepoPath[], signal: AbortSignal): Promise<void> {
    if (paths.length === 0) return;
    const deadline = this.deps.clock.now() + GIT_LIMITS.lockWaitMs;
    let waiting = false;
    for (;;) {
      const res = await this.deps.write("job.lock", () => this.deps.db.tx(() => this.store.lock(id, paths, this.deps.clock.iso())));
      if (res.ok) return;
      if (!waiting) {
        waiting = true;
        const h = res.holders[0] as { path: RepoPath; job: JobId };
        await this.update(
          id,
          "job.waiting_lock",
          (r) => {
            if (r.job.state !== "waiting_lock") this.setState(r, "waiting_lock");
          },
          { pipeline: true },
        );
        this.phase(id, "queued", `待機: ${h.path} を ${h.job} が編集中`);
      }
      const left = deadline - this.deps.clock.now();
      if (left <= 0) throw new MitoriError("E_LOCK_TIMEOUT", `waited ${Math.round(GIT_LIMITS.lockWaitMs / 60_000)} min for ${res.holders.map((x) => x.path).join(", ")}`);
      if (signal.aborted) throw new Stop("cancelled");
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.lockWaiters.delete(done);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(left, 30_000));
        this.lockWaiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }

  /** Locks were released somewhere: let waiting jobs retry. */
  notifyUnlock(): void {
    for (const w of [...this.lockWaiters]) w();
  }

  /** Threads of a job that are still in `state`. */
  threadsIn(rec: JobRecord, state: string): ThreadId[] {
    return rec.job.threads.filter((t) => this.threads.state(t) === state);
  }
}
