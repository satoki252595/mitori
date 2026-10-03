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
  /** The Wilson bound that decided a rate (lower for `min`, upper for `max`). */
  bound?: number;
  /** Not a product measurement (the harness' own check). */
  synthetic?: boolean;
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

export function sloEntry(spec: SloSpec | string, sample: Sample, extra: { synthetic?: boolean } = {}): SloEntry {
  const s = typeof spec === "string" ? specOf(spec) : spec;
  const base = { id: s.id, target: s.target, limit: s.limit, unit: s.unit, ...(extra.synthetic ? { synthetic: true } : {}) };
  if ("successes" in sample) {
    if (s.unit !== "pct" && s.unit !== "ratio") throw new Error(`${s.id}: a rate needs a pct or ratio budget, got ${s.unit}`);
    const minN = s.minN ?? DEFAULT_MIN_N;
    const gate = (threshold: number) => judgeRate(sample, asFraction(s, threshold), { dir: s.dir, minN });
    const atLimit = gate(s.limit);
    const value = s.unit === "pct" ? (100 * sample.successes) / sample.n : sample.successes / sample.n;
    const out = { ...base, value, n: sample.n, bound: atLimit.bound };
    if (atLimit.status === "insufficient") return { ...out, status: "insufficient" };
    if (atLimit.status === "fail") return { ...out, status: "red" };
    return { ...out, status: gate(s.target).status === "pass" ? "green" : "yellow" };
  }
  const beyond = (bound: number) => (s.dir === "max" ? sample.value > bound : sample.value < bound);
  return { ...base, value: sample.value, status: beyond(s.limit) ? "red" : beyond(s.target) ? "yellow" : "green" };
}
