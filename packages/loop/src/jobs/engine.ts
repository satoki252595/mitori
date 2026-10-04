// Engine calls of loop jobs (spec §6.2 / §8): the scheduled request of a plan (the bridge enforces the CLI
// invariants), the parking of patch processes for revise / invalid-output continuations, and folding a turn's
// normalized events into the job's event log.
import { type EngineResult, type EngineRun, type EngineSession, LOOP_PROMPTS, type LoopPromptId, type ScheduledRequest, WARM_POOL } from "@mitori/agent";
import type { JobEvent, JobId, Usage } from "@mitori/core";
import { AGENT_V1_ENGINE_SCHEMA, FINDINGS_V1_ENGINE_SCHEMA, PATCH_V1_ENGINE_SCHEMA } from "../contract.ts";
import { loopSystemPrompt } from "../prompts/index.ts";
import type { JobPlan } from "./plan.ts";

/** Prompt id of a plan's mode. */
export function promptIdOf(plan: Pick<JobPlan, "mode">): LoopPromptId {
  return plan.mode === "patch" ? "loop.patch" : plan.mode === "agent" ? "loop.agent" : plan.mode === "findings" ? "loop.findings" : "loop.answer";
}

const SCHEMAS: Partial<Record<LoopPromptId, object>> = {
  "loop.patch": PATCH_V1_ENGINE_SCHEMA,
  "loop.findings": FINDINGS_V1_ENGINE_SCHEMA,
  "loop.agent": AGENT_V1_ENGINE_SCHEMA,
};
/** Wall-time budget of one turn per mode [仮]. */
const TURN_MS: Record<LoopPromptId, number> = { "loop.answer": 120_000, "loop.findings": 180_000, "loop.patch": 180_000, "loop.agent": 600_000 };

const enc = new TextEncoder();
/** Conservative token count of fixed text (≈ 3 bytes per token; Japanese and code both stay under it). */
const textTokens = (s: string) => Math.ceil(enc.encode(s).length / 3);

/**
 * The input-token meter limit of a first turn (cr-requests/agent.md #9): twice the planned input (bundle + the engine's
 * fixed part, floor 4k) PLUS the system prompt and the JSON schema mitori sends with it. The system prompt grows with
 * the deny globs; it was not counted, so a small Fix of a repo with a long deny list hit the 4k floor before answering.
 */
export function firstTurnInTokens(plan: Pick<JobPlan, "budget">, system: string, schema: object | undefined): number {
  return Math.max(plan.budget.in * 2, 4000) + textTokens(system) + (schema ? textTokens(JSON.stringify(schema)) : 0);
}

/** The scheduled request of a plan. */
export function engineRequest(
  plan: JobPlan,
  job: JobId,
  ctx: { ws: string; cwd: string; deny: readonly string[]; persistSessions: boolean; prompt?: string },
): ScheduledRequest {
  const id = promptIdOf(plan);
  const keepAlive = id === "loop.patch" || id === "loop.agent";
  const schema = SCHEMAS[id];
  const system = loopSystemPrompt(id, { cwd: ctx.cwd, deny: ctx.deny });
  const sendsSchema = schema !== undefined && plan.route.engine !== "generic";
  const req: ScheduledRequest = {
    ref: job,
    mode: plan.mode === "patch" ? "patch" : plan.mode === "agent" ? "agent" : plan.mode === "findings" ? "findings" : "answer",
    cwd: ctx.cwd,
    model: plan.route.decision.model,
    effort: plan.route.decision.effort,
    tools: plan.route.decision.tools,
    writeScope: plan.mode === "agent" ? plan.scope.writeScope : [],
    system,
    promptVer: LOOP_PROMPTS[id].version,
    prompt: ctx.prompt ?? plan.bundle.text,
    contract: plan.route.decision.contract,
    keepAlive,
    persistSession: ctx.persistSessions,
    budget: { usd: plan.budget.usd, inTokens: firstTurnInTokens(plan, system, sendsSchema ? schema : undefined), outTokens: plan.budget.out, ms: TURN_MS[id] },
    engine: plan.route.engine,
    lane: "interactive",
    ws: ctx.ws as ScheduledRequest["ws"],
    scope: { kind: "job", id: job },
    estimate: { in: plan.estimate.inTokens, out: plan.estimate.outTokens },
  };
  if (sendsSchema) req.jsonSchema = schema;
  if (plan.scope.newFiles.length > 0 && plan.mode === "agent") req.newFiles = plan.scope.newFiles;
  return req;
}

/** Sum of two usages (attempts of one job). */
export function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return { ...b };
  const out: Usage = {
    in: a.in + b.in,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
    out: a.out + b.out,
    apiUsd: Math.round((a.apiUsd + b.apiUsd) * 1e6) / 1e6,
    pricingVer: b.pricingVer,
  };
  if (a.thinking !== undefined || b.thinking !== undefined) out.thinking = (a.thinking ?? 0) + (b.thinking ?? 0);
  if (a.reportedUsd !== undefined || b.reportedUsd !== undefined) out.reportedUsd = (a.reportedUsd ?? 0) + (b.reportedUsd ?? 0);
  return out;
}

/** Forward a turn's events (text deltas only when `text`), then its result. Never throws. */
export async function consume(run: EngineRun, emit: (e: JobEvent) => void, opts: { text: boolean }): Promise<EngineResult> {
  const pump = (async () => {
    try {
      for await (const e of run.events) {
        if (e.t === "text" && !opts.text) continue;
        if (e.t === "usage" && !e.final) continue;
        emit(e);
      }
    } catch {
      // the result carries the error
    }
  })();
  const result = await run.result;
  await Promise.race([pump, new Promise((r) => setTimeout(r, 50))]);
  return result;
}

/** Parked engine processes of this runner (revise / invalid-output continuations; spec §6.6.2). */
export class Parking {
  private readonly parked = new Map<JobId, { session: EngineSession; timer: ReturnType<typeof setTimeout> }>();

  /** Keep `session` for `job` (TTL; at most `WARM_POOL.maxParked`, the oldest closed first). */
  park(job: JobId, session: EngineSession | undefined): void {
    if (!session) return;
    this.release(job);
    while (this.parked.size >= WARM_POOL.maxParked) {
      const oldest = this.parked.keys().next().value as JobId;
      this.release(oldest);
    }
    const timer = setTimeout(() => this.release(job), WARM_POOL.parkTtlMs);
    (timer as { unref?: () => void }).unref?.();
    this.parked.set(job, { session, timer });
  }

  /** The live parked session of a job (taken out of the pool). */
  take(job: JobId): EngineSession | null {
    const p = this.parked.get(job);
    if (!p) return null;
    clearTimeout(p.timer);
    this.parked.delete(job);
    return p.session.parked() ? p.session : null;
  }

  /** Close a job's parked process. */
  release(job: JobId): void {
    const p = this.parked.get(job);
    if (!p) return;
    clearTimeout(p.timer);
    this.parked.delete(job);
    void p.session.close().catch(() => {});
  }

  /** Close everything (shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.parked.values()];
    this.parked.clear();
    for (const p of all) clearTimeout(p.timer);
    await Promise.all(all.map((p) => p.session.close().catch(() => {})));
  }
}
