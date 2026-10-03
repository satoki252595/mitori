// `bin.startup` (budgets: `mitori --version` median of 20 runs, target 20 ms, limit 50 ms; hyperfine-style, WP-11a's gate). A time
// budget, so it only fails on the reference machine: the factor is measured lazily, only when the median is over the limit.
import { spawnSync } from "node:child_process";
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
  /** Fails the run: over the limit on the reference machine. */
  hard: boolean;
  factor: number | null;
}

/** `factor` is only called when the median is over the limit (a calibration costs about 2 s). */
export function judgeStartup(startup: Startup, budget: { target: number; limit: number }, factor: () => number): StartupVerdict {
  const m = startup.median;
  if (m <= budget.limit) return { median: m, ...budget, level: m <= budget.target ? "green" : "yellow", hard: false, factor: null };
  const f = factor();
  return { median: m, ...budget, level: "red", hard: isReferenceMachine(f), factor: f };
}
