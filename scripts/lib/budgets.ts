// budgets lint (testing spec §6.1, SC-16): split files `bench/budgets/<pkg>.json`, each `mitori.budgets/1`.
// WP-00b owns the files and the merge (`scripts/budgets-merge.ts`); this lint only checks shape and consistency.
import type { BudgetEntry } from "@mitori/testkit";

export interface BudgetProblem {
  file: string;
  id: string;
  message: string;
}

const UNITS: ReadonlySet<string> = new Set(["ms", "s", "MB", "KB", "B", "tokens", "count", "ratio", "pct", "usd"]);
const GATES: ReadonlySet<string> = new Set(["relative", "absolute", "structural", "golden", "eval", "contract", "counter"]);

type Entry = Partial<Record<keyof BudgetEntry | "minN" | "unmeasured", unknown>>;

/** Lint all budget files together (ids are unique across files). */
/**
 * `exists` (repo-relative path → bool): F4 (nonfunc audit) — a `measure` file that does not exist measures nothing;
 * such an entry must say so (`unmeasured: "<why>"`), and an entry whose file exists must not carry `unmeasured`.
 */
export function lintBudgets(files: readonly { path: string; json: unknown }[], exists?: (path: string) => boolean): BudgetProblem[] {
  const out: BudgetProblem[] = [];
  const seen = new Map<string, string>();
  for (const { path, json } of files) {
    const p = (id: string, message: string) => out.push({ file: path, id, message });
    const doc = json as { v?: unknown; budgets?: unknown; counters?: unknown };
    if (doc.v !== "mitori.budgets/1") p("-", `"v" must be "mitori.budgets/1"`);
    const budgets = Array.isArray(doc.budgets) ? (doc.budgets as Entry[]) : [];
    const counters = Array.isArray(doc.counters) ? (doc.counters as Entry[]) : [];
    if (doc.budgets !== undefined && !Array.isArray(doc.budgets)) p("-", `"budgets" must be an array`);
    if (doc.counters !== undefined && !Array.isArray(doc.counters)) p("-", `"counters" must be an array`);
    const unique = (id: unknown) => {
      if (typeof id !== "string" || !/^[a-z][a-z0-9]*(\.[A-Za-z0-9_-]+)+$/.test(id))
        return p(String(id), "id must be a namespaced dotted id (e.g. idx.s01.cold.100kloc)");
      const prev = seen.get(id);
      if (prev) p(id, `duplicate id (also in ${prev})`);
      seen.set(id, path);
    };
    const measured = (id: string, e: { measure?: unknown; unmeasured?: unknown }) => {
      if (!exists || typeof e.measure !== "string") return;
      const file = e.measure.split("#")[0] as string;
      const has = exists(file);
      if (e.unmeasured !== undefined && (typeof e.unmeasured !== "string" || e.unmeasured.trim() === "")) p(id, "unmeasured must be a non-empty reason");
      else if (!has && e.unmeasured === undefined) p(id, `measure file ${file} does not exist (add it, or say why with "unmeasured")`);
      else if (has && e.unmeasured !== undefined) p(id, `measure file ${file} exists: drop "unmeasured"`);
    };
    for (const b of budgets) {
      const id = String(b.id);
      unique(b.id);
      if (typeof b.metric !== "string" || b.metric === "") p(id, "metric (description) is required");
      if (typeof b.target !== "number" || typeof b.limit !== "number") p(id, "target and limit must be numbers");
      else if (b.dir === "max" ? b.target > b.limit : b.dir === "min" ? b.target < b.limit : true)
        p(id, b.dir === "max" || b.dir === "min" ? `target ${b.target} is beyond limit ${b.limit} for dir "${b.dir}"` : `dir must be "max" or "min"`);
      if (typeof b.unit !== "string" || !UNITS.has(b.unit)) p(id, `unit must be one of ${[...UNITS].join(", ")}`);
      if (!Array.isArray(b.gates) || b.gates.length === 0 || !b.gates.every((g) => GATES.has(g as string)))
        p(id, `gates must be a non-empty subset of ${[...GATES].join(", ")}`);
      if (typeof b.owner !== "string" || b.owner === "") p(id, "owner is required");
      if (typeof b.measure !== "string" || !/^[^#\s]+#[^#\s]+$/.test(b.measure)) p(id, `measure must be "<file>#<case>"`);
      if (b.scale !== "machine" && b.scale !== "none") p(id, `scale must be "machine" or "none"`);
      if (typeof b.provisional !== "boolean") p(id, "provisional must be a boolean");
      if (b.minN !== undefined && !(Number.isInteger(b.minN) && (b.minN as number) > 0)) p(id, "minN must be a positive integer");
      measured(id, b);
    }
    for (const c of counters as Record<string, unknown>[]) {
      const id = String(c.id);
      unique(c.id);
      if (!(Number.isInteger(c.max) && (c.max as number) >= 0)) p(id, "counter max must be a non-negative integer");
      if (typeof c.owner !== "string" || c.owner === "") p(id, "owner is required");
      if (typeof c.measure !== "string" || !/^[^#\s]+#[^#\s]+$/.test(c.measure)) p(id, `measure must be "<file>#<case>"`);
      measured(id, c);
    }
  }
  return out;
}
