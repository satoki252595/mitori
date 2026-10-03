// The eval harness' own calls are ledgered apart from product usage: `scope.kind = "eval"` (CR test-3), so `mitori usage --scope eval`
// shows what the evaluation cost and the product's numbers stay clean.

import type { EngineResult } from "@mitori/agent";
import { type EngineId, type Iso8601, type ModelId, newId, type Random, type UsageRecord } from "@mitori/core";

export interface EvalLedger {
  readonly rows: readonly UsageRecord[];
  /** Record one finished engine call under `eval:<ref>`. */
  record(call: { ref: string; engine: EngineId; model: ModelId; promptId?: string; result: EngineResult; at: Iso8601 }): UsageRecord;
  /** Σ API-equivalent USD. */
  spentUsd(): number;
}

export function createEvalLedger(random: Random): EvalLedger {
  const rows: UsageRecord[] = [];
  return {
    rows,
    record({ ref, engine, model, promptId, result, at }) {
      const row: UsageRecord = {
        id: newId("usage", random),
        at,
        ws: null,
        scope: { kind: "eval", id: ref },
        engine,
        model,
        ...(promptId ? { promptId } : {}),
        auth: result.auth,
        usage: result.usage,
        durationMs: result.durationMs,
        ...(result.ttftMs !== undefined ? { ttftMs: result.ttftMs } : {}),
        ...(result.window ? { window: result.window } : {}),
        outcome: result.stop === "end" ? "ok" : result.stop === "cancelled" ? "cancelled" : result.stop === "budget" ? "budget" : "error",
      };
      rows.push(row);
      return row;
    },
    spentUsd: () => rows.reduce((s, r) => s + r.usage.apiUsd, 0),
  };
}
