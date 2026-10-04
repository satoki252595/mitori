// `bun run bench:compare` — the head-vs-base regression gate (testing spec §6.7).
//
//   bun bench/compare/compare.ts [--base <ref> | --base-root <dir>] [--suite s,..] [--id <id>]... [--pairs n]
//        [--head-env KEY=VAL]... [--base-env KEY=VAL]... [--base-setup "<cmd>"|none] [--no-absolute]
//        [--budget-change] [--asset] [--no-wait] [--md <file>] [--out <file>|auto] [--keep-base]
//
// For every case the base and head trees are measured alternately in fresh processes (base, head, base, head, …;
// P pairs, 5 for in-process micro cases and 3 for cold process cases). A ≥ 20 % slowdown above the noise floor is
// re-measured once with 2P pairs and fails if it persists; a spread above 25 % only warns. Deterministic counters may
// not exceed base. Head's absolute/structural budgets (limit) gate as well; --asset adds the served-bytes table with the Δ
// against base (bench/asset/size.ts on both trees). Exit 1 on any failure, 2 on usage errors.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TEST_FORMATS } from "@mitori/testkit";
import { type Budgets, readBudgets } from "../runner/budgets.ts";
import { type GateReport, gateResult } from "../runner/gate.ts";
import { gitSha, keepAwake, machineInfo, measureFactor, waitForQuiet } from "../runner/machine.ts";
import type { BenchResultEntry, BenchResultFile } from "../runner/result.ts";
import { writeResult } from "../runner/result.ts";
import { toSamples } from "../runner/stats.ts";
import { fmt, type Level } from "../runner/verdict.ts";
import { type BaseTree, defaultBase, prepareBase } from "./base.ts";
import { type CaseRunner, type ChildRun, type ListedCase, processRunner, type Side } from "./child.ts";
import { type Judgement, judge } from "./judge.ts";
import { renderMarkdown } from "./report.ts";

export interface MetricRow {
  id: string;
  unit: string;
  /** "new": no base case to compare with. "error": a side threw. */
  status: "ok" | "improved" | "regressed" | "noisy" | "new" | "error";
  judgement?: Judgement;
  base?: BenchResultEntry;
  head?: BenchResultEntry;
  /** The measurement was repeated with 2P pairs. */
  reran: boolean;
  note?: string;
}

export interface CounterRow {
  id: string;
  base: number | null;
  head: number;
  /** Allowed increase (budget-change) — recorded, not failing. */
  allowed: boolean;
  fail: boolean;
  note?: string;
}

/** One served-bytes budget of the web shell, head against base (the `--asset` table). */
export interface AssetRow {
  id: string;
  unit: string;
  base: number | null;
  head: number;
  target: number;
  limit: number;
  level: Level;
  /** Fails the run (a hard limit of `size`). */
  hard: boolean;
}

/** What `bench/asset/size.ts --json` reports for one tree. */
export interface AssetSnapshot {
  metrics: { id: string; value: number; unit: string }[];
  verdicts: { id: string; level: Level; hard: boolean; target: number; limit: number }[];
  ok: boolean;
}

export interface CompareReport {
  head: { sha: string };
  base: { sha: string } | null;
  rows: MetricRow[];
  counters: CounterRow[];
  assets: AssetRow[];
  gate: GateReport | null;
  warnings: string[];
  fail: boolean;
  headResult: BenchResultFile;
  /** Cases the selection matched in each tree (an explicit `--id` that matches nothing is a usage error, not a pass). */
  listed: { head: number; base: number };
}

export interface CompareOptions {
  head: Side;
  /** null: no base available — only head's absolute gates apply. */
  base: Side | null;
  runner: CaseRunner;
  suites?: readonly string[];
  ids?: readonly string[];
  /** Pairs for inproc / process cases (default 5 / 3). */
  pairs?: { inproc: number; process: number };
  absolute?: boolean;
  /** A counter increase is allowed when head's budgets.json raised the counter's max in the same change. */
  budgetChange?: boolean;
  /** Factor of the measuring machine for head's absolute gate. */
  factor?: { factor: number; source: "measured" | "assumed" };
  /** Served bytes of a tree (null = could not be measured). When given, the report carries the asset table and head's hard limits gate. */
  assets?: (side: Side) => Promise<AssetSnapshot | null>;
  log?: (line: string) => void;
}

