import type {
  Cancel,
  Clock,
  EngineId,
  EventSink,
  GlobalSettings,
  Iso8601,
  JobEvent,
  Logger,
  Metrics,
  ModelId,
  PauseReason,
  Random,
  SchedulerStatus,
  SseEventPayload,
  SubscriptionWindow,
  UsageRecord,
  Xxh3,
} from "@mitori/core";
import {
  type AgentScheduler,
  type Engine,
  type EngineResult,
  type EngineRun,
  type EngineSession,
  type Lane,
  type ScheduledRequest,
  SIGINT_GRACE_MS,
  type UsageLedger,
  type WarmProfile,
} from "../contract.ts";
import { baseModelId } from "../normalize/result.ts";
import { NOT_CALLED, RESULT_META, RelayRun } from "../util/run.ts";
import type { TimerHandle, Timers } from "../util/timers.ts";

export interface SchedulerDeps {
  engines: () => Partial<Record<EngineId, Engine | null>>;
  settings: () => GlobalSettings;
  ledger: UsageLedger;
  clock: Clock;
  timers: Timers;
  random: Random;
  log: Logger;
  metrics: Metrics;
  events: EventSink<SseEventPayload>;
  /** Warm + parked processes (status bar) [PT-13]. */
  residents: () => { procs: number; rssMb: number };
  /** One fixed-overhead sample (ledger-internal; absent for foreign ledgers). */
  recordOverhead?: (req: ScheduledRequest, res: EngineResult) => void;
}

type ContinueReq = Pick<ScheduledRequest, "lane" | "ws" | "scope" | "estimate" | "budget" | "ref">;

interface Job {
  seq: number;
  lane: Lane;
  engine: EngineId;
  model: ModelId;
  promptId: string | undefined;
  /** Request (submit) or the continuation's ledger facts. */
  req: ScheduledRequest | (ContinueReq & { engine: EngineId; model: ModelId });
  continuation: { session: EngineSession; prompt: string } | null;
  fanoutKey: Xxh3 | undefined;
  signal: Cancel;
  outer: RelayRun;
  /** Calibration factor applied by the caller when it estimated (RAW = estimate / factor) [CONS-24]. */
  factor: number;
  retried: boolean;
  state: "queued" | "running" | "done";
  released: boolean;
}

const LANES: readonly Lane[] = ["interactive", "doc", "background"];
const SUBSCRIPTION_ENGINES: ReadonlySet<EngineId> = new Set(["claude-cli", "codex-cli"]);
/** Recover one concurrency step per 5 minutes without a rate limit (spec §6.8). */
const RECOVER_MS = 300_000;
/** A fan-out leader without `message_start` for this long lets the next request lead (PT-18). */
const FANOUT_LEAD_MS = 10_000;
/** Released fan-out groups expire with the 5-minute prompt cache. */
const FANOUT_RELEASE_TTL_MS = 300_000;

const promptIdOf = (promptVer: string): string => promptVer.replace(/@\d+$/, "");

const outcomeOf = (r: EngineResult): UsageRecord["outcome"] =>
  r.stop === "end" ? "ok" : r.stop === "cancelled" ? "cancelled" : r.stop === "budget" ? "budget" : "error";

