// `bun run eval` (MILESTONES WP-12, testing spec §7): the LLM-quality harness.
//
//   bun eval/run.ts --suite smoke [--out <dir>]                       the harness on a fake engine (no tokens); JSON + Markdown report
//   bun eval/run.ts --tier quick|standard|full [--suites cite,patch,tokens] [--max-usd N] [--approve-metered-usd X] [--out <dir>]
//
// Exit codes: 0 ok · 1 a check failed · 2 usage, or nothing could run · 3 the engine does not bill the subscription window.
// The tier suites (cite / patch / tokens) land in M2 and M3; until then they are reported as `pending` and the run exits 2.
// This session never calls a paid engine: only the fake one exists here.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Engine } from "@mitori/agent";
import { type BillingMode, PRICING_VERSION } from "@mitori/core";
import { seededRandom, TEST_FORMATS } from "@mitori/testkit";
import { assertBilling, BudgetGuard, EvalRefusal, weeklySpentUsd, withinWeekly } from "./budget.ts";
import { EXIT, SMOKE_CAP_USD, TIERS, type Tier } from "./config.ts";
import { createEvalLedger } from "./ledger.ts";
import { type EvalReport, gitInfo, type ReportTier, reportDirName, type SuiteResult, writeReport } from "./report.ts";
import type { SloEntry } from "./slo.ts";
import { EVAL_SEED } from "./stats.ts";
import { isSuite, SUITE_REGISTRY } from "./suites/index.ts";
import { createSmokeEngine } from "./suites/smoke.ts";

const ROOT = resolve(import.meta.dir, "..");

export interface EvalOptions {
  suite?: "smoke";
  tier?: Tier;
  suites?: readonly string[];
  maxUsd?: number;
  approveMeteredUsd?: number;
  out?: string;
  /** Engine under test. Only the fake one exists until the daemon-backed engine arrives (M2). */
  engine?: Engine;
  now?: () => Date;
  root?: string;
  reportsDir?: string;
}

export interface EvalOutcome {
  report: EvalReport;
  paths: { json: string; md: string } | null;
  exit: number;
  message: string;
}

export async function runEval(opts: EvalOptions): Promise<EvalOutcome> {
  const now = opts.now ?? (() => new Date());
  const root = opts.root ?? ROOT;
  const reportsDir = opts.reportsDir ?? join(root, "eval/reports");
  const startedAt = now().toISOString();
  const smoke = opts.suite === "smoke";
  const tier: ReportTier = smoke ? "smoke" : (opts.tier ?? "quick");
  const names = smoke ? ["smoke"] : (opts.suites?.length ? opts.suites : TIERS[tier as Tier].suites).map(String);
  const unknown = smoke ? [] : names.filter((n) => !isSuite(n) || n === "smoke");
  if (unknown.length > 0) throw new EvalRefusal(`unknown suite(s): ${unknown.join(", ")} (cite, patch, tokens, quiz — or --suite smoke)`, 2);

  const engine = opts.engine ?? (smoke ? createSmokeEngine() : null);
  if (!engine) throw new EvalRefusal("no engine: a live engine arrives with the daemon in M2 — `--suite smoke` runs the harness on a fake one", 2);

  // billing first: a metered engine starts nothing
  const status = await engine.detect();
  assertBilling(status.billing, opts.approveMeteredUsd);

  const requested = opts.maxUsd ?? (smoke ? SMOKE_CAP_USD : TIERS[tier as Tier].capUsd);
  const capUsd = smoke ? requested : withinWeekly(requested, weeklySpentUsd(reportsDir, now()));

  const guard = new BudgetGuard(capUsd);
  const ledger = createEvalLedger(seededRandom(EVAL_SEED));
  const suites: Record<string, SuiteResult> = {};
  const slo: SloEntry[] = [];
  for (const name of names) {
    const out = await SUITE_REGISTRY[name as keyof typeof SUITE_REGISTRY]({ engine, ledger, guard, now, seed: EVAL_SEED });
    suites[name] = out.result;
    slo.push(...out.slo);
  }

  const results = Object.values(suites);
  const anyPending = results.some((s) => s.status === "pending");
  const report: EvalReport = {
    v: TEST_FORMATS.evalReport,
    tier,
    engine: smoke || !opts.engine ? "fake" : "claude-cli",
    partial: guard.partial || anyPending,
    startedAt,
    finishedAt: now().toISOString(),
    git: gitInfo(root),
    versions: { mitori: mitoriVersion(root), claude: status.version ?? null, prompts: {}, pricing: PRICING_VERSION },
    corpus: [],
    budget: {
      capUsd,
      spentUsd: guard.spentUsd,
      windowBefore: status.window?.fiveHour?.utilization ?? null,
      windowAfter: null,
      billing: status.billing as BillingMode,
    },
    suites,
    slo,
  };
  const dir = opts.out ? resolve(opts.out) : join(reportsDir, reportDirName(report));
  const paths = writeReport(dir, report);
  const failed = results.filter((s) => s.status === "failed");
  const exit = failed.length > 0 ? EXIT.failed : anyPending ? EXIT.usage : EXIT.ok;
  const lines = [`eval ${tier}: ${results.map((s) => `${s.id} ${s.status}`).join(", ")} · $${guard.spentUsd.toFixed(5)} of $${capUsd} · ${paths.md}`];
  for (const s of failed) for (const c of s.checks) if (!c.ok) lines.push(`  NG ${s.id}/${c.id}: ${c.detail}`);
  for (const s of results) if (s.status === "pending") lines.push(`  ${s.id}: ${s.notes[0]}`);
  return { report, paths, exit, message: lines.join("\n") };
}

function mitoriVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, "apps/cli/package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      suite: { type: "string" },
      tier: { type: "string" },
      suites: { type: "string" },
      "max-usd": { type: "string" },
      "approve-metered-usd": { type: "string" },
      out: { type: "string" },
    },
  });
  if (values.suite !== undefined && values.suite !== "smoke")
    throw new EvalRefusal(`--suite takes "smoke" (the tier suites are chosen with --tier / --suites)`, 2);
  if (values.tier !== undefined && !(values.tier in TIERS)) throw new EvalRefusal(`--tier must be quick, standard or full`, 2);
  const num = (v: string | undefined, name: string): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new EvalRefusal(`--${name} must be a positive number`, 2);
    return n;
  };
  const maxUsd = num(values["max-usd"], "max-usd");
  const approve = num(values["approve-metered-usd"], "approve-metered-usd");
  const outcome = await runEval({
    ...(values.suite === "smoke" ? { suite: "smoke" as const } : {}),
    ...(values.tier ? { tier: values.tier as Tier } : {}),
    ...(values.suites ? { suites: values.suites.split(",").filter(Boolean) } : {}),
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(approve !== undefined ? { approveMeteredUsd: approve } : {}),
    ...(values.out ? { out: values.out } : {}),
  });
  console.log(outcome.message);
  return outcome.exit;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`eval: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = err instanceof EvalRefusal ? err.exit : EXIT.usage;
  }
}
