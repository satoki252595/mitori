// `bin.startup` (budgets: `mitori --version` median of 20 runs, target 20 ms, limit 50 ms; hyperfine-style, WP-11a's gate). A time
// budget, so it only fails on the reference machine: the factor is measured lazily, only when the median is over the limit.
import { spawnSync } from "node:child_process";
import os from "node:os";
import { NOISY_RATIO } from "../runner/machine.ts";
import { median } from "../runner/stats.ts";
import { isReferenceMachine } from "../runner/verdict.ts";

export interface Startup {
  /** Wall time of each measured run, ms. */
  samples: number[];
  median: number;
}

/** `bin --version` `runs` times after one discarded run. Throws when the binary does not exit 0. */
export function measureStartup(bin: string, runs = 20): Startup {
  const once = (): number => {
    const t0 = performance.now();
    const r = spawnSync(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const ms = performance.now() - t0;
    if (r.status !== 0) throw new Error(`${bin} --version exited ${r.status}: ${String(r.stderr).trim()}`);
    return ms;
  };
  once();
  const samples = Array.from({ length: runs }, once);
  return { samples, median: median(samples) };
}

export interface StartupVerdict {
  median: number;
  target: number;
  limit: number;
  level: "green" | "yellow" | "red";
  /** Fails the run: over the limit on the reference machine, while it is not loaded. */
  hard: boolean;
  factor: number | null;
  /** Why an over-limit median did not fail the run although this is the reference machine (the bench runner's rule). */
  skipped?: string;
}

/**
 * `factor` is only called when the median is over the limit (a calibration costs about 2 s). `load` (1-minute load
 * average and cores, default: this machine's) — above cores × NOISY_RATIO the over-limit median is reported, not
 * failed: a spawn timed on a loaded machine measures the other processes (bench/runner/verdict.ts does the same).
 */
export function judgeStartup(
  startup: Startup,
  budget: { target: number; limit: number },
  factor: () => number,
  load: { loadavg: number; cores: number } = { loadavg: os.loadavg()[0] ?? 0, cores: os.cpus().length },
): StartupVerdict {
  const m = startup.median;
  if (m <= budget.limit) return { median: m, ...budget, level: m <= budget.target ? "green" : "yellow", hard: false, factor: null };
  const f = factor();
  const reference = isReferenceMachine(f);
  const loaded = load.loadavg > load.cores * NOISY_RATIO;
  return {
    median: m,
    ...budget,
    level: "red",
    hard: reference && !loaded,
    factor: f,
    ...(reference && loaded ? { skipped: `machine under load (loadavg ${load.loadavg.toFixed(1)} > ${load.cores} cores × ${NOISY_RATIO})` } : {}),
  };
}
