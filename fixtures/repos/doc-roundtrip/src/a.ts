// Cite target of the citation documents (lines 1-3, 5, 10-20, 22 are referenced).
export const MAX_RETRIES = 1;
export const VERSION = '0.4.2';

export const PORT = 8787;

const rows: number[] = [];

/** Round a price half up to a whole number of minor units. */
export function round(price: number): number {
  // the digit after the unit decides
  const whole = Math.floor(price);
  const frac = price - whole;
  if (frac >= 0.5) return whole + 1;
  return whole;
}

export function push(n: number): void {
  rows.push(n);
}

export const LIMIT = 3;