/** All samples of the runs of one side, summarised as one entry. */
const pool = (runs: readonly ChildRun[]): BenchResultEntry => {
  const first = runs[0] as ChildRun;
  return {
    ...first.entry,
    ...toSamples(
      first.entry.id,
      first.entry.unit,
      runs.flatMap((r) => r.entry.values),
    ),
  };
};

const pairsFor = (c: ListedCase, o: CompareOptions): number => (c.mode === "process" ? (o.pairs?.process ?? 3) : (o.pairs?.inproc ?? 5));

export async function compare(opts: CompareOptions): Promise<CompareReport> {
  const log = opts.log ?? (() => {});
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const sel = { suites: opts.suites ?? [], ids: opts.ids ?? [] };
  const headCases = await opts.runner.list(opts.head, sel, warn);
  const baseCases = opts.base ? await opts.runner.list(opts.base, sel, warn) : [];
  const baseIds = new Set(baseCases.map((c) => c.id));

  const rows: MetricRow[] = [];
  const headEntries: BenchResultEntry[] = [];
  const headCounters = new Map<string, number>();
  const baseCounters = new Map<string, number>();
  const keepMax = (m: Map<string, number>, id: string, v: number) => m.set(id, Math.max(m.get(id) ?? Number.NEGATIVE_INFINITY, v));
  let firstHeadFile: BenchResultFile | undefined;

  /** P alternating pairs of (base, head). */
  const measurePairs = async (c: ListedCase, pairs: number, withBase: boolean) => {
    const base: ChildRun[] = [];
    const head: ChildRun[] = [];
    for (let i = 0; i < pairs; i++) {
      if (withBase && opts.base) base.push(await opts.runner.run(opts.base, c.id));
      head.push(await opts.runner.run(opts.head, c.id));
    }
    return { base, head };
  };

  for (const c of headCases) {
    const withBase = baseIds.has(c.id);
    const pairs = pairsFor(c, opts);
    log(`${c.id}: ${withBase ? `${pairs} pairs` : `${pairs} runs (no base case)`}`);
    try {
      let m = await measurePairs(c, pairs, withBase);
      let reran = false;
      const decide = () => {
        const b = m.base.length ? pool(m.base) : undefined;
        return { b, h: pool(m.head), j: b ? judge(b.values, pool(m.head).values, c.unit as never) : undefined };
      };
      let d = decide();
      // a noisy or regressed first look is measured once more with twice the pairs; the second look decides
      if (d.j && (d.j.status === "noisy" || d.j.status === "regressed")) {
        log(`${c.id}: ${d.j.status} (${fmt(d.j.delta * 100)} %) — re-measuring with ${pairs * 2} pairs`);
        m = await measurePairs(c, pairs * 2, true);
        reran = true;
        d = decide();
      }
      headEntries.push(d.h);
      firstHeadFile ??= m.head[0]?.file;
      for (const r of m.head) for (const k of r.counters) keepMax(headCounters, k.id, k.value);
      for (const r of m.base) for (const k of r.counters) keepMax(baseCounters, k.id, k.value);
      const headErr = m.head.find((r) => r.entry.error)?.entry.error;
      const baseErr = m.base.find((r) => r.entry.error)?.entry.error;
      if (headErr || baseErr) {
        rows.push({
          id: c.id,
          unit: c.unit,
          status: "error",
          reran,
          head: d.h,
          ...(d.b ? { base: d.b } : {}),
          note: `${headErr ? `head: ${headErr}` : ""}${baseErr ? ` base: ${baseErr}` : ""}`.trim(),
        });
      } else if (d.j && d.b) {
        rows.push({ id: c.id, unit: c.unit, status: d.j.status, judgement: d.j, base: d.b, head: d.h, reran });
      } else {
        rows.push({ id: c.id, unit: c.unit, status: "new", head: d.h, reran, note: "new case: no base to compare with" });
      }
    } catch (err) {
      rows.push({ id: c.id, unit: c.unit, status: "error", reran: false, note: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const c of baseCases) if (!headCases.some((h) => h.id === c.id)) warn(`${c.id}: exists in base only (removed or renamed in head)`);

  // deterministic counters: head may not exceed base (or its own max when the counter is new)
  const headBudgets: Budgets = readBudgets(opts.head.root);
  const baseBudgets: Budgets = opts.base ? readBudgets(opts.base.root) : headBudgets;
  const counters: CounterRow[] = [];
  for (const [id, head] of headCounters) {
    const base = baseCounters.get(id) ?? null;
    const reference = base ?? headBudgets.counters.get(id)?.max ?? null;
    const raised = (headBudgets.counters.get(id)?.max ?? 0) > (baseBudgets.counters.get(id)?.max ?? 0);
    const increased = reference !== null && head > reference;
    const allowed = increased && !!opts.budgetChange && raised;
    counters.push({
      id,
      base,
      head,
      allowed,
      fail: increased && !allowed,
      ...(increased && !allowed && opts.budgetChange && !raised ? { note: "budget-change needs counters[id].max raised in bench/budgets/<pkg>.json" } : {}),
    });
  }

  // served bytes of the web shell: the table with Δ vs base, and head's hard limits
  const assets: AssetRow[] = [];
  let assetsOk = true;
  if (opts.assets) {
    const head = await opts.assets(opts.head).catch(() => null);
    const base = opts.base ? await opts.assets(opts.base).catch(() => null) : null;
    if (!head) warn("asset sizes: head could not be measured (no web build? `bun run size` says why)");
    else {
      if (opts.base && !base) warn("asset sizes: base could not be measured; no Δ column");
      const was = new Map(base?.metrics.map((m) => [m.id, m.value]));
      const verdicts = new Map(head.verdicts.map((v) => [v.id, v]));
      for (const m of head.metrics) {
        const v = verdicts.get(m.id);
        if (v)
          assets.push({ id: m.id, unit: m.unit, base: was.get(m.id) ?? null, head: m.value, target: v.target, limit: v.limit, level: v.level, hard: v.hard });
      }
      assetsOk = head.ok;
    }
  }

  // head's own absolute / structural limits
  const startedAt = new Date().toISOString();
  const headResult: BenchResultFile = {
    v: TEST_FORMATS.benchResult,
    sha: opts.head.sha,
    ...(opts.base ? { base: opts.base.sha } : {}),
    machine: firstHeadFile?.machine ?? machineInfo(opts.head.root, { loadavg: 0, noisy: false }),
    factor: opts.factor?.factor ?? 1,
    factorSource: opts.factor?.source ?? "assumed",
    startedAt,
    results: headEntries,
    counters: [...headCounters].map(([id, value]) => ({ id, value })),
  };
  const gate = opts.absolute === false ? null : gateResult(headResult, headBudgets);
  for (const v of gate?.verdicts ?? [])
    if (v.level === "red" && !v.gating) warn(`${v.id}: over its limit, but time budgets only gate on the reference machine (factor ${fmt(headResult.factor)})`);

  const fail = rows.some((r) => r.status === "regressed" || r.status === "error") || counters.some((c) => c.fail) || (gate ? !gate.ok : false) || !assetsOk;
  return {
    head: { sha: opts.head.sha },
    base: opts.base ? { sha: opts.base.sha } : null,
    rows,
    counters,
    assets,
    gate,
    warnings,
    fail,
    headResult,
    listed: { head: headCases.length, base: baseCases.length },
  };
}

const parseEnv = (pairs: readonly string[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`expected KEY=VALUE, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
};

/** Head's `bench/asset/size.ts --json` run against `side`'s tree: its exit code is the verdict, the JSON is the data. */
async function sizeOfTree(headRoot: string, side: Side): Promise<AssetSnapshot | null> {
  const dir = mkdtempSync(join(tmpdir(), "mitori-size-cmp-"));
  const json = join(dir, "size.json");
  try {
    const proc = Bun.spawn(["bun", join(headRoot, "bench/asset/size.ts"), "--tree", side.root, "--json", json, "--no-startup"], {
      cwd: side.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return existsSync(json) ? (JSON.parse(readFileSync(json, "utf8")) as AssetSnapshot) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      base: { type: "string" },
      "base-root": { type: "string" },
      "base-setup": { type: "string" },
      suite: { type: "string" },
      id: { type: "string", multiple: true },
      pairs: { type: "string" },
      "head-env": { type: "string", multiple: true },
      "base-env": { type: "string", multiple: true },
      "no-absolute": { type: "boolean" },
      "budget-change": { type: "boolean" },
      asset: { type: "boolean" },
      "no-wait": { type: "boolean" },
      "keep-base": { type: "boolean" },
      md: { type: "string" },
      out: { type: "string" },
    },
  });
  const headRoot = resolve(import.meta.dir, "../..");
  const headSha = gitSha(headRoot);
  let baseTree: BaseTree | null = null;
  let baseRoot: string | null = null;
  let baseSha = "";
  try {
    if (values["base-root"]) {
      baseRoot = resolve(values["base-root"]);
      baseSha = gitSha(baseRoot) || "(directory)";
    } else {
      const ref = values.base ?? defaultBase(headRoot);
      const setup = values["base-setup"] === "none" ? null : (values["base-setup"] ?? "bun install --frozen-lockfile");
      baseTree = prepareBase(headRoot, ref, setup);
      baseRoot = baseTree.root;
      baseSha = baseTree.sha;
    }
    keepAwake();
    const quiet = await waitForQuiet(values["no-wait"] ? { retries: 0 } : {});
    if (quiet.noisy) console.error(`bench:compare: the machine is busy (load ${fmt(quiet.loadavg)}); numbers may be noisy`);
    const f = values["no-absolute"] ? { factor: 1, source: "assumed" as const } : measureFactor(headRoot);
    const pairs = values.pairs ? Number(values.pairs) : undefined;
    if (pairs !== undefined && !(Number.isInteger(pairs) && pairs > 0)) throw new Error("--pairs must be a positive integer");
    const report = await compare({
      head: { name: "head", root: headRoot, env: parseEnv(values["head-env"]), sha: headSha },
      base: { name: "base", root: baseRoot, env: parseEnv(values["base-env"]), sha: baseSha },
      runner: processRunner({ runnerRoot: headRoot, factor: f.factor }),
      suites: values.suite?.split(",").filter(Boolean) ?? [],
      ids: values.id ?? [],
      ...(pairs ? { pairs: { inproc: pairs, process: pairs } } : {}),
      absolute: !values["no-absolute"],
      budgetChange: values["budget-change"] ?? process.env.MITORI_BUDGET_CHANGE === "1",
      factor: f,
      ...(values.asset ? { assets: (side: Side) => sizeOfTree(headRoot, side) } : {}),
      log: (l) => process.stderr.write(`${l}\n`),
    });
    if ((values.id?.length ?? 0) > 0 && report.listed.head + report.listed.base === 0) {
      // a mistyped id must not pass the gate vacuously
      console.error(`bench:compare: no case matches --id ${(values.id ?? []).join(", ")} in head or base`);
      return 2;
    }
    const md = renderMarkdown(report);
    console.log(md);
    if (values.md) writeFileSync(resolve(values.md), `${md}\n`);
    if (values.out) {
      const out = values.out === "auto" ? join(headRoot, "bench/results", `${headSha.slice(0, 12) || "nosha"}.local.json`) : resolve(values.out);
      mkdirSync(dirname(out), { recursive: true });
      writeResult(out, report.headResult);
    }
    return report.fail ? 1 : 0;
  } finally {
    if (baseTree && !values["keep-base"]) baseTree.cleanup();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`bench:compare: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
