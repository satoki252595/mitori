// budgets gate: bench/budgets/*.json (shape, unique ids, target vs limit, units) AND bench/budgets.json being exactly
// what `bun run budgets:merge` would write now (= `budgets-merge --check`, CR m0-15). Passes when no budget file exists yet.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkBudgets, MERGED_PATH } from "./budgets-merge.ts";
import { listFiles, ROOT, read } from "./lib/repo.ts";

const files = listFiles("bench/budgets")
  .filter((p) => p.endsWith(".json"))
  .map((path) => ({ path, json: JSON.parse(read(path)) as unknown }));
const merged = join(ROOT, MERGED_PATH);
const problems = files.length === 0 ? [] : checkBudgets(files, existsSync(merged) ? readFileSync(merged, "utf8") : undefined);
for (const p of problems) console.error(p);
console.log(problems.length ? `check-budgets: ${problems.length} problem(s)` : `check-budgets: ok (${files.length} file(s))`);
process.exit(problems.length ? 1 : 0);
