/**
 * @mitori/testkit — `perf/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { BudgetEntry, Samples } from "../contract.ts";

export function measure(id: string, fn: () => unknown, opts?: { runs?: number; warmup?: number; unit?: Samples["unit"] }): Promise<Samples> {
  return unsupported("testkit.measure", id, fn, opts);
}

/** Peak RSS (MB) of the current process sampled every 10 ms while `fn` runs. */
export function rssPeak<T>(fn: () => Promise<T>): Promise<{ value: T; peakMb: number }> {
  return unsupported("testkit.rssPeak", fn);
}

/** runner time / reference time of the calibration workload, clamped to [0.5, 5]. */
export function machineFactor(): Promise<number> {
  return unsupported("testkit.machineFactor");
}

export function budget(id: string): BudgetEntry {
  return unsupported("testkit.budget", id);
}
