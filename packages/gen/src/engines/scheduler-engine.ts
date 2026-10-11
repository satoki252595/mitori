/**
 * `GenEngine` over the shared `AgentScheduler` (claude-cli / anthropic-api, gen spec §8.1). Text deltas come
 * unthrottled from `EngineRun.events` (gL-1); the terminal `result` event carries refusal / continuations;
 * `continueWith` sends the single retry to the parked process (continuation, §6.4), absent once it is gone.
 * The orchestrator falls back to it when `GenDeps.engines` lacks an engine (CR m1-1: internal, not a public factory).
 */
import type { AgentScheduler, EngineResult, EngineRun, EngineSession } from "@mitori/agent";
import { type Cancel, type EngineSettings, type GenEngineId, type JobEvent, MitoriError, type WorkspaceKey } from "@mitori/core";
import type { GenCall, GenCallResult, GenCallRun, GenEngine, GenEngineCaps } from "../contract.ts";
import { toScheduledRequest } from "./index.ts";

const CAPS: Readonly<Record<Exclude<GenEngineId, "session">, GenEngineCaps>> = {
  "claude-cli": { streaming: true, batch: false, countTokens: false, structuredOutputs: true, serverFallback: false, explicitCache: false },
  "anthropic-api": { streaming: true, batch: true, countTokens: true, structuredOutputs: true, serverFallback: true, explicitCache: true },
  generic: { streaming: true, batch: false, countTokens: false, structuredOutputs: false, serverFallback: false, explicitCache: false },
  "codex-cli": { streaming: true, batch: false, countTokens: false, structuredOutputs: true, serverFallback: false, explicitCache: false },
};

/** Wrap one scheduler turn as a GenCallRun. */
function wrap(run: EngineRun, onContinue: ((retry: string, signal: Cancel, session: EngineSession) => EngineRun) | null): GenCallRun {
  let resultEvent: Extract<JobEvent, { t: "result" }> | null = null;
  let collected = "";
  let consumed: Promise<void> | null = null;
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  const pump = async () => {
    for await (const ev of run.events) {
      if (ev.t === "text") {
        collected += ev.delta;
        queue.push(ev.delta);
        wake?.();
      } else if (ev.t === "result") resultEvent = ev;
    }
    finished = true;
    wake?.();
  };
  const start = () => {
    consumed ??= pump();
    return consumed;
  };
  const text: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      void start();
      while (true) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (finished) return;
        await new Promise<void>((r) => {
          wake = r;
        });
        wake = null;
      }
    },
  };
  const result = (async (): Promise<GenCallResult> => {
    await start();
    const r: EngineResult = await run.result;
    const out: GenCallResult = {
      stop: r.stop,
      text: r.text ?? collected,
      usage: r.usage,
      refusal: (resultEvent as Extract<JobEvent, { t: "result" }> | null)?.refusal ?? null,
      durationMs: r.durationMs,
      auth: r.auth,
    };
    const ev = resultEvent as Extract<JobEvent, { t: "result" }> | null;
    if (ev?.continuations) out.continuations = ev.continuations;
    if (r.window) out.window = r.window;
    if (r.ttftMs !== undefined) out.ttftMs = r.ttftMs;
    if (r.error) out.error = { code: r.error.code, message: r.error.message, retryable: r.error.retryable };
    return out;
  })();
  // `run.session` appears only once the scheduler dispatched the job and the engine spawned its process: read it
  // when it is needed, never at wrap time (a captured `undefined` left every process parked until its TTL and made
  // every retry cold) [dogfood 2026-10-04]
  const genRun: GenCallRun = {
    text,
    result,
    stop: (reason) => run.stop(reason),
    close: async () => {
      await run.session?.close();
    },
  };
  if (onContinue) {
    const continueWith = (retry: string, signal: Cancel): GenCallRun => {
      const session = run.session;
      if (!session?.parked()) throw new MitoriError("E_AGENT_EXIT", "the parked process is gone");
      return wrap(onContinue(retry, signal, session), onContinue);
    };
    // present only while the process is parked (contract: absent once it is gone ⇒ cold retry)
    Object.defineProperty(genRun, "continueWith", { get: () => (run.session?.parked() ? continueWith : undefined), enumerable: true });
  }
  return genRun;
}

/** Factory. */
export function createSchedulerEngine(
  id: Exclude<GenEngineId, "session">,
  scheduler: AgentScheduler,
  ctx: { ws: WorkspaceKey; sandboxCwd: string; codex?: EngineSettings["codex-cli"] },
): GenEngine {
  return {
    id,
    caps: CAPS[id],
    run(call: GenCall, signal: Cancel): GenCallRun {
      const req = toScheduledRequest(call, { ...ctx, engine: id });
      const run = scheduler.submit(req, signal);
      if (id === "generic" || id === "codex-cli") return wrap(run, null);
      return wrap(run, (retry, sig, session) =>
        scheduler.continueSession(
          session,
          retry,
          { lane: req.lane, ws: req.ws, scope: req.scope, estimate: req.estimate, budget: req.budget, ref: req.ref },
          sig,
        ),
      );
    },
  };
}
