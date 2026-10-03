// `bun scripts/budgets-merge.ts [--check]` — merges bench/budgets/<pkg>.json (one file per owning package, SC-16)
// into bench/budgets.json (testing spec §6.1, the file the bench runner and CORE-U-009 read).
// --check: nothing is written; fails on shape errors (scripts/lib/budgets.ts), duplicate ids, a missing `unit`,
// or a bench/budgets.json that is not what a merge would produce now.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lintBudgets } from "./lib/budgets.ts";
import { listFiles, ROOT, read } from "./lib/repo.ts";

export const MERGED_PATH = "bench/budgets.json";
const SOURCE_DIR = "bench/budgets";

/** The machine the absolute limits were set on (testing spec §6.1). Time limits scale by `machineFactor` elsewhere. */
export const REFERENCE = {
  machine: "Apple M5 Max (18 logical cores, 128GB)",
  os: "macOS 27.0",
  bun: "1.4.2",
  node: "22.23.3",
  chrome: "154",
} as const;

export interface SourceFile {
  path: string;
  json: unknown;
}

interface Doc {
  budgets?: unknown[];
  counters?: unknown[];
}

export interface MergedBudgets {
  v: "mitori.budgets/1";
  reference: typeof REFERENCE;
  budgets: unknown[];
  counters: unknown[];
}

/** Concatenate the per-package files in path order (entries keep their source order). */
export function mergeBudgets(files: readonly SourceFile[]): MergedBudgets {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const docs = sorted.map((f) => f.json as Doc);
  return {
    v: "mitori.budgets/1",
    reference: REFERENCE,
    budgets: docs.flatMap((d) => d.budgets ?? []),
    counters: docs.flatMap((d) => d.counters ?? []),
  };
}

const WIDTH = 160;

/** JSON in the layout `biome format` produces (so `biome ci` accepts the merged file): objects expanded, flat arrays inline when they fit. */
export function renderJson(value: unknown, indent = ""): string {
  const next = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((x) => x === null || typeof x !== "object")) {
      const inline = `[${value.map((x) => JSON.stringify(x)).join(", ")}]`;
      if (indent.length + inline.length + 20 <= WIDTH) return inline;
    }
    return `[\n${value.map((x) => `${next}${renderJson(x, next)}`).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${renderJson(v, next)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export const renderMerged = (merged: MergedBudgets): string => `${renderJson(merged)}\n`;

/** Problems that make the budget set unusable; empty = OK. `current` is the existing bench/budgets.json text, if any. */
export function checkBudgets(files: readonly SourceFile[], current: string | undefined): string[] {
  const problems = lintBudgets(files).map((p) => `${p.file} ${p.id}: ${p.message}`);
  for (const f of files) {
    const d = f.json as Doc;
    for (const b of d.budgets ?? []) {
      const e = b as { id?: unknown; unit?: unknown };
      if (e.unit === undefined || e.unit === "") problems.push(`${f.path} ${String(e.id)}: unit is missing`);
    }
  }
  if (problems.length === 0) {
    const expected = renderMerged(mergeBudgets(files));
    if (current === undefined) problems.push(`${MERGED_PATH}: missing (run: bun scripts/budgets-merge.ts)`);
    else if (current !== expected) problems.push(`${MERGED_PATH}: out of date with ${SOURCE_DIR}/*.json (run: bun scripts/budgets-merge.ts)`);
  }
  return problems;
}

function loadSources(): SourceFile[] {
  return listFiles(SOURCE_DIR)
    .filter((p) => p.endsWith(".json"))
    .map((path) => ({ path, json: JSON.parse(read(path)) as unknown }));
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const files = loadSources();
  const abs = join(ROOT, MERGED_PATH);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  if (check) {
    const problems = checkBudgets(files, current);
    for (const p of problems) console.error(p);
    const merged = mergeBudgets(files);
    console.log(
      problems.length
        ? `budgets-merge --check: ${problems.length} problem(s)`
        : `budgets-merge --check: ok (${merged.budgets.length} budgets, ${merged.counters.length} counters from ${files.length} files; duplicate ids 0, missing units 0)`,
    );
    process.exit(problems.length ? 1 : 0);
  }
  const problems = checkBudgets(files, current).filter((p) => !p.startsWith(`${MERGED_PATH}:`));
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`budgets-merge: refusing to merge ${problems.length} problem(s)`);
    process.exit(1);
  }
  const merged = mergeBudgets(files);
  writeFileSync(abs, renderMerged(merged));
  console.log(`budgets-merge: ${merged.budgets.length} budgets, ${merged.counters.length} counters from ${files.length} files -> ${MERGED_PATH}`);
}
