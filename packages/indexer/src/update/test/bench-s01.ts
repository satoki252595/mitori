// S0–S1 bench (indexer spec §11.2–11.3; budgets `idx.s01.cold.*`, `idx.warm.rescan*`, `idx.update.1file`,
// `idx.rss.peak`, counters `idx.warm.*`). Until WP-12's `bench/runner` exists this is the runner:
//   scripts/nd bun packages/indexer/src/update/test/bench-s01.ts [--repos crit,m3e-canvas,hono,gostd] [--runs 5] [--json out.jsonl]
// Cold = a fresh child process, a new in-memory DB and new Workers (one discarded run warms the OS page cache);
// warm = 5 unchanged rescans after the cold scan; update = 20 single-file body edits on a copy of crit.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { MetricName } from "@mitori/core";
import { INVENTORY_SETS, type Indexer } from "../../contract.ts";
import { bunWorkerPool } from "../../parse/test/bun-pool.ts";
import { corpusDir } from "../../parse/test/corpus.ts";
import { REPO_ROOT, workerInit } from "../../parse/test/env.ts";
import { createIndexer } from "../index.ts";
import { testDeps } from "./deps.ts";
import { cliGit } from "./git.ts";

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

interface ColdResult {
  ms: number;
  s0: number;
  s1: number;
  rssMB: number;
  files: number;
  parsed: number;
  workers: number;
  minified: string[];
}

interface FullResult extends ColdResult {
  warmMs: number[];
  warmCounters: Record<string, number>;
  updateMs?: number[];
}

