// The head-vs-base verdict of one metric (testing spec §6.7, ARCHITECTURE §10.1): a ≥ 20 % slowdown that is also above a
// noise floor is a regression; a spread (cv) above 25 % on either side only earns a warning.
import type { Samples } from "@mitori/testkit";
import { cv, median } from "../runner/stats.ts";

export const REGRESSION_RATIO = 0.2;
export const NOISE_CV = 0.25;

export type Status = "ok" | "improved" | "regressed" | "noisy";

export interface Judgement {
  status: Status;
  /** median(base), median(head). */
  mB: number;
  mH: number;
  /** (mH − mB) / mB; 0 when mB is 0. */
  delta: number;
  cvB: number;
  cvH: number;
  /** Smallest absolute difference that counts. */
  floor: number;
}

/** ms: max(2 ms, 5 % of base); MB: 5 MB; s: 0.1 s; other units have no floor. */
export function floorFor(unit: Samples["unit"], mB: number): number {
  switch (unit) {
    case "ms":
      return Math.max(2, 0.05 * mB);
    case "MB":
      return 5;
    case "s":
      return 0.1;
    default:
      return 0;
  }
}

export function judge(base: readonly number[], head: readonly number[], unit: Samples["unit"]): Judgement {
  const mB = median(base);
  const mH = median(head);
  const cvB = cv(base);
  const cvH = cv(head);
  const floor = floorFor(unit, mB);
  const diff = mH - mB;
  const delta = mB === 0 ? 0 : diff / mB;
  let status: Status = "ok";
  if (cvB > NOISE_CV || cvH > NOISE_CV) status = "noisy";
  else if (delta > REGRESSION_RATIO && diff > floor) status = "regressed";
  else if (delta < -REGRESSION_RATIO) status = "improved";
  return { status, mB, mH, delta, cvB, cvH, floor };
}
