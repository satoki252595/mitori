import { CALIBRATION, type EmaState } from "./domain.ts";
import { MitoriError } from "./errors.ts";

/**
 * Pure EMA update: `value' = clamp((1−α)·value + α·sample)`; first sample initializes [CR idx-7].
 * `mad' = (1−α)·mad + α·|sample − value| / value` (relative deviation from the value before the update).
 */
export function emaUpdate(prev: EmaState | null, sample: number, clamp: readonly [number, number], alpha: number = CALIBRATION.alpha): EmaState {
  const [lo, hi] = clamp;
  if (!Number.isFinite(sample) || sample <= 0) throw new MitoriError("E_INVALID_INPUT", `emaUpdate: sample must be a positive ratio, got ${sample}`);
  if (!(lo > 0 && lo <= hi)) throw new MitoriError("E_INVALID_INPUT", `emaUpdate: bad clamp [${lo}, ${hi}]`);
  if (!(alpha > 0 && alpha <= 1)) throw new MitoriError("E_INVALID_INPUT", `emaUpdate: alpha must be in (0, 1], got ${alpha}`);
  const fit = (x: number) => Math.min(hi, Math.max(lo, x));
  if (prev === null || prev.n === 0) return { value: fit(sample), n: 1, mad: 0 };
  const dev = Math.abs(sample - prev.value) / prev.value;
  return { value: fit((1 - alpha) * prev.value + alpha * sample), n: prev.n + 1, mad: (1 - alpha) * prev.mad + alpha * dev };
}
