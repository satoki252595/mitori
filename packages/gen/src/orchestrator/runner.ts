/**
 * Run lifecycle and the priority-queue dispatcher (gen spec §3.4–§3.7, §9.8). One active run per workspace.
 * Ready = pending with every hard dep terminal; the best ready task by (boost, stage weight, topoOrder, rank,
 * id) is dispatched whenever the run has a free slot (C_bg = C − reserveInteractive, PT-04). The run pins its
 * system prompt + repo pack at start (PT-05) and mirrors the scheduler's yield / billing pauses (CONS-28).
 * Budget: dispatch stops at `stopAtBudgetFraction` × `genRunMaxUsd`; the run pauses `budget` once idle.
 */
import {
  type BlockId,
  base32,
  type EffectiveSettings,
  type EngineId,
  type GenEstimate,
  type GenEstimateReq,
  type GenRun,
  type GenRunId,
  type GenTask,
  type GenTaskId,
  type GenTaskView,
  type GitOid,
  MitoriError,
  type MitoriErrorData,
  type RepoPath,
  type SchedulerStatus,
  type SectionId,
  type SubscriptionWindow,
  toErrorData,
  type Usage,
} from "@mitori/core";
import { GEN_ESTIMATE_PARAMS, type GenDeps, type GenEngine, type GenPlan, type GenStartOptions, type PlannedTask } from "../contract.ts";
import { createSchedulerEngine } from "../engines/scheduler-engine.ts";
import { compareTasks, groupOf } from "../planner/params.ts";
import { CitableBuilder } from "../prompts/context.ts";
import { type GatherEnv, gatherInputs, type TermCandidate } from "../prompts/inputs.ts";
import type { GenVerifier } from "../verify/verifier.ts";
import { addUsage, type ExecEnv, executeTask, type RunCtx } from "./execute.ts";
import type { GenStore, TaskRow } from "./store.ts";

/** Internal services shared by the runner and the session engine. */
export interface Services {
  /** Deps. */
  deps: GenDeps;
  /** Tables. */
  store: GenStore;
  /** Verifier. */
  verifier: GenVerifier;
  /** Planner + estimator. */
  plan(req: GenEstimateReq): GenPlan;
  /** Estimate a plan. */
  estimate(plan: GenPlan, engine: EngineId, concurrency: number): GenEstimate;
  /** Doc language. */
  lang(): "ja" | "en";
}

const TERMINAL = new Set<GenTask["state"]>(["done", "cached", "skipped", "failed"]);
const FINISHED = new Set<GenTask["state"]>(["done", "cached", "skipped"]);

interface Live {
  run: GenRun;
  plan: GenPlan;
  pack: string | null;
  rows: Map<GenTaskId, TaskRow>;
  running: Map<GenTaskId, { abort: AbortController; call: { stop(r: "user"): void } | null; estUsd: number }>;
  boost: number;
  unsubscribe: (() => void) | null;
  pinnedBlobs: GitOid[];
  idle: Deferred;
  /** 5h window reset time at run start (κ samples are taken only when it did not change, §9.4). */
  resetsAtStart?: string;
}

/** Run-task id from the run and the plan task id (unique per run, stable for the run). */
export function runTaskId(deps: Pick<GenDeps, "hasher">, run: GenRunId, planId: GenTaskId): GenTaskId {
  const hex = deps.hasher.xxh3(`${run}\0${planId}`);
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `gt_${base32(bytes).slice(0, 10)}`;
}

