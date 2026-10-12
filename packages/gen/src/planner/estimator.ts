/**
 * Estimator (gen spec §9, R1): per-task token / API-equivalent $ / seconds from the §9.2–9.5 formulas,
 * a deterministic list-scheduling simulation of the dispatcher with warm-first fan-out, stage breakdown,
 * alternatives (claude-cli at C, session at C = 1 with batch tokens, anthropic-api when enabled), 5h-window
 * delta (κ when calibrated, else the `WINDOW_PRIORS` range with `window_risk` on the upper bound), billing and
 * the confirmation reasons (§9.8).
 */
import type { UsageLedger } from "@mitori/agent";
import {
  CALIBRATION,
  CHARS_PER_TOKEN,
  type ClaudeModelId,
  type Clock,
  type ConfirmReason,
  type EffectiveSettings,
  type EngineId,
  type EngineSettings,
  type GenEstimate,
  type GenStage,
  MitoriError,
  type ModelId,
  PRICING,
  type SubscriptionWindow,
  tokenBand,
  WINDOW_PRIORS,
} from "@mitori/core";
import type { GenIdSource } from "@mitori/doc";
import { GEN_ESTIMATE_PARAMS, type GenEstimator, type GenPlan, type PlannedTask, type ScheduleSimulation, type TaskEstimate } from "../contract.ts";
import { groupOf, outTarget, speedOf, startupOf, thinkingOf, ttftOf } from "./params.ts";

/** Ports of the estimator. */
export interface EstimatorDeps {
  /** Settings. */
  settings: () => EffectiveSettings;
  /** Calibration factors and κ. */
  ledger: Pick<UsageLedger, "factor" | "windowFactor">;
  /** Last observed subscription window (scheduler). */
  window: () => SubscriptionWindow | null;
  /** Clock (expiry). */
  clock: Clock;
  /** Ids (`estimate`). */
  ids: GenIdSource;
  /** Plan label for the κ prior (`pro`, `max5`, `max20`; unknown otherwise). */
  plan?: () => string | null;
}

const P = GEN_ESTIMATE_PARAMS;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const price = (m: ModelId, prices?: EngineSettings["generic"]["pricing"]) => {
  const base = PRICING[(m in PRICING ? m : "claude-sonnet-5-5") as ClaudeModelId];
  return prices && !(m in PRICING)
    ? { ...base, ...prices, cacheWrite5mPerMTok: prices.inPerMTok, cacheWrite1hPerMTok: prices.inPerMTok, batchMultiplier: 1 }
    : base;
};

/**
 * The expected value of the one line-retry a task may take (§6.4): with probability `retryRate` a continuation
 * turn re-reads the whole conversation from the cache (prompt + first reply), writes the first reply and the retry
 * message to it, and answers with `retryCost` × the first reply. Push engines only (a session ingest has no
 * continuation). Kept out of {@link task}: the per-call raw figures stay what the ledger's EMA compares against.
 * Measured (dogfood M-2, 2026-10-04): 63-71 % of tasks retried, retry input 0.70-0.88 × the first calls',
 * retry output 0.25-0.31 × theirs; without this term the token estimate was off by +84 % / +93 %.
 */
export function withRetry(t: PlannedTask, e: TaskEstimate, engine: EngineId, prices?: EngineSettings["generic"]["pricing"]): TaskEstimate {
  if (t.cached || engine === "session" || e.tail === 0) return e;
  const r = P.retryRate;
  const pr = price(t.model, prices);
  const reply = e.out + e.thinking;
  const read = e.uncached + e.cacheWrite + e.cacheRead;
  const cold = engine === "generic" || engine === "codex-cli";
  const usd = (read * (cold ? pr.inPerMTok : pr.cacheReadPerMTok) + reply * pr.cacheWrite5mPerMTok + P.retryCost * reply * pr.outPerMTok) / 1e6;
  return {
    ...e,
    cacheRead: cold ? e.cacheRead : Math.round(e.cacheRead + r * read),
    cacheWrite: cold ? e.cacheWrite : Math.round(e.cacheWrite + r * reply),
    uncached: cold ? Math.round(e.uncached + r * (read + reply)) : e.uncached,
    out: Math.round(e.out + r * P.retryCost * e.out),
    thinking: Math.round(e.thinking + r * P.retryCost * e.thinking),
    apiUsd: round6(e.apiUsd + r * usd),
    seconds: Math.round((e.seconds + r * (ttftOf(t.model, t.effort, engine) + (P.retryCost * reply) / speedOf(t.model, t.effort))) * 10) / 10,
  };
}

