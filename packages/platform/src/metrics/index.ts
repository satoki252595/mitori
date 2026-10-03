/**
 * @mitori/platform — `metrics/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { MetricName, Metrics } from "@mitori/core";

/** The default {@link Metrics}: records nothing (production without `/__test/metrics` or `mitori doctor`). */
export const noopMetrics: Metrics = { inc() {}, observe() {} };

/** Aggregate of the duration samples of one metric. */
export interface TimerStats {
  /** Samples. */
  n: number;
  /** Sum (ms). */
  sum: number;
  /** Smallest sample (ms). */
  min: number;
  /** Largest sample (ms). */
  max: number;
}

/** Point-in-time copy of a {@link RecordingMetrics}. Keys appear only once touched (stable, sorted). */
export interface MetricsSnapshot {
  /** Counters. */
  counters: Partial<Record<MetricName, number>>;
  /** Timers. */
  timers: Partial<Record<MetricName, TimerStats>>;
}

/** {@link Metrics} that keeps counters and timer aggregates in memory (perf goldens, `/__test/metrics`, doctor). */
export interface RecordingMetrics extends Metrics {
  /** Copy of the current values. */
  snapshot(): MetricsSnapshot;
  /** Forget everything. */
  reset(): void;
}

/** In-memory recording metrics (deterministic: no clock, no sampling). */
export function createMetrics(): RecordingMetrics {
  const counters = new Map<MetricName, number>();
  const timers = new Map<MetricName, TimerStats>();
  return {
    inc(name, n = 1) {
      counters.set(name, (counters.get(name) ?? 0) + n);
    },
    observe(name, ms) {
      const t = timers.get(name);
      if (t) {
        t.n++;
        t.sum += ms;
        t.min = Math.min(t.min, ms);
        t.max = Math.max(t.max, ms);
      } else timers.set(name, { n: 1, sum: ms, min: ms, max: ms });
    },
    snapshot() {
      const sorted = <V>(m: Map<MetricName, V>, copy: (v: V) => V) =>
        Object.fromEntries([...m.keys()].sort().map((k) => [k, copy(m.get(k) as V)])) as Partial<Record<MetricName, V>>;
      return { counters: sorted(counters, (v) => v), timers: sorted(timers, (v) => ({ ...v })) };
    },
    reset() {
      counters.clear();
      timers.clear();
    },
  };
}
