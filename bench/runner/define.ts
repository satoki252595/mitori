// `defineBench` — the shape of every `bench/**/*.bench.ts` case (testing spec §6.2). A bench file exports one or more
// `defineBench({...})` values; the runner finds them by the brand, so a file may export any number of cases.
import type { Samples } from "@mitori/testkit";

export type BenchMode = "inproc" | "process";

/** Suites a case may belong to. `synthetic` is the harness's own self-test and never part of `--suite all`. */
export const SUITES = ["idx", "doc", "loop", "srv", "cli", "ui", "asset", "dev", "synthetic"] as const;
export type BenchSuite = (typeof SUITES)[number];

export interface BenchContext {
  /** The case id. */
  readonly id: string;
  /** Absolute path of the repository the case measures (corpus clone or built fixture), when it declares `repo`. */
  readonly repo: string | undefined;
  /**
   * An empty directory for this run, removed afterwards. `process` cases get a fresh one per run (pass it as the
   * child's `MITORI_HOME` so mitori is cold); `inproc` cases get one for the whole case.
   */
  readonly home: string;
  /** Zero-based index of the run (warm-up runs count from 0 as well). */
  readonly run: number;
  /** True while the run is a discarded warm-up. */
  readonly warmup: boolean;
}

export interface BenchDef<S = void> {
  /** Measurement id — the budget id when the case feeds a budget (`idx.s01.cold.100kloc`). */
  id: string;
  suite: BenchSuite;
  /** `inproc`: micro cases, warm-up 3 / runs 15 (more until 1 s of work). `process`: cold cases, warm-up 1 / runs 5. */
  mode: BenchMode;
  /** Unit of the samples (default `ms`). Must match the budget's unit. */
  unit?: Samples["unit"];
  /** Requires an explicitly authorized real engine artifact; excluded from routine runs. */
  live?: boolean;
  /** Corpus or fixture name; the runner resolves it to a path (see repos.ts). */
  repo?: string;
  runs?: number;
  warmup?: number;
  /** Which statistic of the samples is compared with the budget (default `median`; use `p95` for p95 budgets). */
  budgetStat?: "median" | "p95";
  /** Once per case, before the first run. */
  setup?(ctx: BenchContext): S | Promise<S>;
  /**
   * One measured iteration. Return a number to report it as the sample (RSS, bytes, a child's own timing);
   * return anything else (nothing) to report the wall time of the call in ms.
   */
  run(state: S, ctx: BenchContext): unknown;
  teardown?(state: S, ctx: BenchContext): void | Promise<void>;
  /** Deterministic counters (`budgets.counters[].id` → value), read once after the last run. */
  counters?(state: S): Record<string, number> | Promise<Record<string, number>>;
}

/** `Symbol.for`, so a case defined by a base checkout's copy of this module is still recognised by head's runner. */
export const BENCH_BRAND: unique symbol = Symbol.for("mitori.bench");

export type DefinedBench<S = void> = BenchDef<S> & { readonly [BENCH_BRAND]: true };

export function defineBench<S = void>(def: BenchDef<S>): DefinedBench<S> {
  if (!/^[a-z][a-z0-9]*(\.[A-Za-z0-9_:-]+)+$/.test(def.id)) throw new Error(`bench id "${def.id}" must be a dotted lower-case id (e.g. idx.s01.cold.100kloc)`);
  if (!(SUITES as readonly string[]).includes(def.suite)) throw new Error(`bench ${def.id}: unknown suite "${def.suite}"`);
  return Object.freeze({ ...def, [BENCH_BRAND]: true as const });
}

/** A loosely typed case as the runner handles them (state type erased). */
export type AnyBench = BenchDef<unknown> & { readonly [BENCH_BRAND]: true };

export function isBenchDef(x: unknown): x is AnyBench {
  return typeof x === "object" && x !== null && (x as Record<symbol, unknown>)[Symbol.for("mitori.bench")] === true;
}

/** Wall time of a child process in ms plus its stdout; for `process` cases that time a whole mitori invocation. */
export async function timedSpawn(
  argv: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ ms: number; stdout: string; code: number }> {
  const t0 = performance.now();
  const proc = Bun.spawn([...argv], {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { ms: performance.now() - t0, stdout, code };
}