/**
 * Byte-upper basis for usage-less generic engines (`text` / `muse-jsonl`): they report no token counts, so the
 * run records UTF-8 bytes as tokens (`generic-engine.ts`, conservative by design). The pre-run estimate uses the
 * same basis by converting its token figures to expected UTF-8 bytes with the tables it already uses — input was
 * estimated as code tokens (ASCII-dominant, 1 byte/char), output is Japanese markdown (CJK, 3 bytes/char in
 * UTF-8). Upper-leaning on purpose (the card labels it バイト換算の上限推計): on the measured Muse run
 * (`docs/progress/gen-muse/report.json`) recorded/estimated was 1.93 in / 2.92 out, both below these factors.
 * `openai-chat` reports usage, and Claude / Codex / session / API engines keep token figures.
 */
const BYTE_PER_TOKEN_IN = CHARS_PER_TOKEN["claude-v5"].code;
const BYTE_PER_TOKEN_OUT = CHARS_PER_TOKEN["claude-v5"].markdown_ja * 3;

/** True for the generic protocols that report no usage (`text`, unset, `muse-jsonl`). */
export function isByteUpperProtocol(protocol: EngineSettings["generic"]["protocol"]): boolean {
  return (protocol ?? "text") !== "openai-chat";
}

/**
 * Token-based raw figures → byte-upper figures for a usage-less generic engine. Same splits and $ as `task()`
 * for a cold engine (generic never caches, so no cache classes; `τ` mirrors the same table); `seconds` passes through because
 * wall time still follows tokens. Kept out of `task()` so stored estimates stay token-based and idempotent —
 * the planner, `precomputeKeys` and `durations()` all re-derive from stored figures, which a conversion inside
 * `task()` would scale twice. The ledger never feeds these back (`usageEstimated` calls skip calibration).
 */
export function toByteUpper(t: PlannedTask, e: TaskEstimate, prices?: EngineSettings["generic"]["pricing"]): TaskEstimate {
  const prefix = Math.round(e.prefix * BYTE_PER_TOKEN_IN);
  const tail = Math.round(e.tail * BYTE_PER_TOKEN_IN);
  const out = Math.round(e.out * BYTE_PER_TOKEN_OUT);
  const thinking = Math.round(e.thinking * BYTE_PER_TOKEN_OUT);
  const pr = price(t.model, prices);
  const tau = (P.tailCacheWriteShare as Readonly<Record<string, number>>).generic ?? 0;
  const usd =
    (prefix * pr.cacheWrite5mPerMTok + tau * tail * pr.cacheWrite5mPerMTok + (1 - tau) * tail * pr.inPerMTok + (out + thinking) * pr.outPerMTok) / 1e6;
  return { prefix, tail, out, thinking, cacheWrite: 0, cacheRead: 0, uncached: prefix + tail, apiUsd: round6(usd), seconds: e.seconds };
}

/** Lead of a fan-out group (first in plan order); followers read the cached prefix. */
function warmFlags(tasks: readonly PlannedTask[]): boolean[] {
  const seen = new Set<string>();
  return tasks.map((t) => {
    if (t.cached) return true;
    const g = groupOf(t);
    const warm = seen.has(g);
    seen.add(g);
    return warm;
  });
}

