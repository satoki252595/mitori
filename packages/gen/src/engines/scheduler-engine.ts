/**
 * `GenEngine` over the shared `AgentScheduler` (claude-cli / anthropic-api, gen spec §8.1). Text deltas come
 * unthrottled from `EngineRun.events` (gL-1); the terminal `result` event carries refusal / continuations;
 * `continueWith` sends the single retry to the parked process (continuation, §6.4), absent once it is gone.
 * CR-PENDING(WP-06): the contract has no public factory for this adapter (cr-requests/WP-06.md R3); the
 * orchestrator falls back to it when `GenDeps.engines` lacks an engine.
 */
import type { AgentScheduler, EngineResult, EngineRun, EngineSession } from "@mitori/agent";
import type { Cancel, ErrorCode, JobEvent, WorkspaceKey } from "@mitori/core";
import type { GenCall, GenCallResult, GenCallRun, GenEngine, GenEngineCaps } from "../contract.ts";
import { toScheduledRequest } from "./index.ts";

/** Result fields the contract's `GenCallResult` lacks (CR-PENDING(WP-06) R4: `continuations`, `error`). */
export interface GenCallResultExt extends GenCallResult {
  /** CLI-internal continuations inside the turn (PT-09): the reply was cut, no mitori retry is added. */
  continuations?: number;
  /** Engine error when `stop` is `error` / `budget`. */
  error?: { code: ErrorCode; message: string; retryable: boolean };
}

const CAPS: Readonly<Record<"claude-cli" | "anthropic-api", GenEngineCaps>> = {
  "claude-cli": { streaming: true, batch: false, countTokens: false, structuredOutputs: true, serverFallback: false, explicitCache: false },
  "anthropic-api": { streaming: true, batch: true, countTokens: true, structuredOutputs: true, serverFallback: true, explicitCache: true },
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
  const result = (async (): Promise<GenCallResultExt> => {
    await start();
    const r: EngineResult = await run.result;
    const out: GenCallResultExt = {
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
  const session = run.session;
  const genRun: GenCallRun = {
    text,
    result,
    stop: (reason) => run.stop(reason),
    close: async () => {
      await session?.close();
    },
  };
  if (session && onContinue) {
    genRun.continueWith = (retry, signal) => {
      if (!session.parked()) throw new Error("parked process is gone");
      return wrap(onContinue(retry, signal, session), onContinue);
    };
  }
  return genRun;
}

/** Factory. */
export function createSchedulerEngine(id: "claude-cli" | "anthropic-api", scheduler: AgentScheduler, ctx: { ws: WorkspaceKey; sandboxCwd: string }): GenEngine {
  return {
    id,
    caps: CAPS[id],
    run(call: GenCall, signal: Cancel): GenCallRun {
      const req = toScheduledRequest(call, { ws: ctx.ws, sandboxCwd: ctx.sandboxCwd, engine: id });
      const run = scheduler.submit(req, signal);
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
