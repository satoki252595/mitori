// Child processes of the `process`-mode cases (testing spec §6.2: every cold run is a fresh `bun bench/runners/<x>.ts`),
// and a memo that lets several budgets read the same cold runs (react's S0–S4 time, peak RSS, persistence and S3 come
// from one scan each — four budgets, one set of runs).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchContext } from "../runner/define.ts";

export const BENCH_DIR = join(import.meta.dir, "..");
export const REPO_ROOT = join(BENCH_DIR, "..");

/** Run `bun <script> ...args` and parse the last stdout line as JSON; a non-zero exit throws with the child's stderr. */
export async function runJson<T>(script: string, args: readonly string[], env: Record<string, string> = {}): Promise<T> {
  const proc = Bun.spawn([process.execPath, script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${script.split("/").pop()} exited ${code}: ${err.trim().split("\n").slice(-6).join(" | ")}`);
  const last = out.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(last) as T;
  } catch {
    throw new Error(`${script.split("/").pop()}: no JSON result (${last.slice(0, 200)})`);
  }
}

/** A scratch directory removed by `dispose` (cold runs that are shared between cases manage their own homes). */
export function scratch(prefix: string): { dir: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), `mitori-bench-${prefix}-`));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

const shared = new Map<string, Promise<unknown>[]>();

/**
 * The `ctx.run`-th measured run (or the discarded warm-up) of a cold measurement shared by several cases of this
 * process: the first case to ask runs it, the others reuse the same sample. Index 0 is the page-cache warm-up.
 */
export function sharedRun<T>(key: string, ctx: BenchContext, once: () => Promise<T>): Promise<T> {
  const runs = shared.get(key) ?? [];
  shared.set(key, runs);
  const i = ctx.warmup ? 0 : ctx.run + 1;
  while (runs.length <= i) runs.push(null as unknown as Promise<unknown>);
  runs[i] ??= once();
  return runs[i] as Promise<T>;
}
