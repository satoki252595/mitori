/** ceil() that ignores floating-point noise (2300 / 2.3 is 1000.0000000000001) and never returns -0. */
export function ceilTokens(raw: number): number {
  return Math.max(0, Math.ceil(raw - 1e-9));
}
