// `bun bench/report.ts <bench-result.json> [--budgets bench/budgets.json]`: a Markdown table of one
// `mitori.bench-result/1` file against the raw budgets (no machine factor: the numbers as measured, the verdict
// as if this were the reference machine), with each case's start load. For docs/progress/bench-baseline.md.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BenchResultFile } from "./runner/result.ts";
import { convert, fmt } from "./runner/verdict.ts";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: bun bench/report.ts <bench-result.json> [--budgets <file>]");
  process.exit(2);
}
const bi = argv.indexOf("--budgets");
const budgetsFile = bi >= 0 ? resolve(argv[bi + 1] as string) : join(import.meta.dir, "budgets.json");
const r = JSON.parse(readFileSync(resolve(file), "utf8")) as BenchResultFile;
interface B {
  id: string;
  target: number;
  limit: number;
  unit: string;
  dir: "max" | "min";
  gates: string[];
  scale: string;
}
const doc = JSON.parse(readFileSync(budgetsFile, "utf8")) as { budgets: B[]; counters: { id: string; max: number }[] };
const budgets = new Map(doc.budgets.map((b) => [b.id, b]));
const counters = new Map(doc.counters.map((c) => [c.id, c]));

const m = r.machine;
const lines: string[] = [];
lines.push(`- sha ${r.sha.slice(0, 12)} · ${m.cpu} · ${m.cores} cores · ${m.ramGb} GB · ${m.os} · bun ${m.bun} · node ${m.node} · chrome ${m.chrome ?? "—"}`);
lines.push(
  `- started ${r.startedAt} · loadavg at start ${fmt(m.loadavg)} (noisy: ${m.noisy}) · power ${m.power ?? "?"} · factor ${fmt(r.factor)} (${r.factorSource})`,
);
lines.push("");
lines.push("| id | unit | median | p95 | n | cv | target / limit | verdict (raw) | load |");
lines.push("|---|---|---:|---:|---:|---:|---|---|---:|");
for (const e of r.results) {
  const b = budgets.get(e.id);
  if (e.error) {
    lines.push(
      `| \`${e.id}\` | ${e.unit} | — | — | 0 | — | ${b ? `${fmt(b.target)} / ${fmt(b.limit)} ${b.unit}` : "—"} | ERROR: ${e.error.replace(/\|/g, "/").slice(0, 120)} | ${fmt(e.loadavg ?? Number.NaN)} |`,
    );
    continue;
  }
  let verdict = "— (no budget)";
  let tl = "—";
  if (b) {
    const v = convert(e[e.budgetStat], e.unit, b.unit as never);
    const over = (x: number) => (b.dir === "max" ? v > x : v < x);
    verdict = over(b.limit) ? "**over limit**" : over(b.target) ? "over target" : "ok";
    if (e.budgetStat === "p95") verdict += " (p95)";
    if (!b.gates.some((g) => g === "absolute" || g === "structural")) verdict += ` · ${b.gates.join("/")} gate`;
    tl = `${fmt(b.target)} / ${fmt(b.limit)}${b.unit !== e.unit ? ` ${b.unit}` : ""}`;
  }
  lines.push(
    `| \`${e.id}\` | ${e.unit} | ${fmt(e.median)} | ${fmt(e.p95)} | ${e.values.length} | ${fmt(e.cv)} | ${tl} | ${verdict} | ${fmt(e.loadavg ?? Number.NaN)} |`,
  );
}
if (r.counters.length > 0) {
  lines.push("");
  lines.push("| counter | value | max | verdict |");
  lines.push("|---|---:|---:|---|");
  for (const c of r.counters) {
    const max = counters.get(c.id)?.max;
    lines.push(`| \`${c.id}\` | ${c.value} | ${max ?? "—"} | ${max === undefined ? "— (no budget)" : c.value <= max ? "ok" : "**over max**"} |`);
  }
}
console.log(lines.join("\n"));
