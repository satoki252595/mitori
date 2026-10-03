// Reader for the merged `bench/budgets.json` (testing spec §6.1). The file is committed; `check` fails when it is
// stale against `bench/budgets/<pkg>.json`, so reading it is enough.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MitoriError } from "@mitori/core";
import type { BudgetEntry } from "../contract.ts";

/** Repo root with a trailing slash, valid under Bun and Node (`import.meta.dir` is Bun-only). */
export const BENCH_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** A budget as stored: the contract fields plus the optional probabilistic-gate sample size (SC-14). */
export type StoredBudget = BudgetEntry & { minN?: number };

/** A deterministic counter (`counters[]`): head may never exceed `max`, nor base (testing spec §6.1). */
export interface StoredCounter {
  id: string;
  max: number;
  owner: string;
  measure: string;
}

export interface BudgetsFile {
  v: "mitori.budgets/1";
  reference?: Record<string, string>;
  budgets: StoredBudget[];
  counters: StoredCounter[];
}

const cache = new Map<string, BudgetsFile>();

/** Parse a merged budgets file. `path` defaults to the checkout's `bench/budgets.json`. */
export function loadBudgetsFile(path = `${BENCH_ROOT}bench/budgets.json`): BudgetsFile {
  const hit = cache.get(path);
  if (hit) return hit;
  const doc = JSON.parse(readFileSync(path, "utf8")) as Partial<BudgetsFile>;
  if (doc.v !== "mitori.budgets/1") throw new MitoriError("E_INVALID_INPUT", `${path}: "v" must be "mitori.budgets/1"`);
  const file: BudgetsFile = { v: doc.v, ...(doc.reference ? { reference: doc.reference } : {}), budgets: doc.budgets ?? [], counters: doc.counters ?? [] };
  cache.set(path, file);
  return file;
}

/** The budget with this id. Throws `E_NOT_FOUND` for an unknown id (a typo must not pass silently). */
export function findBudget(id: string, path?: string): StoredBudget {
  const hit = loadBudgetsFile(path).budgets.find((b) => b.id === id);
  if (!hit) throw new MitoriError("E_NOT_FOUND", `no budget "${id}" in bench/budgets.json (add it to bench/budgets/<pkg>.json and run budgets:merge)`);
  return hit;
}
