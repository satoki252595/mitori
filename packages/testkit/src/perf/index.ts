/**
 * @mitori/testkit — `perf/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (stats.ts, budgets.ts, calib.ts).
 */
import { readFileSync } from "node:fs";
import type { BudgetEntry, Samples } from "../contract.ts";
import { BENCH_ROOT, findBudget } from "./budgets.ts";
import { calibrate } from "./calib.ts";
import { toSamples } from "./stats.ts";

const MICRO_MIN_TOTAL_MS = 1000;
const MICRO_MAX_RUNS = 5000;

/**
 * Time `fn` (sync or async) and summarise the samples (ms by default). `warmup` runs (default 3) are discarded.
 * Without an explicit `runs` the case runs 15 times and keeps going until the measured total reaches 1 s, so micro
 * cases get enough samples (testing spec §6.2). Cases whose sample is not the wall time of the call (RSS, bytes)
 * use the bench runner's value-returning `defineBench` instead.
 */
export async function measure(id: string, fn: () => unknown, opts?: { runs?: number; warmup?: number; unit?: Samples["unit"] }): Promise<Samples> {
  const warmup = opts?.warmup ?? 3;
  const wanted = opts?.runs ?? 15;
  for (let i = 0; i < warmup; i++) await fn();
  const values: number[] = [];
  let total = 0;
  while (values.length < wanted || (opts?.runs === undefined && total < MICRO_MIN_TOTAL_MS && values.length < MICRO_MAX_RUNS)) {
    const t0 = performance.now();
    await fn();
    const ms = performance.now() - t0;
    values.push(ms);
    total += ms;
  }
  return toSamples(id, opts?.unit ?? "ms", values);
}

/** Peak RSS (MB, decimal) of the current process sampled every 10 ms while `fn` runs. */
export async function rssPeak<T>(fn: () => Promise<T>): Promise<{ value: T; peakMb: number }> {
  let peak = process.memoryUsage.rss();
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 10);
  try {
    const value = await fn();
    peak = Math.max(peak, process.memoryUsage.rss());
    return { value, peakMb: peak / 1e6 };
  } finally {
    clearInterval(timer);
  }
}

const FACTOR_MIN = 0.5;
const FACTOR_MAX = 5;
let factor: Promise<number> | null = null;

/** Where the reference machine's calibration is recorded (`bench/runner/run.ts --record-reference` writes it). */
const REFERENCE_FILE = `${BENCH_ROOT}bench/runner/reference.json`;

/** runner time / reference time of the calibration workload, clamped to [0.5, 5]. 1 when no reference is recorded. */
export function machineFactor(): Promise<number> {
  factor ??= (async () => {
    let refMs: number | undefined;
    try {
      refMs = (JSON.parse(readFileSync(REFERENCE_FILE, "utf8")) as { calib?: { totalMs?: number } }).calib?.totalMs;
    } catch {
      return 1;
    }
    if (!refMs || refMs <= 0) return 1;
    const here = await calibrate();
    return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, here.totalMs / refMs));
  })();
  return factor;
}

/** The `bench/budgets.json` entry with this id (throws `E_NOT_FOUND` for unknown ids). */
export function budget(id: string): BudgetEntry {
  return findBudget(id);
}
