// One metered engine call: ask the budget, run, drain the events, ledger the result under `scope.kind = "eval"`, book the money.
import type { Engine, EngineResult } from "@mitori/agent";
import type { ModelId } from "@mitori/core";
import type { BudgetGuard } from "./budget.ts";
import { makeRequest } from "./engine.ts";
import type { EvalLedger } from "./ledger.ts";

export interface CallContext {
  engine: Engine;
  ledger: EvalLedger;
  guard: BudgetGuard;
  now: () => Date;
}

export interface CallInput {
  /** Ledger scope id (`eval` scope): which task made the call. */
  ref: string;
  prompt: string;
  system?: string;
  model?: ModelId;
  /** What the call is expected to cost; the guard refuses to start it when that would pass 95 % of the cap. */
  estimateUsd?: number;
}

export type CallOutcome = { status: "ok"; result: EngineResult } | { status: "skipped"; reason: string };

export async function callEngine(ctx: CallContext, call: CallInput): Promise<CallOutcome> {
  if (!ctx.guard.canStart(call.estimateUsd ?? 0)) return { status: "skipped", reason: "budget" };
  const req = makeRequest({
    ref: call.ref,
    prompt: call.prompt,
    ...(call.system ? { system: call.system } : {}),
    ...(call.model ? { model: call.model } : {}),
  });
  const run = ctx.engine.run(req, ctx.guard.signal);
  for await (const _event of run.events) {
    /* the harness only needs the result; events are drained so the engine can finish */
  }
  const result = await run.result;
  ctx.ledger.record({ ref: call.ref, engine: ctx.engine.id, model: req.model, promptId: req.promptVer, result, at: ctx.now().toISOString() });
  ctx.guard.add(result.usage.apiUsd);
  return { status: "ok", result };
}
