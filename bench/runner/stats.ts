// Sample statistics for the bench runner and the compare gate. Mirrors packages/testkit/src/perf/stats.ts on purpose:
// testkit exports contract names only, and the bench zone may not reach into another package's files.
import type { Samples } from "@mitori/testkit";

export const sortedCopy = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

export const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = sortedCopy(xs);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank percentile, `p` in (0, 100]. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = sortedCopy(xs);
  return s[Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length))) - 1] as number;
}

/** Sample standard deviation (n − 1). */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** stdev / mean (0 when the mean is 0). */
export function cv(xs: readonly number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stdev(xs) / Math.abs(m);
}

export function toSamples(id: string, unit: Samples["unit"], values: readonly number[]): Samples {
  return { id, unit, values: [...values], median: median(values), p95: percentile(values, 95), cv: cv(values) };
}
