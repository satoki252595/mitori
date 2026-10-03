// `bun run bench` (root script; MILESTONES WP-12): discover `bench/**/*.bench.ts`, run the selected cases, print a table and
// optionally write `mitori.bench-result/1`. With --absolute the results are gated against bench/budgets.json (limit =
// fail, target = warning; time budgets only gate on the reference machine, §6.8).
//
//   bun bench/runner/run.ts [--suite idx,doc|all] [--id <id|prefix|glob>]... [--root <tree>] [--out <file>|auto]
//                           [--runs n] [--warmup n] [--absolute] [--no-wait] [--factor <n>] [--list] [--json]
//                           [--calibrate] [--record-reference]
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TEST_FORMATS } from "@mitori/testkit";
import { type Budgets, readBudgets } from "./budgets.ts";
import { discover, select } from "./discover.ts";
import { executeCase } from "./execute.ts";
import { type GateReport, gateResult } from "./gate.ts";
import { gitSha, keepAwake, machineInfo, measureFactor, readReference, recordReference, waitForQuiet } from "./machine.ts";
import { resolveRepo } from "./repos.ts";
import { type BenchResultFile, writeResult } from "./result.ts";
import { textTable } from "./table.ts";
import { fmt, mark } from "./verdict.ts";

export const RUNNER_ROOT = resolve(import.meta.dir, "../..");

export interface RunOptions {
  /** The tree whose bench files are measured (default: this checkout). */
  root?: string;
  suites?: readonly string[];
  ids?: readonly string[];
  exact?: boolean;
  runs?: number;
  warmup?: number;
  absolute?: boolean;
  /** Wait for a quiet machine before starting (default true). */
  wait?: boolean;
  /** Use this factor instead of measuring it (compare passes the one it measured once). */
  factor?: number;
  log?: (line: string) => void;
}

export interface RunReport {
  file: BenchResultFile;
  gate: GateReport | null;
  ok: boolean;
  text: string;
}

/** Measure the selected cases of one tree. */
export async function runBench(opts: RunOptions = {}): Promise<RunReport> {
  const root = opts.root ?? RUNNER_ROOT;
  const log = opts.log ?? (() => {});
  const found = select(await discover(root), { suites: opts.suites ?? [], ids: opts.ids ?? [], exact: opts.exact ?? false });
  const quiet = opts.wait === false ? { loadavg: 0, noisy: false } : await waitForQuiet();
  const f =
    opts.factor !== undefined
      ? { factor: opts.factor, source: "measured" as const }
      : opts.absolute
        ? measureFactor(root)
        : { factor: 1, source: "assumed" as const };
  const file: BenchResultFile = {
    v: TEST_FORMATS.benchResult,
    sha: gitSha(root),
    machine: machineInfo(root, quiet),
    factor: f.factor,
    factorSource: f.source,
    startedAt: new Date().toISOString(),
    results: [],
    counters: [],
  };
  for (const { def } of found) {
    log(`  ${def.id} …`);
    const out = await executeCase(def, {
      ...(opts.runs !== undefined ? { runs: opts.runs } : {}),
      ...(opts.warmup !== undefined ? { warmup: opts.warmup } : {}),
      resolveRepo: (name) => resolveRepo(name, root),
    });
    file.results.push(out.entry);
    file.counters.push(...out.counters);
  }
  const budgets: Budgets = readBudgets(root);
  const gate = opts.absolute ? gateResult(file, budgets) : null;
  const errors = file.results.filter((r) => r.error);
  const ok = gate ? gate.ok : errors.length === 0;
  return { file, gate, ok, text: renderText(file, gate, budgets) };
}

