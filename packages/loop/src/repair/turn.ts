// One repair / revise turn (spec §6.6.3, R1 §6.1): the three paths in order —
//   continuation  the job's parked process (same conversation; the cheapest: only the REPAIR message is new),
//   resume        `--resume <sessionId>` of the original spawn (only with `engines.claude-cli.persistSessions`),
//   cold          a new process: the original bundle + the REPAIR message as two content blocks of one user turn.
// A path is skipped when it cannot work, and a path that fails BEFORE the engine produced anything (the parked
// process is gone, a resume the CLI refuses) falls through at once — never a wait for the turn timeout. A turn that
// did run (and was billed) is never repeated on another path.
import type { EngineResult, EngineRun, EngineSession, ScheduledRequest } from "@mitori/agent";
import type { JobId } from "@mitori/core";
import type { RunnerCore } from "../jobs/core.ts";
import { addUsage, consume, engineRequest } from "../jobs/engine.ts";
import type { JobPlan } from "../jobs/plan.ts";

/** Which path served a repair turn (job events + docs/progress/agent-mode.md). */
export type RepairPath = "continuation" | "resume" | "cold";

/** Output of {@link repairTurn}. */
export interface RepairTurnResult {
  /** The engine turn. */
  result: EngineResult;
  /** The live session to park for the next turn (null when the process is gone). */
  session: EngineSession | null;
  /** Path used. */
  path: RepairPath;
}

/** Input of {@link repairTurn}. */
export interface RepairTurnInput {
  core: RunnerCore;
  id: JobId;
  plan: JobPlan;
  /** The job's parked process, if any (taken out of the pool by the caller). */
  session: EngineSession | null;
  /** REPAIR / revise message (MBF/1 mode=repair). */
  message: string;
  /** Working directory of a cold / resumed spawn (the job worktree in agent mode, else the empty cwd). */
  cwd: string;
  /** Request shape of a fresh spawn for this plan (agent mode overrides budget / cwd). */
  request(prompt: { prompt?: string; promptBlocks?: string[]; resume?: string }): ScheduledRequest;
  signal: AbortSignal;
}

/** Remaining USD of a job's budget (spec §6.2.6: a repair turn gets "the rest of the job"). */
export function remainingUsd(core: RunnerCore, id: JobId, plan: JobPlan): number {
  const spent = core.get(id).job.usage?.apiUsd ?? 0;
  return Math.max(0, plan.budget.usd - spent);
}

/** True when a turn ended before the engine did anything: nothing was billed, nothing was produced. */
function nothingHappened(r: EngineResult): boolean {
  if (r.stop === "end") return false;
  const u = r.usage;
  const billed = u.in + u.out + u.cacheRead + u.cacheWrite > 0 || u.apiUsd > 0;
  const code = r.error?.code;
  return !billed && (code === "E_AGENT_EXIT" || code === "E_AGENT_TIMEOUT" || code === "E_AGENT_PROTOCOL" || code === "E_AGENT_NOT_INSTALLED");
}

async function record(core: RunnerCore, id: JobId, r: EngineResult, startedAt: number): Promise<void> {
  await core.update(
    id,
    "job.usage",
    (rec) => {
      rec.job.usage = addUsage(rec.job.usage, r.usage);
      if (r.sessionId) rec.job.sessionId = r.sessionId;
      const t = rec.job.timings ?? { modelMs: 0, wallMs: 0 };
      rec.job.timings = { modelMs: t.modelMs + r.durationMs, wallMs: t.wallMs + (core.deps.clock.now() - startedAt) };
    },
    { pipeline: true },
  );
}

async function turn(core: RunnerCore, id: JobId, run: EngineRun): Promise<EngineResult> {
  const began = core.deps.clock.now();
  const r = await consume(run, (e) => core.emit(id, e), { text: false });
  await record(core, id, r, began);
  return r;
}

/** Run one repair / revise turn on the best available path. */
export async function repairTurn(input: RepairTurnInput): Promise<RepairTurnResult> {
  const { core, id, plan, signal } = input;
  const usd = remainingUsd(core, id, plan);
  const budget = { usd, inTokens: Math.max(plan.budget.in * 2, 4000), outTokens: plan.budget.out, ms: 180_000 };
  // 1. continuation
  if (input.session?.parked()) {
    core.phase(id, "repair", "continuation");
    const run = core.deps.scheduler.continueSession(
      input.session,
      input.message,
      { lane: "interactive", ws: core.deps.ws.key, scope: { kind: "job", id }, estimate: { in: 0, out: plan.estimate.outTokens }, budget, ref: id },
      signal,
    );
    const result = await turn(core, id, run);
    if (!nothingHappened(result) || signal.aborted)
      return { result, session: run.session ?? (input.session.parked() ? input.session : null), path: "continuation" };
    core.deps.log.info("repair: the parked process is gone; trying the next path", { job: id, code: result.error?.code ?? "?" });
  } else if (input.session) {
    // gone while parked: close it (no-op when it already exited) and move on without waiting
    void input.session.close().catch(() => {});
  }
  // 2. resume (only when the original spawn persisted its session)
  const s = core.deps.settings().global.engines["claude-cli"];
  const sessionId = core.get(id).job.sessionId;
  if (s.persistSessions && sessionId && plan.route.engine === "claude-cli") {
    core.phase(id, "repair", "resume");
    const run = core.deps.scheduler.submit(input.request({ prompt: input.message, resume: sessionId }), signal);
    const result = await turn(core, id, run);
    if (!nothingHappened(result) || signal.aborted) return { result, session: run.session ?? null, path: "resume" };
    core.deps.log.info("repair: resume failed before any output; going cold", { job: id, code: result.error?.code ?? "?" });
  }
  // 3. cold: the original bundle + the REPAIR message (the job's current text is in the REPAIR CODE / the worktree)
  core.phase(id, "repair", "cold");
  const run = core.deps.scheduler.submit(input.request({ promptBlocks: [plan.bundle.text, input.message] }), signal);
  const result = await turn(core, id, run);
  return { result, session: run.session ?? null, path: "cold" };
}

/** The plan's fresh-spawn request with a repair prompt (patch / answer modes: the empty cwd). */
export function plainRequest(core: RunnerCore, id: JobId, plan: JobPlan) {
  return (p: { prompt?: string; promptBlocks?: string[]; resume?: string }): ScheduledRequest => {
    const s = core.deps.settings();
    const req = engineRequest(plan, id, {
      ws: core.deps.ws.key,
      cwd: `${core.deps.home}/run/empty`,
      deny: s.denyGlobs,
      persistSessions: s.global.engines["claude-cli"].persistSessions,
      ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
    });
    return withPrompt(req, p, remainingUsd(core, id, plan));
  };
}

/** Apply the prompt variant (blocks / resume) and the remaining budget to a request. */
export function withPrompt(req: ScheduledRequest, p: { prompt?: string; promptBlocks?: string[]; resume?: string }, usd: number): ScheduledRequest {
  const out: ScheduledRequest = { ...req, budget: { ...req.budget, usd: Math.max(0.0001, usd) } };
  if (p.promptBlocks !== undefined) {
    out.promptBlocks = p.promptBlocks;
    out.prompt = p.promptBlocks.join("\n");
  }
  if (p.resume !== undefined) {
    out.resume = p.resume;
    out.persistSession = true;
  }
  return out;
}
