// Reading `bench/budgets.json` of a given tree (the runner measures head and base trees, each with its own budgets).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BudgetEntry } from "@mitori/testkit";

export type Budget = BudgetEntry & { minN?: number };
export interface CounterBudget {
  id: string;
  max: number;
  owner: string;
  measure: string;
}
export interface Budgets {
  budgets: Map<string, Budget>;
  counters: Map<string, CounterBudget>;
}

export function readBudgets(root: string): Budgets {
  const file = join(root, "bench/budgets.json");
  const doc = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { budgets?: Budget[]; counters?: CounterBudget[] }) : {};
  return {
    budgets: new Map((doc.budgets ?? []).map((b) => [b.id, b])),
    counters: new Map((doc.counters ?? []).map((c) => [c.id, c])),
  };
}