export function renderText(file: BenchResultFile, gate: GateReport | null, budgets: Budgets): string {
  const m = file.machine;
  const head = `bench ${file.sha.slice(0, 8) || "(no sha)"} · ${m.cpu} · ${m.cores} cores · bun ${m.bun} · factor ${fmt(file.factor)} (${file.factorSource})${m.noisy ? ` · NOISY load ${fmt(m.loadavg)}` : ""}${m.power === "battery" ? " · ON BATTERY" : ""}`;
  const verdicts = new Map(gate?.verdicts.map((v) => [v.id, v]));
  const rows = file.results.map((r) => {
    if (r.error) return [r.id, r.unit, "—", "—", "—", "", `ERROR ${r.error}`];
    const v = verdicts.get(r.id);
    const b = budgets.budgets.get(r.id);
    const limits = v ? `${fmt(v.target)} / ${fmt(v.limit)}${v.scaled ? " (scaled)" : ""}` : b && gate ? "(not gated)" : "";
    const status = v ? `${mark(v.level)}${v.level === "red" && !v.gating ? " (not gating here)" : ""}` : "";
    return [r.id, r.unit, fmt(r.median), fmt(r.p95), fmt(r.cv), limits, status];
  });
  const lines = [head, textTable(["id", "unit", "median", "p95", "cv", "target / limit", "status"], rows)];
  for (const c of file.counters) {
    const v = gate?.counters.find((x) => x.id === c.id);
    lines.push(`counter ${c.id} = ${c.value}${v ? ` (max ${v.max}) ${v.ok ? "ok" : "FAIL"}` : ""}`);
  }
  return lines.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      suite: { type: "string" },
      id: { type: "string", multiple: true },
      exact: { type: "boolean" },
      root: { type: "string" },
      out: { type: "string" },
      runs: { type: "string" },
      warmup: { type: "string" },
      absolute: { type: "boolean" },
      "no-wait": { type: "boolean" },
      factor: { type: "string" },
      list: { type: "boolean" },
      json: { type: "boolean" },
      calibrate: { type: "boolean" },
      "record-reference": { type: "boolean" },
    },
  });
  const root = values.root ? resolve(values.root) : RUNNER_ROOT;
  const num = (v: string | undefined, name: string): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
    return n;
  };

  if (values["record-reference"]) {
    const ref = recordReference(root);
    console.log(`recorded bench/runner/reference.json: ${ref.machine.cpu}, calibration ${fmt(ref.calib.totalMs)} ms`, ref.calib.parts);
    return 0;
  }
  if (values.calibrate) {
    const f = measureFactor(root);
    console.log(JSON.stringify({ ...f, reference: readReference(root)?.calib.totalMs ?? null }));
    return 0;
  }

  const suites = values.suite?.split(",").filter(Boolean);
  const found = select(await discover(root), { suites: suites ?? [], ids: values.id ?? [], exact: values.exact ?? false });
  if (values.list) {
    const rows = found.map(({ def, file }) => ({
      id: def.id,
      suite: def.suite,
      mode: def.mode,
      unit: def.unit ?? "ms",
      repo: def.repo ?? null,
      file: file.slice(root.length + 1),
    }));
    console.log(
      values.json
        ? JSON.stringify(rows)
        : textTable(
            ["id", "suite", "mode", "unit", "repo", "file"],
            rows.map((r) => [r.id, r.suite, r.mode, r.unit, r.repo ?? "", r.file]),
          ),
    );
    return 0;
  }
  if (found.length === 0) {
    const explicit = (values.id?.length ?? 0) > 0 || (suites?.length ?? 0) > 0;
    console.log(explicit ? "bench: no case matches the selection" : "bench: no bench cases yet (bench/**/*.bench.ts)");
    return explicit ? 2 : 0;
  }

  if (!values.json) keepAwake(); // the child runs of bench:compare (--json) are covered by the parent's
  const report = await runBench({
    root,
    suites: suites ?? [],
    ids: values.id ?? [],
    exact: values.exact ?? false,
    ...(num(values.runs, "runs") !== undefined ? { runs: num(values.runs, "runs") as number } : {}),
    ...(num(values.warmup, "warmup") !== undefined ? { warmup: num(values.warmup, "warmup") as number } : {}),
    ...(num(values.factor, "factor") !== undefined ? { factor: num(values.factor, "factor") as number } : {}),
    absolute: values.absolute ?? false,
    wait: !values["no-wait"],
    log: values.json ? () => {} : (l) => process.stderr.write(`${l}\n`),
  });
  if (values.out) {
    const out = values.out === "auto" ? join(root, "bench/results", `${report.file.sha.slice(0, 12) || "nosha"}.local.json`) : resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeResult(out, report.file);
  }
  console.log(values.json ? JSON.stringify(report.file) : report.text);
  for (const r of report.file.results) if (r.error) console.error(`bench: ${r.id} failed: ${r.error}`);
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`bench: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
