// CR ledger: every CR reference in docs/specs/contracts resolves to a decided row of packages/core/CR-LEDGER.md.
// Usage: bun scripts/check-cr-ledger.ts   (exit 1 on unknown / ambiguous / undecided / duplicate)
import { checkCrLedger } from "./lib/cr-ledger.ts";
import { listFiles, read, report } from "./lib/repo.ts";

const LEDGER = "packages/core/CR-LEDGER.md";

function scanned(p: string): boolean {
  if (!/\.(md|ts|svelte)$/.test(p) || p.endsWith("CR-LEDGER.md")) return false;
  if (p.startsWith("docs/design/reviews/") || p.startsWith("docs/design/cr-requests/")) return false; // historical inputs / open proposals
  if (p.startsWith("docs/design/prototypes/")) return p === "docs/design/prototypes/JUDGEMENT.md";
  return !p.startsWith("docs/design/specs/indexer/"); // the indexer spec's prototypes and goldens
}

const files = listFiles("docs/design", "packages", "apps").filter(scanned);
const problems = checkCrLedger(
  { path: LEDGER, text: read(LEDGER) },
  files.map((path) => ({ path, text: read(path) })),
);
process.exit(report(`check-cr-ledger (${files.length} files)`, problems));
