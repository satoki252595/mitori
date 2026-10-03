// budgets lint: bench/budgets/*.json (shape, unique ids, target vs limit). Passes when no budget file exists yet.
import { lintBudgets } from "./lib/budgets.ts";
import { listFiles, read } from "./lib/repo.ts";

const files = listFiles("bench/budgets").filter((p) => p.endsWith(".json"));
const problems = lintBudgets(files.map((path) => ({ path, json: JSON.parse(read(path)) })));
for (const p of problems) console.error(`${p.file} ${p.id}: ${p.message}`);
console.log(problems.length ? `check-budgets: ${problems.length} problem(s)` : `check-budgets: ok (${files.length} file(s))`);
process.exit(problems.length ? 1 : 0);
