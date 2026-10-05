// SLO rows of the eval report (testing spec §7.7 `slo[]`): a measured value against a budget's target and limit. Rates measured on
// few trials are judged by the Wilson bound (stats.ts), scalars (token counts, $) directly.
import { type BudgetEntry, budget } from "@mitori/testkit";
import { DEFAULT_MIN_N, judgeRate } from "./stats.ts";

export type SloStatus = "green" | "yellow" | "red" | "insufficient";

export interface SloEntry {
  id: string;
  value: number;
  target: number;
  limit: number;
  unit: string;
  status: SloStatus;
  /** Sample size, for rates. */
  n?: number;
  /** The Wilson bound that decided a rate (lower for `min`, upper for `max`), in the budget's unit (pct: 0–100). */
  bound?: number;
  /** Not a product measurement (the harness' own check). */
  synthetic?: boolean;
  /** An estimated product measurement (distinct from a synthetic harness check). */
  estimated?: boolean;
  /** Report / corpus label when the same budget is applied to several inputs. */
  context?: string;
}

export interface SloSpec {
  id: string;
  target: number;
  limit: number;
  unit: BudgetEntry["unit"];
  dir: "min" | "max";
  minN?: number;
}

export type Sample = { value: number } | { successes: number; n: number };

/** The spec of a budget id (throws for an unknown id: a typo must not silently pass). */
export function specOf(id: string): SloSpec {
  const b = budget(id) as BudgetEntry & { minN?: number };
  return { id, target: b.target, limit: b.limit, unit: b.unit, dir: b.dir, ...(b.minN !== undefined ? { minN: b.minN } : {}) };
}

/** Percent budgets hold 0–100, ratio budgets 0–1; the Wilson maths wants a fraction. */
const asFraction = (spec: SloSpec, x: number): number => (spec.unit === "pct" ? x / 100 : x);

/**
 * A rate is red when its Wilson bound misses the budget's **limit itself**. SC-14's "Wilson 下限 ≥ 閾値 − 10pp" has the pass
 * threshold (the target) as 閾値, and the budgets of the n = 30 rates already sit their limit 10 pp under the target
 * (quality.patch.gateFirst 70 / 60: MILESTONES M3 "Wilson 下限 ≥ 60%"); subtracting the margin from the limit again would
 * let 22 of 30 through a gate that `judgeRate(…, 0.7)` fails. Large populations (citations) make the bound the point
 * estimate. Green / yellow is the point estimate against the target (targets are a trend, MILESTONES §8.7).
 */
export function sloEntry(spec: SloSpec | string, sample: Sample, extra: { synthetic?: boolean } = {}): SloEntry {
  const s = typeof spec === "string" ? specOf(spec) : spec;
  const base = { id: s.id, target: s.target, limit: s.limit, unit: s.unit, ...(extra.synthetic ? { synthetic: true } : {}) };
  const beyond = (value: number, bound: number) => (s.dir === "max" ? value > bound : value < bound);
  if ("successes" in sample) {
    if (s.unit !== "pct" && s.unit !== "ratio") throw new Error(`${s.id}: a rate needs a pct or ratio budget, got ${s.unit}`);
    const minN = s.minN ?? DEFAULT_MIN_N;
    const atLimit = judgeRate(sample, asFraction(s, s.limit), { dir: s.dir, minN, margin: 0 });
    const value = s.unit === "pct" ? (100 * sample.successes) / sample.n : sample.successes / sample.n;
    const out = { ...base, value, n: sample.n, bound: s.unit === "pct" ? 100 * atLimit.bound : atLimit.bound };
    if (atLimit.status === "insufficient") return { ...out, status: "insufficient" };
    if (atLimit.status === "fail") return { ...out, status: "red" };
    return { ...out, status: beyond(value, s.target) ? "yellow" : "green" };
  }
  return { ...base, value: sample.value, status: beyond(sample.value, s.limit) ? "red" : beyond(sample.value, s.target) ? "yellow" : "green" };
}