const perfCores = (() => {
  const r = Bun.spawnSync(["sysctl", "-n", "hw.perflevel0.logicalcpu"]);
  const n = Number(new TextDecoder().decode(r.stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
})();

function workspace(name: string): { root: string; git: ReturnType<typeof cliGit>; kind: "git" | "shadow" } {
  const root = corpusDir(name);
  if (root === null) throw new Error(`corpus ${name} not available (bun run corpus:fetch)`);
  if (name !== "gostd") return { root, git: cliGit(root), kind: "git" };
  // Shadow repository (spec §2.1-b): GIT_DIR outside the user's directory; nothing is written into it.
  const gitDir = join(process.env.MITORI_BENCH_DIR ?? join(homedir(), ".cache", "mitori-bench"), "gostd-shadow.git");
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: root };
  const run = (a: string[]) => Bun.spawnSync(["git", ...a], { env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (run(["rev-parse", "--git-dir"]).exitCode !== 0) {
    mkdirSync(gitDir, { recursive: true });
    run(["init", "--quiet", "--object-format=sha1"]);
    for (const [k, v] of [
      ["core.untrackedCache", "true"],
      ["core.fsmonitor", "false"],
      ["core.quotepath", "off"],
    ] as const)
      run(["config", k, v]);
    mkdirSync(join(gitDir, "info"), { recursive: true });
    writeFileSync(join(gitDir, "info/exclude"), `${INVENTORY_SETS.shadowExcludes.join("\n")}\n`);
    run(["update-index", "--untracked-cache"]);
    run(["status", "--porcelain"]);
  }
  return { root, git: cliGit(root, env), kind: "shadow" };
}

function newIndexer(name: string): { idx: Indexer; deps: ReturnType<typeof testDeps> } {
  const ws = workspace(name);
  const deps = testDeps(ws.root, { git: ws.git, pool: bunWorkerPool(workerInit()), kind: ws.kind });
  deps.hardware = { cores: availableParallelism(), perfCores };
  return { idx: createIndexer(deps), deps };
}

async function cold(name: string): Promise<{ r: ColdResult; idx: Indexer; deps: ReturnType<typeof testDeps> }> {
  const { idx, deps } = newIndexer(name);
  let peak = process.memoryUsage().rss;
  const iv = setInterval(() => {
    const v = process.memoryUsage().rss;
    if (v > peak) peak = v;
  }, 10);
  const t0 = performance.now();
  const sum = await idx.scan({ until: "S1", reason: "bench" });
  const ms = performance.now() - t0;
  clearInterval(iv);
  const t = idx.lastTimings();
  const minified = idx
    .files({ includeExcluded: true })
    .filter((f) => f.excluded === "minified")
    .map((f) => f.path);
  return {
    r: { ms, s0: t?.s0 ?? 0, s1: t?.s1 ?? 0, rssMB: peak / 1_048_576, files: sum.files, parsed: t?.filesParsed ?? 0, workers: t?.workers ?? 0, minified },
    idx,
    deps,
  };
}

async function settle(idx: Indexer): Promise<void> {
  for (let i = 0; i < 400 && idx.lastTimings()?.persist === null; i++) await Bun.sleep(25);
}

async function child(name: string, mode: "cold" | "full"): Promise<ColdResult | FullResult> {
  const { r, idx, deps } = await cold(name);
  if (mode === "cold") {
    await idx.close();
    return r;
  }
  await settle(idx);
  for (const k of ["idx.parse.calls", "idx.files.hashed", "idx.sql.writes"] as MetricName[]) deps.counters.set(k, 0);
  const warmMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await idx.scan({ until: "S1", reason: "bench" });
    warmMs.push(performance.now() - t0);
  }
  await settle(idx);
  const warmCounters = {
    parseCalls: deps.counters.get("idx.parse.calls") ?? 0,
    filesHashed: deps.counters.get("idx.files.hashed") ?? 0,
    sqlWrites: deps.counters.get("idx.sql.writes") ?? 0,
  };
  await idx.close();
  const out: FullResult = { ...r, warmMs, warmCounters };
  if (name === "crit") out.updateMs = await updateBench();
  return out;
}

/** 20 body-only edits of a function in a copy of crit (spec §11.2-(3)). */
async function updateBench(): Promise<number[]> {
  const src = corpusDir("crit") as string;
  const dir = mkdtempSync(join(tmpdir(), "mitori-bench-crit-"));
  try {
    cpSync(src, dir, { recursive: true, verbatimSymlinks: true });
    const deps = testDeps(dir, { git: cliGit(dir), pool: bunWorkerPool(workerInit()) });
    deps.hardware = { cores: availableParallelism(), perfCores };
    const idx = createIndexer(deps);
    await idx.scan({ until: "S1", reason: "bench" });
    await settle(idx);
    const rel = "internal/diff/diff.go";
    const original = readFileSync(join(dir, rel), "utf8");
    const lines = original.split("\n");
    const at = lines.findIndex((l) => l.startsWith("func ComputeLineDiff(")) + 1;
    const ms: number[] = [];
    for (let i = 0; i < 21; i++) {
      const edited = [...lines.slice(0, at), `\t_ = ${i} // bench edit`, ...lines.slice(at)].join("\n");
      writeFileSync(join(dir, rel), edited);
      const t0 = performance.now();
      const d = await idx.update([{ kind: "change", path: rel }]);
      const dt = performance.now() - t0;
      if (d.changed.length !== 1) throw new Error("update did not register the edit");
      if (i > 0) ms.push(dt); // the first update warms the Worker's grammar/query for Go
    }
    await idx.close();
    return ms;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0
    ? Number.NaN
    : s.length % 2 === 1
      ? (s[(s.length - 1) >> 1] as number)
      : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? Number.NaN;
};

const BUDGETS = JSON.parse(readFileSync(join(REPO_ROOT, "bench/budgets/indexer.json"), "utf8")) as { budgets: { id: string; target: number; limit: number }[] };
const budget = (id: string) => BUDGETS.budgets.find((b) => b.id === id);
const verdict = (id: string, v: number): string => {
  const b = budget(id);
  if (b === undefined) return "";
  return v <= b.target ? `✓ target ${b.target}` : v <= b.limit ? `△ within limit ${b.limit} (target ${b.target})` : `✗ over limit ${b.limit}`;
};

async function parent(): Promise<void> {
  const repos = (arg("--repos") ?? "crit,m3e-canvas,hono,gostd").split(",");
  const runs = Number(arg("--runs") ?? 5);
  const self = new URL(import.meta.url).pathname;
  const spawnChild = (repo: string, mode: "cold" | "full"): ColdResult | FullResult => {
    const p = Bun.spawnSync(["bun", self, "--child", mode, "--repo", repo], { cwd: REPO_ROOT, stderr: "inherit" });
    if (p.exitCode !== 0) throw new Error(`child ${repo}/${mode} failed`);
    const text = new TextDecoder().decode(p.stdout).trim().split("\n").pop() as string;
    return JSON.parse(text) as ColdResult | FullResult;
  };
  const cpu = cpus()[0]?.model ?? "?";
  console.log(
    `machine: ${cpu} cores=${availableParallelism()} perfCores=${perfCores ?? "?"} bun=${Bun.version} load=${(await import("node:os")).loadavg()[0]?.toFixed(2)}`,
  );
  const lines: string[] = [];
  for (const repo of repos) {
    if (corpusDir(repo) === null) {
      console.log(`${repo}: corpus not available — skipped`);
      continue;
    }
    spawnChild(repo, "cold"); // discarded: warms the OS page cache
    const colds: ColdResult[] = [];
    for (let i = 0; i < runs - 1; i++) colds.push(spawnChild(repo, "cold"));
    const full = spawnChild(repo, "full") as FullResult;
    colds.push(full);
    const coldMs = colds.map((c) => c.ms);
    const rss = Math.max(...colds.map((c) => c.rssMB));
    const id = repo === "gostd" ? "idx.s01.cold.7kfiles" : repo === "crit" ? "idx.s01.cold.100kloc" : null;
    const warmId = repo === "gostd" ? "idx.warm.rescan.7k" : repo === "crit" ? "idx.warm.rescan" : null;
    const m = median(coldMs);
    const w = median(full.warmMs);
    console.log(
      `${repo.padEnd(11)} cold S0–S1 median ${m.toFixed(0)} ms (runs ${coldMs.map((x) => x.toFixed(0)).join(",")}; S0 ${full.s0.toFixed(0)} / S1 ${full.s1.toFixed(0)} ms; files ${full.files}, parsed ${full.parsed}, W=${full.workers}) ${id ? verdict(id, m) : ""}`,
    );
    console.log(
      `${"".padEnd(11)} warm rescan median ${w.toFixed(1)} ms (${full.warmMs.map((x) => x.toFixed(1)).join(",")}) ${warmId ? verdict(warmId, w) : ""} counters ${JSON.stringify(full.warmCounters)}`,
    );
    console.log(
      `${"".padEnd(11)} peak RSS ${rss.toFixed(0)} MB ${verdict("idx.rss.peak", rss)}; minified excluded at S0/S0b: ${full.minified.length}${full.minified.length > 0 ? ` (${full.minified.slice(0, 4).join(", ")}${full.minified.length > 4 ? ", …" : ""})` : ""}`,
    );
    if (full.updateMs !== undefined)
      console.log(
        `${"".padEnd(11)} update() 1 file median ${median(full.updateMs).toFixed(1)} ms p95 ${p95(full.updateMs).toFixed(1)} ms ${verdict("idx.update.1file", median(full.updateMs))}`,
      );
    lines.push(
      JSON.stringify({
        repo,
        coldMs,
        warmMs: full.warmMs,
        rssMB: rss,
        updateMs: full.updateMs ?? null,
        counters: full.warmCounters,
        files: full.files,
        parsed: full.parsed,
        workers: full.workers,
      }),
    );
  }
  const out = arg("--json");
  if (out !== undefined) writeFileSync(out, `${lines.join("\n")}\n`);
}

if (args.includes("--child")) {
  const mode = arg("--child") as "cold" | "full";
  const repo = arg("--repo") as string;
  const r = await child(repo, mode);
  console.log(JSON.stringify(r));
  process.exit(0);
} else await parent();
