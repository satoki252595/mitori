// Measuring one case of one tree in a child process: head's runner with `--root <tree>`, so a base that predates the
// runner can still be measured and a fresh process isolates every sample set (§6.7).
import { join } from "node:path";
import type { BenchMode } from "../runner/define.ts";
import type { BenchResultEntry, BenchResultFile } from "../runner/result.ts";

export interface Side {
  name: "base" | "head";
  /** The tree whose bench files are measured. */
  root: string;
  /** Extra environment for the child (`--head-env KEY=VAL`). */
  env: Readonly<Record<string, string>>;
  sha: string;
}

export interface ListedCase {
  id: string;
  suite: string;
  mode: BenchMode;
  unit: string;
}

export interface ChildRun {
  entry: BenchResultEntry;
  counters: { id: string; value: number }[];
  file: BenchResultFile;
}

/** The seam the orchestrator measures through (tests substitute a deterministic one). */
export interface CaseRunner {
  /** Cases of a tree. A tree whose bench files cannot be loaded lists nothing (and says why via `warn`). */
  list(side: Side, selection: { suites: readonly string[]; ids: readonly string[] }, warn: (m: string) => void): Promise<ListedCase[]>;
  /** One fresh-process run of one case. */
  run(side: Side, id: string): Promise<ChildRun>;
}

async function exec(argv: readonly string[], cwd: string, env: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([...argv], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

export function processRunner(opts: { runnerRoot: string; factor: number; runs?: number }): CaseRunner {
  const script = join(opts.runnerRoot, "bench/runner/run.ts");
  return {
    async list(side, sel, warn) {
      const args = ["bun", script, "--root", side.root, "--list", "--json"];
      if (sel.suites.length) args.push("--suite", sel.suites.join(","));
      for (const id of sel.ids) args.push("--id", id);
      const r = await exec(args, side.root, { ...side.env });
      if (r.code !== 0) {
        // exit 2 with "no case matches" is an empty tree, anything else is a load failure
        if (!/no case matches|no bench cases/.test(r.out + r.err))
          warn(`${side.name}: could not list bench cases: ${(r.err || r.out).trim().split("\n").slice(-3).join(" | ")}`);
        return [];
      }
      return JSON.parse(r.out) as ListedCase[];
    },
    async run(side, id) {
      const args = ["bun", script, "--root", side.root, "--id", id, "--exact", "--json", "--no-wait", "--factor", String(opts.factor)];
      if (opts.runs !== undefined) args.push("--runs", String(opts.runs));
      const r = await exec(args, side.root, { ...side.env });
      let file: BenchResultFile;
      try {
        file = JSON.parse(r.out) as BenchResultFile;
      } catch {
        throw new Error(`${side.name} ${id}: runner produced no result (exit ${r.code}): ${(r.err || r.out).trim().split("\n").slice(-4).join(" | ")}`);
      }
      const entry = file.results.find((e) => e.id === id);
      if (!entry) throw new Error(`${side.name} ${id}: the runner did not report this case`);
      return { entry, counters: file.counters, file };
    },
  };
}