/** Factory. */
export function createEstimator(
  deps: EstimatorDeps,
): GenEstimator & { calibrationFactor(t: PlannedTask, engine: EngineId): { factor: number; n: number; accuracyPct: number } } {
  const calibrationFactor = (t: PlannedTask, engine: EngineId) => {
    const f = deps.ledger.factor({ engine, promptId: t.prompt, model: t.model });
    return f.n >= CALIBRATION.minN ? f : { factor: 1, n: f.n, accuracyPct: f.accuracyPct };
  };

  /**
   * RAW (uncalibrated) per-task figures, idempotent over its own output: `prefix` = system + pack (the claude-cli
   * fixed overhead ε is counted in the cache tokens), `tail` = user message, `out` = visible target O (a
   * prefilled `out` > 0 — labels / glossary counts — is kept), `thinking` = Θ(O). Calibration is applied by
   * `estimate()` when totals are formed; the raw figures are what the ledger's EMA compares against (CONS-24).
   */
  function task(t: PlannedTask, engine: EngineId, warmPrefix: boolean): TaskEstimate {
    const zero: TaskEstimate = { prefix: 0, tail: 0, out: 0, thinking: 0, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0, seconds: 0 };
    if (t.cached) return zero;
    const prefix = t.estimate.prefix > 0 ? t.estimate.prefix : P.systemTokens;
    const p = prefix + (engine === "claude-cli" ? P.cliOverheadTokens : 0);
    const tail = t.estimate.tail;
    const o = t.estimate.out > 0 ? t.estimate.out : outTarget(t.prompt, t.mode, tail);
    const th = thinkingOf(t.model, t.effort, o, engine);
    const cold = engine === "generic" || engine === "codex-cli";
    const prices = cold ? deps.settings().global.engines[engine].pricing : undefined;
    if (cold && !(t.model in PRICING) && !prices)
      throw new MitoriError("E_CFG_INVALID", `engines.${engine}.pricing is required for a model without known prices`);
    const pr = price(t.model, prices);
    const tau = (P.tailCacheWriteShare as Readonly<Record<string, number>>)[engine] ?? 0;
    const w = warmPrefix && !cold ? 0 : 1;
    const pw = pr.cacheWrite5mPerMTok;
    const usd = (w * p * pw + (1 - w) * p * pr.cacheReadPerMTok + tau * tail * pw + (1 - tau) * tail * pr.inPerMTok + (o + th) * pr.outPerMTok) / 1e6;
    const sigma = engine === "session" ? 0 : startupOf(engine);
    return {
      prefix,
      tail,
      out: o,
      thinking: th,
      cacheWrite: cold ? 0 : Math.round(w * p + tau * tail),
      cacheRead: cold ? 0 : Math.round((1 - w) * p),
      uncached: Math.round(cold ? p + tail : (1 - tau) * tail),
      apiUsd: round6(usd),
      seconds: Math.round((sigma + ttftOf(t.model, t.effort, engine) + (o + th) / speedOf(t.model, t.effort)) * 10) / 10,
    };
  }

  /** Calibrated copy of a raw task estimate (factor f on tokens, $ and the output part of the duration). */
  function calibrated(t: PlannedTask, e: TaskEstimate, engine: EngineId): TaskEstimate {
    const f = calibrationFactor(t, engine).factor;
    if (f === 1) return e;
    const outSec = (e.out + e.thinking) / speedOf(t.model, t.effort);
    return {
      ...e,
      out: Math.round(f * e.out),
      thinking: Math.round(f * e.thinking),
      cacheWrite: Math.round(f * e.cacheWrite),
      cacheRead: Math.round(f * e.cacheRead),
      uncached: Math.round(f * e.uncached),
      apiUsd: round6(f * e.apiUsd),
      seconds: Math.round((e.seconds + (f - 1) * outSec) * 10) / 10,
    };
  }

  /** Expected per-task figures in plan order for `engine` (calibrated, with the expected retry). */
  function durations(plan: GenPlan, engine: EngineId): { t: PlannedTask; e: TaskEstimate }[] {
    const warm = warmFlags(plan.tasks);
    const byte = engine === "generic" && isByteUpperProtocol(deps.settings().global.engines.generic.protocol);
    const prices = engine === "generic" || engine === "codex-cli" ? deps.settings().global.engines[engine].pricing : undefined;
    return plan.tasks.map((t, i) => {
      const raw = task(t, engine, warm[i] ?? false);
      if (!byte) return { t, e: withRetry(t, calibrated(t, raw, engine), engine, prices) };
      // Counts and $ ride the byte figures (the retry re-reads byte-counted input); wall time still follows
      // tokens, so seconds come from the token-based retry.
      const e = withRetry(t, calibrated(t, toByteUpper(t, raw, prices), engine), engine, prices);
      return { t, e: { ...e, seconds: withRetry(t, calibrated(t, raw, engine), engine, prices).seconds } };
    });
  }

  function simulateWith(items: readonly { t: PlannedTask; e: TaskEstimate }[], engine: EngineId, slots: number): ScheduleSimulation {
    const byId = new Map(items.map((x) => [x.t.id, x]));
    const finish = new Map<string, number>();
    const start = new Map<string, number>();
    const groupGate = new Map<string, number>();
    const pending = items.map((x) => x.t);
    const running: { id: string; end: number }[] = [];
    let now = 0;
    const firstToken = (t: PlannedTask) => (engine === "session" ? 0 : startupOf(engine)) + ttftOf(t.model, t.effort, engine);
    while (pending.length > 0 || running.length > 0) {
      let started = true;
      while (started && running.length < slots) {
        started = false;
        const idx = pending.findIndex(
          (t) => t.deps.every((d) => !byId.has(d) || (finish.get(d) ?? Number.POSITIVE_INFINITY) <= now) && (groupGate.get(groupOf(t)) ?? 0) <= now,
        );
        if (idx < 0) break;
        const t = pending.splice(idx, 1)[0] as PlannedTask;
        const d = byId.get(t.id)?.e.seconds ?? 0;
        start.set(t.id, now);
        running.push({ id: t.id, end: now + d });
        const g = groupOf(t);
        if (!groupGate.has(g) && !t.cached) groupGate.set(g, now + firstToken(t));
        started = true;
      }
      const nextEnd = Math.min(...running.map((r) => r.end));
      const gates = pending.map((t) => groupGate.get(groupOf(t)) ?? 0).filter((g) => g > now);
      const next = Math.min(nextEnd, ...gates);
      if (!Number.isFinite(next)) break;
      now = next;
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i] as { id: string; end: number };
        if (r.end <= now) {
          finish.set(r.id, r.end);
          running.splice(i, 1);
        }
      }
    }
    const makespan = Math.max(0, ...finish.values());
    // critical path (C = ∞)
    const cp = new Map<string, number>();
    for (const { t, e } of items) cp.set(t.id, e.seconds + Math.max(0, ...t.deps.map((d) => cp.get(d) ?? 0)));
    const first = items.find((x) => !x.t.cached && (x.t.stage === "S6o" || x.t.stage === "S5" || x.t.stage === "S6"));
    const firstBlockSec = first ? (start.get(first.t.id) ?? 0) + firstToken(first.t) + 150 / speedOf(first.t.model, first.t.effort) : 0;
    const stages: GenStage[] = [];
    for (const { t } of items) if (!stages.includes(t.stage)) stages.push(t.stage);
    const byStage = stages.map((stage) => {
      const sub = items.filter((x) => x.t.stage === stage).map((x) => ({ t: { ...x.t, deps: [] }, e: x.e }));
      return { stage, seconds: sub.length === items.length ? Math.round(makespan * 10) / 10 : simulateWith(sub, engine, slots).makespanSec };
    });
    return {
      makespanSec: Math.round(makespan * 10) / 10,
      criticalPathSec: Math.round(Math.max(0, ...cp.values()) * 10) / 10,
      firstBlockSec: Math.round(firstBlockSec * 10) / 10,
      byStage,
    };
  }

  const effectiveSlots = (engine: EngineId, c: number) => {
    if (engine === "session") return 1;
    const s = deps.settings().global.scheduler;
    return Math.max(1, Math.min(c, s.maxConcurrency) - s.reserveInteractive);
  };

  /** Session batches (§8.4 R1): same phase, ≤ sessionBatchTasks tasks and ≤ sessionBatchMaxInTokens input. */
  function sessionBatches(items: readonly { t: PlannedTask; e: TaskEstimate }[]): { tasks: number; tokens: number }[] {
    const out: { tasks: number; tokens: number; phase: number; in: number }[] = [];
    for (const { t, e } of items) {
      if (t.cached) continue;
      const last = out.at(-1);
      if (!last || last.phase !== t.phase || last.tasks >= P.sessionBatchTasks || last.in + e.tail > P.sessionBatchMaxInTokens)
        out.push({ tasks: 0, tokens: 0, phase: t.phase, in: 0 });
      const b = out.at(-1) as (typeof out)[number];
      if (b.tasks === 0) b.tokens += e.prefix + P.sessionSubagentBaseTokens + P.readLineOverheadTokens * Math.ceil(e.prefix / 12);
      b.tasks++;
      b.in += e.tail;
      b.tokens += e.tail + P.readLineOverheadTokens * Math.ceil(e.tail / 12) + e.out + e.thinking;
    }
    return out;
  }

  function estimate(plan: GenPlan, engine: EngineId, concurrency: number): GenEstimate {
    const s = deps.settings();
    const slots = effectiveSlots(engine, concurrency);
    const items = durations(plan, engine);
    const sim = simulateWith(items, engine, slots);
    let inTok = 0;
    let cw = 0;
    let cr = 0;
    let out = 0;
    let usd = 0;
    for (const { e } of items) {
      inTok += e.uncached;
      cw += e.cacheWrite;
      cr += e.cacheRead;
      out += e.out + e.thinking;
      usd += e.apiUsd;
    }
    usd = round6(usd);
    const stageList: GenStage[] = [];
    for (const { t } of items) if (!stageList.includes(t.stage)) stageList.push(t.stage);
    const stages = stageList.map((stage) => {
      const sub = items.filter((x) => x.t.stage === stage);
      return {
        stage,
        tasks: sub.length,
        inTokens: sub.reduce((n, x) => n + x.e.uncached + x.e.cacheWrite + x.e.cacheRead, 0),
        outTokens: sub.reduce((n, x) => n + x.e.out + x.e.thinking, 0),
        apiUsd: round6(sub.reduce((n, x) => n + x.e.apiUsd, 0)),
        seconds: sim.byStage.find((b) => b.stage === stage)?.seconds ?? 0,
      };
    });
    const cold = engine === "generic" || engine === "codex-cli";
    const sessionItems = cold ? [] : durations(plan, "session");
    const sessionSeconds = sessionItems.reduce((n, x) => n + (x.t.cached ? 0 : x.e.seconds + P.startupSec.session), 0);
    const batches = sessionBatches(sessionItems);
    const alternatives: GenEstimate["alternatives"] = [];
    if (engine !== "session" && !cold) alternatives.push(alternative(plan, "claude-cli", concurrency));
    if (!cold)
      alternatives.push({
        engine: "session",
        concurrency: 1,
        seconds: Math.round(sessionSeconds),
        apiUsd: round6(sessionItems.reduce((n, x) => n + x.e.apiUsd, 0)),
        sessionTokens: batches.reduce((n, b) => n + b.tokens, 0),
        batches: batches.length,
        uncalibrated: true,
      });
    if (s.global.engines["anthropic-api"].enabled && engine !== "anthropic-api" && !cold) alternatives.push(alternative(plan, "anthropic-api", concurrency));
    if (engine === "anthropic-api") alternatives.unshift(alternative(plan, "anthropic-api", concurrency));

    const window = deps.window();
    const kappa = deps.ledger.windowFactor();
    const prior = WINDOW_PRIORS[(deps.plan?.() ?? "unknown") as keyof typeof WINDOW_PRIORS] ?? WINDOW_PRIORS.unknown;
    const windowed = engine !== "anthropic-api" && !cold;
    const calibrated = kappa.kappa !== null && kappa.n >= P.kappaMinN;
    const windowDeltaPct = windowed && window?.fiveHour && calibrated ? Math.round(100 * (kappa.kappa as number) * usd * 10) / 10 : null;
    const range = windowed && !calibrated ? { low: Math.round(prior.low * usd * 10) / 10, high: Math.round(prior.high * usd * 10) / 10 } : undefined;
    const reasons: ConfirmReason[] = ["generation_run"];
    if (inTok + cw + cr + out > s.global.limits.confirmAboveTokens) reasons.push("over_token_threshold");
    if (plan.effort === "complete") reasons.push("whole_repo_scope");
    if (windowed && window?.billing === "overage") reasons.push("billing_overage");
    if (engine === "anthropic-api") reasons.push("api_key_billing");
    if (windowed && window?.fiveHour) {
      const delta = windowDeltaPct ?? range?.high ?? 0;
      if (window.fiveHour.utilization * 100 + delta > s.global.scheduler.yieldAtFiveHour * 100) reasons.push("window_risk");
    }
    const dominant = plan.tasks.find((t) => t.prompt === "gen.module") ?? plan.tasks[0];
    const cal = dominant ? calibrationFactor(dominant, engine) : { factor: 1, n: 0, accuracyPct: P.confidenceInitPct };
    const confidencePct =
      cal.n < CALIBRATION.pointEstimateN
        ? P.confidenceInitPct
        : Math.min(P.confidenceClampPct[1], Math.max(P.confidenceClampPct[0], Math.round(cal.accuracyPct)));
    const billing = engine === "anthropic-api" ? "metered-api" : cold ? "unknown" : (window?.billing ?? "unknown");
    const packTokens = items.find((x) => x.e.prefix > 0)?.e.prefix ?? 0;
    const est: GenEstimate = {
      id: deps.ids.next("estimate") as GenEstimate["id"],
      engine,
      model: s.global.models.genModule,
      inTokens: inTok,
      cacheReadTokens: cr,
      cacheWriteTokens: cw,
      outTokens: out,
      apiUsd: usd,
      seconds: { p50: Math.round(sim.makespanSec), p90: Math.round(sim.makespanSec * P.p90OverP50) },
      concurrency: slots,
      windowDeltaPct,
      billing,
      confidencePct,
      calibrationN: cal.n,
      band: tokenBand(inTok + cw + cr + out),
      items: [
        {
          key: "repo_pack",
          kind: "repo_pack",
          label: "repo pack",
          tokens: Math.max(0, packTokens - P.systemTokens),
          cached: !cold,
          removable: false,
        },
        { key: "fixed", kind: "fixed", label: "gen.system", tokens: P.systemTokens, cached: !cold, removable: false },
        {
          key: "module",
          kind: "module",
          label: "module inputs",
          tokens: items.filter((x) => x.t.stage === "S5").reduce((n, x) => n + x.e.tail, 0),
          cached: false,
          removable: false,
        },
        { key: "output", kind: "output", label: "output", tokens: out, cached: false, removable: false },
      ],
      requiresConfirm: true,
      confirmReasons: reasons,
      expiresAt: new Date(deps.clock.now() + P.estimateTtlMs).toISOString(),
      effort: plan.effort,
      stages,
      criticalPathSeconds: sim.criticalPathSec,
      alternatives,
      dataPolicyKey: `gen.${engine}`,
    };
    if (range) est.windowDeltaRange = range;
    return est;
  }

  function alternative(plan: GenPlan, engine: EngineId, concurrency: number): GenEstimate["alternatives"][number] {
    const items = durations(plan, engine);
    const sim = simulateWith(items, engine, effectiveSlots(engine, concurrency));
    return {
      engine,
      concurrency: effectiveSlots(engine, concurrency),
      seconds: Math.round(sim.makespanSec),
      apiUsd: round6(items.reduce((n, x) => n + x.e.apiUsd, 0)),
    };
  }

  return {
    calibrationFactor,
    task,
    estimate,
    simulate: (plan, engine, concurrency) => simulateWith(durations(plan, engine), engine, effectiveSlots(engine, concurrency)),
  };
}
