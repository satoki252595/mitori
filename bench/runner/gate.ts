// The absolute gate of a result file: budgets with an `absolute` or `structural` gate and the deterministic counters.
import type { Budgets } from "./budgets.ts";
import type { BenchResultFile } from "./result.ts";
import { convert, judgeBudget, type Verdict } from "./verdict.ts";

export interface CounterVerdict {
  id: string;
  value: number;
  max: number;
  ok: boolean;
}

export interface GateReport {
  verdicts: Verdict[];
  counters: CounterVerdict[];
  /** Cases that threw. */
  errors: { id: string; error: string }[];
  /** True when nothing gating failed. */
  ok: boolean;
}

export function gateResult(file: BenchResultFile, budgets: Budgets): GateReport {
  const verdicts: Verdict[] = [];
  const errors: GateReport["errors"] = [];
  for (const r of file.results) {
    if (r.error) {
      errors.push({ id: r.id, error: r.error });
      continue;
    }
    const b = budgets.budgets.get(r.id);
    const gated = b?.gates.some((g) => g === "absolute" || g === "structural");
    if (!b || !gated) continue;
    verdicts.push(judgeBudget(b, convert(r[r.budgetStat], r.unit, b.unit), file));
  }
  const counters: CounterVerdict[] = [];
  for (const c of file.counters) {
    const max = budgets.counters.get(c.id)?.max;
    if (max !== undefined) counters.push({ id: c.id, value: c.value, max, ok: c.value <= max });
  }
  const ok = errors.length === 0 && verdicts.every((v) => v.level !== "red" || !v.gating) && counters.every((c) => c.ok);
  return { verdicts, counters, errors, ok };
}
