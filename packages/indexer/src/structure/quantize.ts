/** Weights are quantized right after they are computed so that clustering is bit-stable across engines (spec §6.2). */
const SCALE = 2 ** 20;

export function q(x: number): number {
  return Math.round(x * SCALE) / SCALE;
}

/** ΔQ comparisons within this tolerance are ties (resolved by the deterministic order). */
export const TIE = 1e-12;
