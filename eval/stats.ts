// Statistical gates of the eval harness (testing spec §7.4, MILESTONES §8.8, SC-14).
// A pass/fail rate measured on 30 tasks is too noisy to compare with its threshold directly: a true 75 % fails a 70 %
// threshold about one run in five. The gate is therefore the Wilson bound of the observed rate, taken against the threshold
// minus a 10 pp margin, or the same bound over two runs pooled.
//
// z: the bound is one-sided (does the data rule out a true rate below threshold − 10 pp?), so z = Φ⁻¹(0.95) = 1.645, not
// the two-sided 1.96. With 1.96 the acceptance example of MILESTONES WP-12 (n = 30, p = 0.75, threshold 0.70 passes) would
// fail: its lower bound is 0.573 against a 0.60 gate; with 1.645 it is 0.603.

/** Φ⁻¹(0.95). */
export const Z_ONE_SIDED_95 = 1.6448536269514722;
/** The slack granted below the threshold (10 pp). */
export const GATE_MARGIN = 0.1;
/** The default smallest sample for a probabilistic gate (n = 30); budgets override it with `minN`. */
export const DEFAULT_MIN_N = 30;

function check(p: number, n: number): void {
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError(`n must be a positive number, got ${n}`);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`rate must be in [0, 1], got ${p}`);
}

/** Wilson score interval bounds `[lower, upper]` for an observed rate `p` over `n` trials. */
export function wilson(p: number, n: number, z = Z_ONE_SIDED_95): { lower: number; upper: number } {
  check(p, n);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // at p = 0 / 1 the formula leaves ~1e-17 of rounding noise: the true bound is exactly 0 / 1
  return { lower: p === 0 ? 0 : Math.max(0, (center - margin) / denom), upper: p === 1 ? 1 : Math.min(1, (center + margin) / denom) };
}

export const wilsonLower = (p: number, n: number, z = Z_ONE_SIDED_95): number => wilson(p, n, z).lower;
export const wilsonUpper = (p: number, n: number, z = Z_ONE_SIDED_95): number => wilson(p, n, z).upper;

/** A batch of Bernoulli outcomes. */
export interface RateRun {
  successes: number;
  n: number;
}

export type GateStatus = "pass" | "fail" | "insufficient";

export interface RateVerdict {
  status: GateStatus;
  /** Pooled observed rate. */
  p: number;
  /** Pooled sample size. */
  n: number;
  /** The Wilson bound that was compared (lower for `min`, upper for `max`). */
  bound: number;
  /** What the bound had to reach: threshold − margin (`min`) or threshold + margin (`max`). */
  required: number;
  threshold: number;
  minN: number;
  /** Number of runs that were pooled. */
  runs: number;
}

export interface GateOptions {
  /** `min`: the rate must be at least `threshold` (pass rates); `max`: at most (hallucination rates). Default `min`. */
  dir?: "min" | "max";
  margin?: number;
  /** Smallest pooled n that may be judged at all (default 30). */
  minN?: number;
  z?: number;
}

/**
 * Judge a rate against a threshold. `runs` may be one run (n = 30) or several (pooled — "2 runs combined"). Below `minN`
 * observations the answer is `insufficient`, never `pass`: a small lucky sample must not open the gate.
 */
export function judgeRate(runs: RateRun | readonly RateRun[], threshold: number, opts: GateOptions = {}): RateVerdict {
  const list: readonly RateRun[] = Array.isArray(runs) ? (runs as readonly RateRun[]) : [runs as RateRun];
  const dir = opts.dir ?? "min";
  const margin = opts.margin ?? GATE_MARGIN;
  const minN = opts.minN ?? DEFAULT_MIN_N;
  const successes = list.reduce((s, r) => s + r.successes, 0);
  const n = list.reduce((s, r) => s + r.n, 0);
  for (const r of list) if (!(r.successes >= 0 && r.successes <= r.n)) throw new RangeError(`successes ${r.successes} outside [0, ${r.n}]`);
  const base = { threshold, minN, runs: list.length, n };
  if (n === 0)
    return { ...base, status: "insufficient", p: 0, bound: dir === "min" ? 0 : 1, required: dir === "min" ? threshold - margin : threshold + margin };
  const p = successes / n;
  const { lower, upper } = wilson(p, n, opts.z);
  const bound = dir === "min" ? lower : upper;
  const required = dir === "min" ? threshold - margin : threshold + margin;
  const ok = dir === "min" ? bound >= required : bound <= required;
  return { ...base, status: n < minN ? "insufficient" : ok ? "pass" : "fail", p, bound, required };
}

/* ---------------------------------------------------------------- reproducible randomness */

/** Seed of every shuffle, sample and bootstrap of an eval run (testing spec §7.1). */
export const EVAL_SEED = 20261003;

/** mulberry32 → floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy; the same seed always gives the same order (quiz order, judge samples). */
export function seededShuffle<T>(xs: readonly T[], seed = EVAL_SEED): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