/** Engine adapter for an engine id. */
export function engineFor(deps: GenDeps, id: EngineId): GenEngine {
  if (id !== "claude-cli" && id !== "anthropic-api")
    throw new MitoriError("E_INVALID_INPUT", `engine ${id} cannot run a push generation`, { params: { engine: id } });
  const s = deps.settings();
  if (!s.global.engines[id].enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", `engine ${id} is not enabled`, { params: { engine: id } });
  return deps.engines[id] ?? createSchedulerEngine(id, deps.scheduler, { ws: deps.ws.key, sandboxCwd: deps.sandboxCwd });
}

/** Runner (the push part of the orchestrator). */
export class Runner {
  private live: Live | null = null;

  constructor(private readonly svc: Services) {}

  private get deps() {
    return this.svc.deps;
  }

  /** Settings shorthand. */
  private s(): EffectiveSettings {
    return this.deps.settings();
  }

  private cap(): number {
    return this.s().global.limits.genRunMaxUsd || GEN_ESTIMATE_PARAMS.defaultRunMaxUsd;
  }

  /** Concurrency of a request (§3.5). */
  concurrencyOf(req: GenEstimateReq): number {
    const sch = this.s().global.scheduler;
    return Math.min(req.concurrency ?? sch.concurrency, sch.maxConcurrency);
  }

  /** Pin the run's system prompt + repo pack (PT-05) and remember the pack's blobs for stamping. */
  pin(workdir: string): { pack: string; pinned: NonNullable<GenRun["pinned"]>; blobs: GitOid[] } {
    const deps = this.deps;
    const pack = deps.indexer.repoPack({ tokenizer: "claude-v5", maxTokens: GEN_ESTIMATE_PARAMS.repoPackMaxTokens });
    const lang = this.svc.lang();
    const sys = deps.prompts.system("gen.system", lang, workdir, pack.text);
    deps.prompts.system("doc.system", lang, workdir, null);
    const snapshot = deps.indexer.snapshot()?.indexDigest ?? pack.indexDigest;
    const blobs = new Map<RepoPath, GitOid>();
    for (const p of new CitableBuilder().add(pack.text.split("\n")).paths()) {
      const b = deps.indexer.file(p)?.blob;
      if (b) blobs.set(p, b);
    }
    this.svc.verifier.remember(snapshot, blobs);
    return {
      pack: pack.text,
      pinned: { packKey: pack.key, systemHash: deps.hasher.sha256(sys.pack === null ? sys.system : `${sys.system}\n${sys.pack}`), snapshot },
      blobs: [...blobs.values()],
    };
  }

  async start(estimateId: string, opts: GenStartOptions = {}): Promise<GenRun> {
    const deps = this.deps;
    const row = this.svc.store.getEstimate(estimateId);
    if (!row) throw new MitoriError("E_NOT_FOUND", `estimate ${estimateId} not found`);
    if (deps.clock.now() > row.expiresAt) throw new MitoriError("E_PRECONDITION", "the estimate expired; estimate again", { params: { reason: "expired" } });
    if ((deps.indexer.snapshot()?.indexDigest ?? "") !== row.indexDigest)
      throw new MitoriError("E_PRECONDITION", "the index changed since the estimate; estimate again", { params: { reason: "index" } });
    if (row.estimate.apiUsd > this.cap())
      throw new MitoriError("E_BUDGET_EXCEEDED", "the estimate exceeds limits.genRunMaxUsd", { params: { usd: row.estimate.apiUsd, cap: this.cap() } });
    if (this.live && (this.live.run.state === "running" || this.live.run.state === "paused"))
      throw new MitoriError("E_CONFLICT", "a generation run is already active", { params: { run: this.live.run.id } });
    const plan = row.plan;
    engineFor(deps, plan.engine); // E_AGENT_NOT_INSTALLED / E_INVALID_INPUT before anything is created
    const id = deps.ids.next("genRun") as GenRunId;
    const { pack, pinned, blobs } = this.pin(deps.sandboxCwd);
    await deps.indexer.pinBlobs(blobs);
    const now = deps.clock.now();
    const notBefore = opts.notBefore ? Date.parse(opts.notBefore) : null;
    const run: GenRun = {
      id,
      ws: deps.ws.key,
      effort: plan.effort,
      trigger: "user",
      engine: plan.engine,
      scope: plan.scope,
      state: notBefore !== null && notBefore > now ? "paused" : "running",
      concurrency: this.slots(this.concurrencyOf(row.req)),
      pinned,
      windowAtStart: deps.scheduler.window()?.fiveHour?.utilization ?? null,
      estimate: row.estimate,
      progress: { total: plan.tasks.length, done: 0, failed: 0, blocks: 0 },
      usage: { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 },
      startedAt: new Date(now).toISOString(),
    };
    if (run.state === "paused") run.paused = { reason: "not_before", until: opts.notBefore as string };
    const map = new Map(plan.tasks.map((t) => [t.id, runTaskId(deps, id, t.id)]));
    const rows = new Map<GenTaskId, TaskRow>();
    plan.tasks.forEach((t, i) => {
      const tid = map.get(t.id) as GenTaskId;
      const p: PlannedTask = { ...t, id: tid, deps: t.deps.map((d) => map.get(d)).filter((d): d is GenTaskId => d !== undefined) };
      const task: GenTask = {
        id: tid,
        run: id,
        stage: t.stage,
        target: t.target,
        priority: plan.tasks.length - i,
        state: "pending",
        attempt: 0,
        cacheKey: t.cacheKey ?? "",
        model: t.model,
        estimate: { in: t.estimate.prefix + t.estimate.tail, out: t.estimate.out + t.estimate.thinking },
        blocks: [],
      };
      rows.set(tid, { task, plan: p, boost: 0, lane: "background" });
    });
    await deps.write("gen.run.start", () => {
      this.svc.store.putRun(run, plan, pack, notBefore);
      for (const r of rows.values()) this.svc.store.putTask(r);
    });
    const idle = deferred();
    this.live = { run, plan, pack, rows, running: new Map(), boost: 0, unsubscribe: null, pinnedBlobs: blobs, idle };
    const resetsAt = deps.scheduler.window()?.fiveHour?.resetsAt;
    if (resetsAt) this.live.resetsAtStart = resetsAt;
    this.live.unsubscribe = deps.scheduler.subscribe((st) => this.onScheduler(st));
    this.emitRun();
    for (const r of rows.values()) this.emitTask(r);
    this.pump();
    return { ...run };
  }

  private slots(c: number): number {
    return Math.max(1, c - this.s().global.scheduler.reserveInteractive);
  }

  /** Resolves once the active run has no running task and nothing more can be dispatched (tests, shutdown). */
  idle(): Promise<void> {
    return this.live?.idle.promise ?? Promise.resolve();
  }

  async control(id: GenRunId, action: "pause" | "resume" | "cancel"): Promise<GenRun> {
    const live = this.live;
    if (!live || live.run.id !== id) {
      const stored = this.svc.store.getRun(id);
      if (!stored) throw new MitoriError("E_NOT_FOUND", `run ${id} not found`);
      if (action === "resume" && stored.run.state === "paused") return this.resume(id);
      throw new MitoriError("E_PRECONDITION", `run ${id} is not active`);
    }
    const run = live.run;
    if (action === "pause") {
      if (run.state !== "running") throw new MitoriError("E_PRECONDITION", `run is ${run.state}`);
      run.state = "paused";
      run.paused = { reason: "user" };
    } else if (action === "resume") {
      if (run.state !== "paused") throw new MitoriError("E_PRECONDITION", `run is ${run.state}`);
      if (run.paused?.reason === "billing_changed")
        throw new MitoriError("E_PRECONDITION", "billing changed: estimate and confirm again", { params: { reason: "billing_changed" } });
      run.state = "running";
      delete run.paused;
    } else {
      if (run.state === "done" || run.state === "failed" || run.state === "cancelled") return { ...run };
      run.state = "cancelled";
      delete run.paused;
      run.finishedAt = new Date(this.deps.clock.now()).toISOString();
      for (const r of live.running.values()) {
        r.call?.stop("user");
        r.abort.abort();
      }
    }
    await this.persistRun();
    this.emitRun();
    this.pump();
    return { ...run };
  }

  /** Resume a run restored by `recover()` (daemon restart). */
  private async resume(id: GenRunId): Promise<GenRun> {
    const stored = this.svc.store.getRun(id);
    if (!stored) throw new MitoriError("E_NOT_FOUND", `run ${id} not found`);
    const rows = new Map(this.svc.store.tasks(id).map((r) => [r.task.id, r]));
    const run = stored.run;
    run.ws = this.deps.ws.key;
    run.state = "running";
    delete run.paused;
    if (stored.pack !== null) this.deps.prompts.system("gen.system", this.svc.lang(), this.deps.sandboxCwd, stored.pack);
    const idle = deferred();
    this.live = {
      run,
      plan: stored.plan,
      pack: stored.pack,
      rows,
      running: new Map(),
      boost: Math.max(0, ...[...rows.values()].map((r) => r.boost)),
      unsubscribe: null,
      pinnedBlobs: [],
      idle,
    };
    this.live.unsubscribe = this.deps.scheduler.subscribe((st) => this.onScheduler(st));
    this.refreshProgress();
    await this.persistRun();
    this.emitRun();
    this.pump();
    return { ...run };
  }

  prioritize(section: SectionId): void {
    const live = this.live;
    if (!live) return;
    const seq = ++live.boost;
    const writes = (r: TaskRow) => r.plan.sections.some((s) => s === section || s.startsWith(`${section}/`));
    const targets = [...live.rows.values()].filter((r) => !TERMINAL.has(r.task.state) && writes(r));
    for (const r of targets) {
      this.boostRow(r, seq);
      const open = r.plan.deps.map((d) => live.rows.get(d)).filter((d): d is TaskRow => d !== undefined && !TERMINAL.has(d.task.state));
      if (open.length <= 3) for (const d of open) this.boostRow(d, seq);
    }
    void this.deps.write("gen.boost", () => {
      for (const r of live.rows.values()) if (r.boost === seq) this.svc.store.putTask(r);
    });
    this.pump();
  }

  private boostRow(r: TaskRow, seq: number): void {
    r.boost = seq;
    r.lane = "doc";
    r.plan = { ...r.plan, lane: "doc" };
    r.task.priority = seq * 1_000_000 + (r.task.priority % 1_000_000);
    this.emitTask(r);
  }

  run(id: GenRunId): { run: GenRun; tasks: GenTask[] } | null {
    if (this.live?.run.id === id) return { run: { ...this.live.run }, tasks: [...this.live.rows.values()].map((r) => ({ ...r.task })) };
    const stored = this.svc.store.getRun(id);
    if (!stored) return null;
    const tasks = this.svc.store.tasks(id).map((r) => r.task);
    stored.run.ws = this.deps.ws.key;
    stored.run.progress = progressOf(tasks);
    return { run: stored.run, tasks };
  }

  active(): GenRun | null {
    const r = this.live?.run;
    return r && (r.state === "running" || r.state === "paused") ? { ...r } : null;
  }

  async recover(): Promise<GenRunId[]> {
    const store = this.svc.store;
    const out: GenRunId[] = [];
    for (const { run } of store.runs(["running", "paused"])) {
      const rows = store.tasks(run.id);
      const toDelete: BlockId[] = [];
      for (const r of rows) {
        if (r.task.state !== "running" && r.task.state !== "validating" && r.task.state !== "retrying") continue;
        for (const b of r.task.blocks) if (!this.deps.doc.block(b)?.lock) toDelete.push(b);
        r.task.state = "pending";
        r.task.blocks = r.task.blocks.filter((b) => !toDelete.includes(b));
      }
      run.state = "paused";
      run.paused = { reason: "user" };
      await this.deps.write("gen.recover", () => {
        if (toDelete.length > 0)
          this.deps.doc.applyGenerated([], {
            mode: "write",
            deletes: toDelete,
            source: { kind: "regen", id: run.id },
            reason: "partial output of an interrupted run",
            listed: 0,
          });
        for (const r of rows) store.putTask(r);
        store.updateRun(run);
      });
      out.push(run.id);
    }
    return out;
  }

  /** Mirror scheduler pauses into the run (CONS-28), window spend (UXP-08) and `not_before`. */
  private onScheduler(st: SchedulerStatus & { window: SubscriptionWindow | null }): void {
    const live = this.live;
    if (!live) return;
    const run = live.run;
    const before = { state: run.state, reason: run.paused?.reason, c: run.concurrency };
    const bg = st.lanePaused.background;
    if (run.state === "running" && bg === "yield_5h") {
      run.state = "paused";
      run.paused = st.window?.fiveHour?.resetsAt ? { reason: "yield_5h", until: st.window.fiveHour.resetsAt } : { reason: "yield_5h" };
    } else if (run.state === "running" && bg === "billing_changed") {
      run.state = "paused";
      run.paused = { reason: "billing_changed" };
    } else if (run.state === "paused" && run.paused?.reason === "yield_5h" && bg !== "yield_5h") {
      run.state = "running";
      delete run.paused;
    } else if (run.state === "paused" && run.paused?.reason === "not_before" && run.paused.until && this.deps.clock.now() >= Date.parse(run.paused.until)) {
      run.state = "running";
      delete run.paused;
    }
    const u = st.window?.fiveHour?.utilization;
    if (
      run.state === "running" &&
      typeof u === "number" &&
      typeof run.windowAtStart === "number" &&
      u - run.windowAtStart > this.s().global.scheduler.runWindowSpendPause
    ) {
      run.state = "paused";
      run.paused = { reason: "window_spend" };
    }
    run.concurrency = Math.max(1, Math.min(this.slots(this.concurrencyOf({ effort: run.effort })), st.effective - st.reservedInteractive));
    if (before.state !== run.state || before.reason !== run.paused?.reason || before.c !== run.concurrency) {
      void this.persistRun();
      this.emitRun();
    }
    this.pump();
  }

  /** Dispatch as many ready tasks as the run allows. */
  private pump(): void {
    const live = this.live;
    if (!live) return;
    const run = live.run;
    const dispatchable = (r: TaskRow) => run.state === "running" || (run.state === "paused" && run.paused?.reason === "yield_5h" && r.lane === "doc");
    const limit = this.s().global.limits.stopAtBudgetFraction * this.cap();
    const overBudget = () => run.usage.apiUsd + [...live.running.values()].reduce((n, x) => n + x.estUsd, 0) >= limit;
    while (live.running.size < run.concurrency && !overBudget() && run.state !== "cancelled") {
      const ready = [...live.rows.values()].filter(
        (r) => r.task.state === "pending" && dispatchable(r) && r.plan.deps.every((d) => TERMINAL.has(live.rows.get(d)?.task.state ?? "done")),
      );
      if (ready.length === 0) break;
      ready.sort((a, b) => compareTasks({ ...a.plan, boost: a.boost }, { ...b.plan, boost: b.boost }));
      this.launch(ready[0] as TaskRow);
    }
    if (live.running.size > 0) return;
    const pending = [...live.rows.values()].filter((r) => !TERMINAL.has(r.task.state));
    if (run.state === "running" && pending.length > 0 && overBudget()) {
      run.state = "paused";
      run.paused = { reason: "budget" };
      void this.persistRun();
      this.emitRun();
    }
    if (run.state === "running" && pending.length === 0) void this.finish("done");
    else if (run.state === "cancelled") void this.finish("cancelled");
    else live.idle.resolve();
  }

  private async finish(state: "done" | "cancelled"): Promise<void> {
    const live = this.live;
    if (!live) return;
    const run = live.run;
    run.state = state;
    run.finishedAt ??= new Date(this.deps.clock.now()).toISOString();
    const w = this.deps.scheduler.window()?.fiveHour;
    if (
      state === "done" &&
      typeof run.windowAtStart === "number" &&
      typeof w?.utilization === "number" &&
      run.usage.apiUsd >= GEN_ESTIMATE_PARAMS.kappaMinRunUsd
    ) {
      this.deps.ledger.recordWindowSample({
        utilizationBefore: run.windowAtStart,
        utilizationAfter: w.utilization,
        apiUsd: run.usage.apiUsd,
        resetsAtUnchanged: live.resetsAtStart !== undefined && live.resetsAtStart === w.resetsAt,
      });
    }
    await this.release(live);
    this.refreshProgress();
    await this.persistRun();
    this.emitRun();
    live.idle.resolve();
  }

  /** A terminal run stops mirroring the scheduler and unpins the blobs it pinned at start. */
  private async release(live: Live): Promise<void> {
    live.unsubscribe?.();
    live.unsubscribe = null;
    const blobs = live.pinnedBlobs;
    live.pinnedBlobs = [];
    if (blobs.length > 0) await this.deps.indexer.unpinBlobs(blobs);
  }

  private launch(row: TaskRow): void {
    const live = this.live as Live;
    if (live.idle.settled) live.idle = deferred();
    const abort = new AbortController();
    const slot: { abort: AbortController; call: { stop(r: "user"): void } | null; estUsd: number } = { abort, call: null, estUsd: row.plan.estimate.apiUsd };
    live.running.set(row.task.id, slot);
    row.task.state = "running";
    row.task.attempt = Math.max(1, row.task.attempt);
    this.emitTask(row);
    void this.deps.write("gen.task", () => this.svc.store.putTask(row));
    const env = this.execEnv();
    let engine: GenEngine;
    try {
      engine = engineFor(this.deps, live.run.engine);
    } catch (err) {
      void this.complete(row, { state: "failed", usage: null, calls: 0, attempts: 0, blocks: [], error: toErrorData(err), fatal: true });
      return;
    }
    const ctx: RunCtx = { id: live.run.id, trigger: live.run.trigger, engine, gather: this.gatherEnv(live), cancelled: () => live.run.state === "cancelled" };
    if (live.run.pinned) ctx.packSnapshot = live.run.pinned.snapshot;
    executeTask(env, ctx, row, abort.signal, {
      state: (st) => {
        row.task.state = st;
        if (st === "retrying") row.task.attempt = 2;
        this.emitTask(row);
      },
      cacheKey: (k) => {
        row.task.cacheKey = k;
      },
      call: (c) => {
        slot.call = c;
      },
      blocks: (ids) => {
        row.task.blocks = [...new Set([...row.task.blocks, ...ids])];
        void this.deps.write("gen.task.blocks", () => this.svc.store.putTask(row));
      },
    })
      .then((res) => this.complete(row, res))
      .catch((err: unknown) => this.complete(row, { state: "failed", usage: null, calls: 0, attempts: 1, blocks: [], error: toErrorData(err) }));
  }

  private async complete(
    row: TaskRow,
    res: { state: GenTask["state"]; usage: Usage | null; calls: number; blocks: BlockId[]; error?: MitoriErrorData; fatal?: boolean; attempts: number },
  ): Promise<void> {
    const live = this.live as Live;
    live.running.delete(row.task.id);
    this.deps.log.info("gen.task", {
      task: row.task.id,
      prompt: row.plan.prompt,
      model: row.plan.model,
      engine: live.run.engine,
      state: res.state,
      attempts: res.attempts,
      calls: res.calls,
      in: res.usage ? res.usage.in + res.usage.cacheWrite + res.usage.cacheRead : 0,
      out: res.usage?.out ?? 0,
      apiUsd: res.usage?.apiUsd ?? 0,
      error: res.error?.code,
    });
    row.task.state = res.state;
    row.task.blocks = [...new Set([...row.task.blocks, ...res.blocks])];
    if (res.attempts > 0) row.task.attempt = res.attempts;
    if (res.usage) {
      row.task.usage = addUsage(row.task.usage ?? null, res.usage);
      const u = live.run.usage;
      live.run.usage = {
        calls: u.calls + res.calls,
        in: u.in + res.usage.in,
        cacheWrite: u.cacheWrite + res.usage.cacheWrite,
        cacheRead: u.cacheRead + res.usage.cacheRead,
        out: u.out + res.usage.out,
        apiUsd: Math.round((u.apiUsd + res.usage.apiUsd) * 1e6) / 1e6,
      };
    }
    if (res.error) row.task.error = res.error;
    else delete row.task.error;
    if (res.state === "failed" && res.error?.code === "E_CANCELLED") row.task.state = "pending";
    this.refreshProgress();
    await this.deps.write("gen.task", () => this.svc.store.putTask(row));
    this.emitTask(row);
    if (res.fatal && live.run.state !== "cancelled") {
      live.run.state = "failed";
      live.run.finishedAt = new Date(this.deps.clock.now()).toISOString();
      for (const r of live.running.values()) r.call?.stop("user");
      await this.release(live);
      await this.persistRun();
      this.emitRun();
      live.idle.resolve();
      return;
    }
    await this.persistRun();
    this.emitRun();
    this.pump();
  }

  private refreshProgress(): void {
    const live = this.live;
    if (!live) return;
    live.run.progress = progressOf([...live.rows.values()].map((r) => r.task));
  }

  private async persistRun(): Promise<void> {
    const live = this.live;
    if (!live) return;
    const run = { ...live.run };
    await this.deps.write("gen.run", () => this.svc.store.updateRun(run));
  }

  private emitRun(): void {
    if (this.live) this.deps.events.emit({ type: "gen.run", run: { ...this.live.run } });
  }

  private emitTask(r: TaskRow): void {
    const t = r.task;
    const view: GenTaskView = { id: t.id, stage: t.stage, target: t.target, state: t.state, priority: t.priority, attempt: t.attempt, blocks: t.blocks };
    if (t.usage) view.usage = t.usage;
    if (t.error) view.error = t.error;
    this.deps.events.emit({ type: "gen.task", task: view });
  }

  /** Executor environment. */
  execEnv(): ExecEnv {
    const d = this.deps;
    return {
      doc: d.doc,
      write: d.write,
      prompts: d.prompts,
      verifier: this.svc.verifier,
      store: this.svc.store,
      settings: d.settings,
      clock: d.clock,
      log: d.log,
      metrics: d.metrics,
      events: d.events,
      lang: this.svc.lang(),
      sandboxCwd: d.sandboxCwd,
    };
  }

  /** Gather environment of a run: plan + glossary candidates from the run's module outputs. */
  gatherEnv(live: { plan: GenPlan; rows: Map<GenTaskId, TaskRow> }): GatherEnv {
    const d = this.deps;
    return {
      indexer: d.indexer,
      doc: d.doc,
      lang: this.svc.lang(),
      tokens: (t) => d.indexer.estimateTokens(t, "code", "claude-v5"),
      plan: live.plan,
      glossarySeeds: (d.settings().repo.glossary ?? []).map((g) => {
        const s: { term: string; yomi?: string; en?: string; definition: string } = { term: g.term, definition: g.definition };
        if (g.yomi) s.yomi = g.yomi;
        if (g.en) s.en = g.en;
        return s;
      }),
      candidates: () => candidatesOf(this.svc.store, [...live.rows.values()]),
    };
  }
}

/** Glossary candidates: term lines of the run's finished module tasks, deduped by normalized term, by count. */
export function candidatesOf(store: GenStore, rows: readonly TaskRow[]): { modules: number; terms: TermCandidate[] } {
  const counts = new Map<string, { c: TermCandidate; n: number; first: number }>();
  let modules = 0;
  let order = 0;
  const pages = rows
    .filter((r) => r.plan.prompt === "gen.module" && FINISHED.has(r.task.state) && r.task.cacheKey)
    .sort((a, b) => a.plan.topoOrder - b.plan.topoOrder || (a.task.id < b.task.id ? -1 : 1));
  for (const r of pages) {
    const out = store.getOutput(r.task.cacheKey);
    if (!out) continue;
    modules++;
    for (const l of out.lines) {
      const line = JSON.parse(l) as { t: string; term?: string; def?: string };
      if (line.t !== "term" || !line.term) continue;
      const key = line.term.normalize("NFKC").toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { c: { term: line.term, def: line.def ?? "", where: r.plan.sections[0] ?? "" }, n: 1, first: order++ });
    }
  }
  return { modules, terms: [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((x) => x.c) };
}

/** A promise with its resolver; re-armed when the run becomes busy again. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

function deferred(): Deferred {
  const d: Deferred = { promise: Promise.resolve(), resolve: () => undefined, settled: false };
  d.promise = new Promise<void>((r) => {
    d.resolve = () => {
      d.settled = true;
      r();
    };
  });
  return d;
}

function progressOf(tasks: readonly GenTask[]): GenRun["progress"] {
  return {
    total: tasks.length,
    done: tasks.filter((t) => FINISHED.has(t.state)).length,
    failed: tasks.filter((t) => t.state === "failed").length,
    blocks: tasks.reduce((n, t) => n + t.blocks.length, 0),
  };
}

/** Cache keys for dep-free tasks at estimate time (§3.2 "cached の先取り"); exact tails replace the plan figures. */
export async function precomputeKeys(
  svc: Services,
  plan: GenPlan,
  workdir: string,
  estimateTask: (t: PlannedTask, warm: boolean) => PlannedTask["estimate"],
): Promise<GenPlan> {
  const d = svc.deps;
  const env: GatherEnv = {
    indexer: d.indexer,
    doc: d.doc,
    lang: svc.lang(),
    tokens: (t) => d.indexer.estimateTokens(t, "code", "claude-v5"),
    plan,
  };
  const tasks: PlannedTask[] = [];
  for (const t of plan.tasks) {
    if (t.deps.length > 0) {
      tasks.push(t);
      continue;
    }
    const g = await gatherInputs(t, env);
    const r = d.prompts.render(t, g.inputs, { lang: svc.lang(), workdir });
    const cached = svc.store.getOutput(r.cacheKey) !== null;
    tasks.push({ ...t, cacheKey: r.cacheKey, cached, estimate: { ...t.estimate, tail: r.tokens.tail } });
  }
  const seen = new Set<string>();
  for (const t of tasks) {
    const g = groupOf(t);
    t.estimate = estimateTask(t, seen.has(g) || t.cached);
    if (!t.cached) seen.add(g);
  }
  return { ...plan, tasks };
}
