// EX-04: the share of factual sentences of a generated doc that carry no source (0 tokens). Usage:
//   scripts/nd bun bench/measure/doc-uncited.ts <docDir>/doc [--list]
// Module pages and the AI-written sections are counted; static tables / headings / callout labels are not prose.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { uncitedSentences } from "../../packages/gen/src/line/mdscan.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: doc-uncited.ts <doc dir> [--list]");
  process.exit(2);
}
const list = process.argv.includes("--list");
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".md")) files.push(p);
  }
};
walk(dir);
// the module pages by default (the generated body; the top sections mix static facts in) — `--all` for every file
if (!process.argv.includes("--all")) files.splice(0, files.length, ...files.filter((f) => f.includes("/modules/")));
let total = 0;
let uncited = 0;
let withCode = 0;
const rows: string[] = [];
for (const f of files.sort()) {
  // drop the static blocks' id comments and the NOTE / TIP callouts (labels, not claims)
  const md = readFileSync(f, "utf8")
    .replace(/<!-- b_[0-9a-z]{8} -->/g, "")
    .replace(/^> \[!(NOTE|TIP)\].*\n(?:>.*\n?)*/gm, "")
    // the static facts line of a module page (「ファイル 38 · 5799 行 · 重要度 0.43」)
    .replace(/^- (ファイル \d+ · |子モジュール \d+|Files? \d+ · ).*$/gm, "");
  const r = uncitedSentences(md);
  if (r.sentences === 0) continue;
  total += r.sentences;
  uncited += r.uncited.length;
  withCode += r.uncitedWithCode.length;
  rows.push(
    `${f.slice(dir.length + 1).padEnd(40)} ${String(r.sentences).padStart(4)} ${String(r.uncited.length).padStart(4)} ${String(r.uncitedWithCode.length).padStart(4)}`,
  );
  if (list) for (const s of r.uncitedWithCode) rows.push(`    ・${s.slice(0, 120)}`);
}
console.log(`${"file".padEnd(40)} sent  unc  code`);
for (const r of rows) console.log(r);
const pct = (n: number) => (total > 0 ? ((100 * n) / total).toFixed(1) : "0");
console.log(`total: ${total} sentences · uncited ${uncited} (${pct(uncited)} %) · uncited naming code ${withCode} (${pct(withCode)} %)`);
