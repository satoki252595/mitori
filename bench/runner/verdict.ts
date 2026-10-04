// Budget verdicts (testing spec §6.1, §6.8): green ≤ target, yellow ≤ limit, red beyond (mirrored for dir "min").
// Time budgets marked scale:"machine" are only gated on the reference machine; elsewhere they are scaled by the
// machine factor and reported. Structural, size and counter checks never depend on the machine.
import type { BudgetEntry, Samples } from "@mitori/testkit";

export type Level = "green" | "yellow" | "red";

/** |factor − 1| ≤ this ⇒ the run counts as the reference machine (§6.8). */
export const REFERENCE_TOLERANCE = 0.1;

export interface Verdict {
  id: string;
  level: Level;
  value: number;
  target: number;
  limit: number;
  unit: BudgetEntry["unit"];
  dir: BudgetEntry["dir"];
  /** Target and limit were multiplied by the machine factor. */
  scaled: boolean;
  /** A red level fails the run. False for machine-scaled budgets on a non-reference machine or on a loaded one. */
  gating: boolean;
  /**
   * Why a time budget did not gate although this is the reference machine: the run started under load
   * (`MachineInfo.noisy`, 1-minute load average above cores × 0.5 after the waits). Reported as "skipped", never a flake.
   */
  skipped?: string;
}

const TIME: Readonly<Record<string, number>> = { ms: 1, s: 1000 };
const SIZE: Readonly<Record<string, number>> = { B: 1, KB: 1000, MB: 1_000_000 };

/** Convert between units of the same family (ms↔s, B↔KB↔MB, decimal). Throws for incompatible units. */
export function convert(value: number, from: Samples["unit"], to: BudgetEntry["unit"]): number {
  if (from === to) return value;
  for (const fam of [TIME, SIZE]) {
    const f = fam[from];
    const t = fam[to];
    if (f !== undefined && t !== undefined) return (value * f) / t;
  }
  throw new Error(`cannot compare a ${from} sample with a ${to} budget`);
}

export const isReferenceMachine = (factor: number): boolean => Math.abs(factor - 1) <= REFERENCE_TOLERANCE;

export function judgeBudget(
  b: Pick<BudgetEntry, "id" | "target" | "limit" | "unit" | "dir" | "gates" | "scale">,
  value: number,
  machine: { factor: number; noisy?: boolean; loadavg?: number },
): Verdict {
  const machineScaled = b.scale === "machine";
  const reference = isReferenceMachine(machine.factor);
  const scaled = machineScaled && !reference;
  const k = scaled ? machine.factor : 1;
  const target = b.target * k;
  const limit = b.limit * k;
  const over = (bound: number) => (b.dir === "max" ? value > bound : value < bound);
  const level: Level = over(limit) ? "red" : over(target) ? "yellow" : "green";
  // a time budget is a machine statement; everything else (sizes, counts, ratios) is the same everywhere. On a loaded
  // machine a time sample says more about the other processes than about mitori: report it, skip the gate.
  const noisy = machineScaled && reference && machine.noisy === true;
  const gating = (!machineScaled || reference) && !noisy;
  return {
    id: b.id,
    level,
    value,
    target,
    limit,
    unit: b.unit,
    dir: b.dir,
    scaled,
    gating,
    ...(noisy ? { skipped: `machine under load (loadavg ${fmt(machine.loadavg ?? Number.NaN)})` } : {}),
  };
}

/** Number as it should read in a table: 3 significant digits for small values, no decimals for large. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 100) return n.toFixed(1);
  if (a >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

export const mark = (l: Level): string => (l === "green" ? "ok" : l === "yellow" ? "warn" : "FAIL");
