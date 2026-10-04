// Run one bench case: setup → warm-up → measured runs → counters → teardown (testing spec §6.2).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyBench, BenchContext } from "./define.ts";
import type { BenchResultEntry } from "./result.ts";
import { toSamples } from "./stats.ts";

/** `inproc` cases without an explicit run count keep sampling until this much work has been measured. */
const MICRO_MIN_TOTAL_MS = 1000;
const MICRO_MAX_RUNS = 5000;
/** How long after its teardown a case's stray rejections still count as the case's. */
const STRAY_GRACE_MS = 25;

export interface ExecuteOptions {
  /** Overrides of the case's own run/warm-up counts (CLI `--runs` / `--warmup`). */
  runs?: number;
  warmup?: number;
  /** Where to create per-run scratch directories (default: the OS temp dir). */
  tmp?: string;
  resolveRepo(name: string): Promise<{ path: string; dispose(): Promise<void> }>;
}

export interface CaseOutcome {
  entry: BenchResultEntry;
  counters: { id: string; value: number }[];
}

/**
 * A case whose run starts work it does not wait for (`run: () => void somethingAsync()`) is timed for the start of that
 * work only, and the work fails later in the background. Rejections nobody handles while the case runs (setup to
 * teardown) therefore turn the case into an error instead of a number.
 */
export async function executeCase(def: AnyBench, opts: ExecuteOptions): Promise<CaseOutcome> {
  const stray: unknown[] = [];
  const onStray = (reason: unknown) => void stray.push(reason);
  process.on("unhandledRejection", onStray);
  try {
    const out = await runCase(def, opts);
    // work the runs left behind fails soon after the teardown removed what it used: a short grace catches it
    await new Promise((r) => setTimeout(r, STRAY_GRACE_MS));
    if (stray.length === 0 || out.entry.error !== undefined) return out;
    const first = stray[0] instanceof Error ? stray[0].message : String(stray[0]);
    const error = `${stray.length} unhandled rejection(s) while the case ran — work its run did not await? First: ${first}`;
    return { entry: { ...toSamples(def.id, out.entry.unit, []), ...stripSamples(out.entry), error }, counters: [] };
  } finally {
    process.off("unhandledRejection", onStray);
  }
}

const stripSamples = (e: BenchResultEntry) => ({ suite: e.suite, mode: e.mode, budgetStat: e.budgetStat, ...(e.repo ? { repo: e.repo } : {}) });

async function runCase(def: AnyBench, opts: ExecuteOptions): Promise<CaseOutcome> {
  const unit = def.unit ?? "ms";
  const base = { suite: def.suite, mode: def.mode, budgetStat: def.budgetStat ?? "median", ...(def.repo ? { repo: def.repo } : {}) } as const;
  const scratch = await mkdtemp(join(opts.tmp ?? tmpdir(), "mitori-bench-"));
  let repo: Awaited<ReturnType<ExecuteOptions["resolveRepo"]>> | undefined;
  let state: unknown;
  let setUp = false;
  let ctx: BenchContext | undefined;
  const values: number[] = [];
  let counters: { id: string; value: number }[] = [];
  try {
    repo = def.repo ? await opts.resolveRepo(def.repo) : undefined;
    const cold = def.mode === "process";
    const warmup = opts.warmup ?? def.warmup ?? (cold ? 1 : 3);
    const explicit = opts.runs ?? def.runs;
    const runs = explicit ?? (cold ? 5 : 15);
    const caseHome = join(scratch, "case");
    await Bun.write(join(caseHome, ".keep"), "");
    const makeCtx = (run: number, isWarmup: boolean, home: string): BenchContext => ({ id: def.id, repo: repo?.path, home, run, warmup: isWarmup });
    ctx = makeCtx(0, false, caseHome);
    state = await def.setup?.(ctx);
    setUp = true;

    const once = async (run: number, isWarmup: boolean): Promise<number> => {
      let home = caseHome;
      if (cold) {
        home = join(scratch, `run-${isWarmup ? "w" : "m"}${run}`);
        await Bun.write(join(home, ".keep"), "");
      }
      const t0 = performance.now();
      const r = await def.run(state, makeCtx(run, isWarmup, home));
      const ms = performance.now() - t0;
      if (cold) await rm(home, { recursive: true, force: true });
      return typeof r === "number" ? r : ms;
    };

    for (let i = 0; i < warmup; i++) await once(i, true);
    let total = 0;
    while (values.length < runs || (explicit === undefined && !cold && unit === "ms" && total < MICRO_MIN_TOTAL_MS && values.length < MICRO_MAX_RUNS)) {
      const v = await once(values.length, false);
      values.push(v);
      total += v;
    }
    const c = await def.counters?.(state);
    counters = Object.entries(c ?? {}).map(([id, value]) => ({ id, value }));
    return { entry: { ...toSamples(def.id, unit, values), ...base }, counters };
  } catch (err) {
    return {
      entry: { ...toSamples(def.id, unit, []), ...base, error: err instanceof Error ? err.message : String(err) },
      counters: [],
    };
  } finally {
    try {
      if (setUp && ctx) await def.teardown?.(state, ctx);
    } finally {
      await repo?.dispose();
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
