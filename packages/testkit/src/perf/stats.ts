// Sample statistics shared by `measure`, the bench runner and the compare gate (testing spec §6.2, §6.7).
import type { Samples } from "../contract.ts";

const sorted = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Median (mean of the two middle values for an even count). 0 for no samples. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = sorted(xs);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank percentile, `p` in (0, 100]. 0 for no samples. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = sorted(xs);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return s[rank - 1] as number;
}

/** Sample standard deviation (n − 1). 0 for fewer than two samples. */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Coefficient of variation: stdev / mean (0 when the mean is 0). */
export function cv(xs: readonly number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stdev(xs) / Math.abs(m);
}

/** Build a {@link Samples} from raw values. */
export function toSamples(id: string, unit: Samples["unit"], values: readonly number[]): Samples {
  return { id, unit, values: [...values], median: median(values), p95: percentile(values, 95), cv: cv(values) };
}