/** The global agent scheduler (spec §6.8, PT-04, PT-18, SEC-15, CONS-28). */
export function createAgentScheduler(deps: SchedulerDeps): AgentScheduler {
  const log = deps.log.child("agent.scheduler");
  const queues: Record<Lane, Job[]> = { interactive: [], doc: [], background: [] };
  const running = new Set<Job>();
  const sessionMeta = new WeakMap<EngineSession, { engine: EngineId; model: ModelId; promptId: string | undefined }>();
  const listeners = new Set<(s: SchedulerStatus & { window: SubscriptionWindow | null }) => void>();
  const fanout = new Map<Xxh3, { leader: number; timer: TimerHandle } | { releasedAt: number }>();
  let seq = 0;
  let draining = false;
  let latest: SubscriptionWindow | null = null;
  let penalty = 0;
  let consecutive = 0;
  let backoffUntil = 0;
  let lastRateLimitAt = 0;
  let backoffTimer: TimerHandle | null = null;
  let recoverTimer: TimerHandle | null = null;
  let resetTimer: TimerHandle | null = null;
  let resetsAtMs = 0;
  let bgEpisode: { baseline: number | null } | null = null;
  let spendPaused = false;
  let lastSig = "";

  const sched = () => deps.settings().scheduler;
  const cap = (engine?: EngineId): number => {
    const s = sched();
    const base = Math.max(1, Math.min(s.concurrency, s.maxConcurrency, 8));
    return engine !== undefined && SUBSCRIPTION_ENGINES.has(engine) ? Math.min(base, Math.max(1, s.subscriptionMaxConcurrency)) : base;
  };
  const effective = (engine?: EngineId): number => Math.max(1, cap(engine) - penalty);
  const fiveHour = (): number | null => latest?.fiveHour?.utilization ?? null;
  const yielding = (): boolean => {
    const u = fiveHour();
    return u !== null && u >= sched().yieldAtFiveHour && !(resetsAtMs > 0 && deps.clock.now() >= resetsAtMs);
  };
  const inBackoff = (): boolean => deps.clock.now() < backoffUntil;

  const lanePaused = (lane: Lane): PauseReason | null => {
    if (inBackoff()) return "rate_limit";
    if (lane !== "background") return null;
    if (latest?.billing === "overage") return "billing_changed";
    if (yielding()) return "yield_5h";
    if (spendPaused) return "window_spend";
    return null;
  };

  const status = (): SchedulerStatus => {
    const s: SchedulerStatus = {
      concurrency: sched().concurrency,
      effective: effective(),
      running: running.size,
      queued: LANES.reduce((n, l) => n + queues[l].length, 0),
      yielding: yielding(),
      reservedInteractive: sched().reserveInteractive,
      lanePaused: { interactive: lanePaused("interactive"), doc: lanePaused("doc"), background: lanePaused("background") },
      resident: deps.residents(),
    };
    if (inBackoff()) s.backoffUntil = new Date(backoffUntil).toISOString() as Iso8601;
    return s;
  };

  const notify = (): void => {
    const s = status();
    const sig = JSON.stringify([s, latest]);
    if (sig === lastSig) return;
    lastSig = sig;
    deps.events.emit({ type: "scheduler.updated", scheduler: s });
    for (const cb of listeners) {
      try {
        cb({ ...s, window: latest });
      } catch (err) {
        log.warn("agent.scheduler.listener_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  const runningIn = (pred: (j: Job) => boolean): number => {
    let n = 0;
    for (const j of running) if (pred(j)) n++;
    return n;
  };

  /** Capacity check (PT-04): background/doc ≤ C − reserve; interactive may burst while others run. */
  const hasRoom = (job: Job): boolean => {
    const s = sched();
    const eff = effective(job.engine);
    const sameCap = runningIn((j) => SUBSCRIPTION_ENGINES.has(j.engine) === SUBSCRIPTION_ENGINES.has(job.engine));
    if (job.lane === "interactive") {
      const others = runningIn((j) => j.lane !== "interactive");
      const burst = penalty === 0 && others > 0 ? Math.max(0, s.interactiveBurst) : 0;
      return sameCap < eff + burst && running.size < effective() + burst;
    }
    const nonInteractive = runningIn((j) => j.lane !== "interactive");
    return nonInteractive < Math.max(1, eff - Math.max(0, s.reserveInteractive)) && sameCap < eff && running.size < effective();
  };

  /** Fan-out gate (PT-18): one leader per key until its first `message_start`. */
  const fanoutGate = (job: Job): "go" | "lead" | "wait" => {
    if (job.fanoutKey === undefined || !sched().warmFirstFanout) return "go";
    const st = fanout.get(job.fanoutKey);
    if (!st) return "lead";
    if ("releasedAt" in st) {
      if (deps.clock.now() - st.releasedAt < FANOUT_RELEASE_TTL_MS) return "go";
      fanout.delete(job.fanoutKey);
      return "lead";
    }
    return "wait";
  };

  const release = (job: Job): void => {
    if (job.released) return;
    job.released = true;
    const key = job.fanoutKey;
    if (key === undefined) return;
    const st = fanout.get(key);
    if (st && "leader" in st && st.leader === job.seq) {
      deps.timers.clear(st.timer);
      fanout.set(key, { releasedAt: deps.clock.now() });
      pump();
    }
  };

  const dropLeader = (job: Job): void => {
    const key = job.fanoutKey;
    if (key === undefined) return;
    const st = fanout.get(key);
    if (st && "leader" in st && st.leader === job.seq) {
      deps.timers.clear(st.timer);
      fanout.delete(key);
    }
  };

  const onWindow = (w: SubscriptionWindow): void => {
    latest = w;
    const u = w.fiveHour?.utilization;
    const at = w.fiveHour?.resetsAt ? Date.parse(w.fiveHour.resetsAt) : 0;
    if (at !== resetsAtMs) {
      resetsAtMs = at;
      if (resetTimer !== null) deps.timers.clear(resetTimer);
      resetTimer =
        at > deps.clock.now()
          ? deps.timers.set(() => {
              pump();
              notify();
            }, at - deps.clock.now())
          : null;
    }
    if (bgEpisode && u !== undefined) {
      if (bgEpisode.baseline === null) bgEpisode.baseline = u;
      else if (u - bgEpisode.baseline > sched().runWindowSpendPause) spendPaused = true;
    }
    notify();
    pump();
  };

  const onRateLimit = (): void => {
    const now = deps.clock.now();
    lastRateLimitAt = now;
    if (now < backoffUntil) return; // one step per back-off episode
    const s = sched();
    consecutive++;
    penalty = Math.min(penalty + 1, cap() - 1);
    const base = Math.min(s.backoffMaxMs, s.backoffBaseMs * 2 ** (consecutive - 1));
    const b = deps.random.bytes(2);
    const jitter = 0.8 + 0.4 * (((b[0] ?? 0) * 256 + (b[1] ?? 0)) / 65535);
    backoffUntil = now + Math.round(Math.min(s.backoffMaxMs, base * jitter));
    if (backoffTimer !== null) deps.timers.clear(backoffTimer);
    backoffTimer = deps.timers.set(() => {
      backoffTimer = null;
      notify();
      pump();
    }, backoffUntil - now);
    scheduleRecovery();
    log.info("agent.scheduler.backoff", { penalty, untilMs: backoffUntil - now });
    notify();
  };

  const scheduleRecovery = (): void => {
    if (recoverTimer !== null) deps.timers.clear(recoverTimer);
    recoverTimer = deps.timers.set(() => {
      recoverTimer = null;
      if (deps.clock.now() - lastRateLimitAt < RECOVER_MS) return scheduleRecovery();
      penalty = Math.max(0, penalty - 1);
      consecutive = 0;
      if (penalty > 0) {
        lastRateLimitAt = deps.clock.now();
        scheduleRecovery();
      }
      notify();
      pump();
    }, RECOVER_MS);
  };

  const backgroundCount = (): number => queues.background.length + runningIn((j) => j.lane === "background");
  const trackEpisode = (): void => {
    if (backgroundCount() === 0) {
      bgEpisode = null;
      spendPaused = false;
    }
  };

  const observe = (job: Job, ev: JobEvent): void => {
    if ((ev.t === "usage" && !ev.final) || ev.t === "text" || ev.t === "result") release(job);
    if (ev.t === "window") onWindow(ev.window);
    if (ev.t === "error" && ev.code === "E_AGENT_RATE_LIMIT") onRateLimit();
  };

  const ledgerRow = (job: Job, r: EngineResult): void => {
    if (NOT_CALLED.has(r)) return;
    const meta = RESULT_META.get(r);
    const est = job.req.estimate;
    const rec: Omit<UsageRecord, "id"> = {
      at: deps.clock.iso(),
      ws: job.req.ws ?? null,
      scope: job.req.scope,
      engine: job.engine,
      model: job.model,
      auth: r.auth,
      usage: r.usage,
      estimate: { in: est.in, out: est.out, raw: { in: Math.round(est.in / (job.factor || 1)), out: est.out } },
      durationMs: r.durationMs,
      outcome: outcomeOf(r),
    };
    if (job.promptId !== undefined) rec.promptId = job.promptId;
    const served = meta?.servedBy;
    if (served && baseModelId(served) !== job.model) rec.servedBy = served;
    if (meta && meta.continuations > 0) rec.continuations = meta.continuations;
    if (r.ttftMs !== undefined) rec.ttftMs = r.ttftMs;
    if (r.window) rec.window = r.window;
    try {
      deps.ledger.record(rec);
      if (job.continuation === null && "mode" in job.req) deps.recordOverhead?.(job.req, r);
      deps.events.emit({ type: "usage.updated", today: deps.ledger.summary("today").totals, ...(latest ? { window: latest } : {}) });
    } catch (err) {
      log.error("agent.scheduler.ledger_failed", { err: err instanceof Error ? err.message : String(err) });
    }
  };

  const complete = (job: Job, r: EngineResult): void => {
    running.delete(job);
    if (!job.released) dropLeader(job);
    if (r.window && r.window !== latest) onWindow(r.window);
    const rate = r.error?.code === "E_AGENT_RATE_LIMIT";
    if (rate) onRateLimit();
    ledgerRow(job, r);
    if (job.outer.session && job.continuation === null) sessionMeta.set(job.outer.session, { engine: job.engine, model: job.model, promptId: job.promptId });
    if (rate && job.lane === "interactive" && job.continuation === null && !job.retried && !job.signal.aborted && !draining) {
      // interactive jobs retry a rate-limit failure once, after the back-off [仮]
      job.retried = true;
      job.state = "queued";
      job.released = false;
      queues.interactive.unshift(job);
    } else {
      job.state = "done";
      job.outer.resolve(r);
      trackEpisode();
    }
    notify();
    pump();
  };

  const start = (job: Job): void => {
    job.state = "running";
    running.add(job);
    const engine = deps.engines()[job.engine];
    let inner: EngineRun;
    try {
      if (job.continuation) {
        deps.metrics.inc("agent.continuations");
        inner = job.continuation.session.continue(job.continuation.prompt, job.req.budget, job.signal);
      } else {
        if (!engine) throw Object.assign(new Error(`engine ${job.engine} is not available`), { code: "E_AGENT_NOT_INSTALLED" });
        inner = engine.run(job.req as ScheduledRequest, job.signal);
      }
    } catch (err) {
      running.delete(job);
      job.state = "done";
      const code = (err as { code?: unknown }).code === "E_AGENT_NOT_INSTALLED" ? "E_AGENT_NOT_INSTALLED" : "E_AGENT_EXIT";
      job.outer.fail(code, err instanceof Error ? err.message : String(err), { retryable: code === "E_AGENT_EXIT" });
      trackEpisode();
      return;
    }
    void job.outer.attach(inner, (ev) => observe(job, ev)).then((r) => complete(job, r));
  };

  let pumping = false;
  const pump = (): void => {
    if (pumping || draining) return;
    pumping = true;
    try {
      let started = true;
      while (started) {
        started = false;
        for (const lane of LANES) {
          if (lanePaused(lane) !== null) continue;
          const q = queues[lane];
          for (let i = 0; i < q.length; i++) {
            const job = q[i] as Job;
            if (!hasRoom(job)) break;
            const gate = fanoutGate(job);
            if (gate === "wait") continue;
            q.splice(i, 1);
            if (gate === "lead" && job.fanoutKey !== undefined) {
              const key = job.fanoutKey;
              fanout.set(key, {
                leader: job.seq,
                timer: deps.timers.set(() => {
                  const st = fanout.get(key);
                  if (st && "leader" in st && st.leader === job.seq) {
                    fanout.delete(key);
                    pump();
                  }
                }, FANOUT_LEAD_MS),
              });
            }
            start(job);
            started = true;
            break;
          }
          if (started) break;
        }
      }
    } finally {
      pumping = false;
    }
    notify();
  };

  const enqueue = (job: Job): EngineRun => {
    if (draining) {
      job.outer.fail("E_SHUTTING_DOWN", "the daemon is shutting down");
      return job.outer;
    }
    if (job.lane === "background" && backgroundCount() === 0) bgEpisode = { baseline: fiveHour() };
    const cancelQueued = (): void => {
      if (job.state !== "queued") return;
      const q = queues[job.lane];
      const i = q.indexOf(job);
      if (i >= 0) q.splice(i, 1);
      job.state = "done";
      job.outer.fail("E_CANCELLED", "cancelled while queued", { cancelled: true });
      trackEpisode();
      notify();
      pump();
    };
    job.outer.onStopEarly = cancelQueued;
    if (job.signal.aborted) {
      job.state = "queued";
      cancelQueued();
      return job.outer;
    }
    job.signal.addEventListener("abort", cancelQueued, { once: true });
    queues[job.lane].push(job);
    pump();
    return job.outer;
  };

  const baseJob = (lane: Lane, signal: Cancel): Pick<Job, "seq" | "lane" | "signal" | "outer" | "retried" | "state" | "released"> => ({
    seq: ++seq,
    lane,
    signal,
    outer: new RelayRun(deps.clock),
    retried: false,
    state: "queued",
    released: false,
  });

  return {
    submit(req: ScheduledRequest, signal: Cancel): EngineRun {
      const promptId = promptIdOf(req.promptVer);
      let factor = 1;
      try {
        factor = deps.ledger.factor({ engine: req.engine, promptId, model: req.model }).factor || 1;
      } catch {
        factor = 1;
      }
      return enqueue({
        ...baseJob(req.lane, signal),
        engine: req.engine,
        model: req.model,
        promptId,
        req,
        continuation: null,
        fanoutKey: req.fanoutKey,
        factor,
      });
    },

    continueSession(session: EngineSession, prompt: string, req: ContinueReq, signal: Cancel): EngineRun {
      const meta = sessionMeta.get(session) ?? (session as { meta?: { model?: ModelId } }).meta;
      const engine: EngineId = (meta as { engine?: EngineId } | undefined)?.engine ?? "claude-cli";
      const model: ModelId = meta?.model ?? "claude-sonnet-5-5";
      if (!sessionMeta.has(session)) log.warn("agent.scheduler.unknown_session", { ref: req.ref });
      return enqueue({
        ...baseJob(req.lane, signal),
        engine,
        model,
        promptId: (meta as { promptId?: string } | undefined)?.promptId,
        req: { ...req, engine, model },
        continuation: { session, prompt },
        fanoutKey: undefined,
        factor: 1,
      });
    },

    prewarm(profile: WarmProfile): void {
      const e = deps.engines()["claude-cli"];
      if (e?.warm && !draining) void e.warm(profile).catch((err: unknown) => log.debug("agent.scheduler.prewarm_failed", { err: String(err) }));
    },

    status,

    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    window: () => latest,

    async drain(): Promise<void> {
      draining = true;
      for (const lane of LANES) {
        for (const job of queues[lane].splice(0)) {
          job.state = "done";
          job.outer.fail("E_SHUTTING_DOWN", "the daemon is shutting down", { cancelled: true });
        }
      }
      const results = [...running].map((j) => j.outer.result);
      for (const j of running) j.outer.stop("shutdown");
      let timer: TimerHandle | null = null;
      await Promise.race([Promise.allSettled(results), new Promise<void>((r) => (timer = globalThis.setTimeout(r, SIGINT_GRACE_MS + 1000)))]);
      if (timer !== null) globalThis.clearTimeout(timer as Parameters<typeof globalThis.clearTimeout>[0]);
      for (const h of [backoffTimer, recoverTimer, resetTimer]) if (h !== null) deps.timers.clear(h);
      for (const st of fanout.values()) if ("leader" in st) deps.timers.clear(st.timer);
      await Promise.allSettled(
        Object.values(deps.engines())
          .filter((e): e is Engine => !!e?.closeAll)
          .map((e) => (e.closeAll as () => Promise<void>)()),
      );
      notify();
    },
  };
}
