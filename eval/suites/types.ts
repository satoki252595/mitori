import type { Engine } from "@mitori/agent";
import type { BudgetGuard } from "../budget.ts";
import type { EvalLedger } from "../ledger.ts";
import type { SuiteResult } from "../report.ts";
import type { SloEntry } from "../slo.ts";

export interface SuiteContext {
  engine: Engine;
  ledger: EvalLedger;
  guard: BudgetGuard;
  now: () => Date;
  /** `EVAL_SEED`: orders, samples and bootstraps derive from it. */
  seed: number;
}

export interface SuiteOutput {
  result: SuiteResult;
  slo: SloEntry[];
}

export type RunSuite = (ctx: SuiteContext) => Promise<SuiteOutput>;
