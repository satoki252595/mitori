// One cold scan with a breakdown (perf track): an in-thread Worker handler (`--workers 0`, for `bun --cpu-prof`) or
// real Bun Workers. Prints one JSON line: wall, S0/S1(/S2–S4 with --s4), the time between `scan.done` and scan()
// resolving, the Workers' summed read/parse/query/extract ms and the peak RSS (10 ms samples).
//   scripts/nd bun --cpu-prof --cpu-prof-dir <dir> packages/indexer/src/update/test/prof-s1.ts --repo gostd
//   scripts/nd bun packages/indexer/src/update/test/prof-s1.ts --repo crit --workers 6 [--s4] [--profiles] [--mem]
// `MITORI_WASM_SHARE=0` loads the wasm from bytes in every Worker (production today); `MITORI_POOL_TRACE=1` /
// `MITORI_WORKER_TRACE=1` log the pool and the Workers.
import { homedir } from "node:os";
import { join } from "node:path";
import { createGitReader } from "@mitori/platform";
import type { ParseBatchRequest, ParseBatchResponse } from "../../contract.ts";
import { bunWorkerPool } from "../../parse/test/bun-pool.ts";
import { corpusDir } from "../../parse/test/corpus.ts";
import { workerInit } from "../../parse/test/env.ts";
import { createIndexer } from "../index.ts";
import { inlinePool, testDeps } from "./deps.ts";
import { footprint } from "./footprint.ts";
import { cliGit, shadowGit } from "./git.ts";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? (args[args.indexOf(k) + 1] as string) : d);
const repo = arg("--repo", "crit");
const workers = Number(arg("--workers", "0"));
const root = corpusDir(repo);
if (root === null) throw new Error(`corpus ${repo} not available (bun run corpus:fetch)`);
const shadowDir = join(homedir(), ".cache", "mitori-bench", "gostd-shadow.git");
const testGit = repo === "gostd" ? shadowGit(root, shadowDir) : cliGit(root);
// `--reader platform`: the production GitReader (its status walks untracked files too; lsFiles is one process)
const git =
  arg("--reader", "test") === "platform"
    ? (createGitReader({
        workTree: root,
        ...(repo === "gostd" ? { gitDir: shadowDir } : {}),
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      }) as unknown as typeof testGit)
    : testGit;
const base = workers === 0 ? inlinePool() : bunWorkerPool(workerInit());
const ms = { read: 0, hash: 0, parse: 0, query: 0, extract: 0 };
const profiles = new Map<string, { files: number; bytes: number }>();
let batches = 0;
const pool = (n: number) => {
  const p = base(n);
  return {
    ...p,
    async run(req: ParseBatchRequest): Promise<ParseBatchResponse> {
      for (const it of req.items) {
        const k = `${it.profile}:${it.grammar ?? "-"}`;
        const e = profiles.get(k) ?? { files: 0, bytes: 0 };
        e.files++;
        e.bytes += it.size;
        profiles.set(k, e);
      }
      const r = await p.run(req);
      batches++;
      for (const k of Object.keys(ms) as (keyof typeof ms)[]) ms[k] += r.ms[k];
      return r;
    },
  };
};
const deps = testDeps(root, { git, pool, kind: repo === "gostd" ? "shadow" : "git" });
deps.hardware = workers === 0 ? { cores: 1, perfCores: 1 } : { cores: 18, perfCores: workers };
let doneAt = 0;
const emit = deps.events.emit;
deps.events.emit = (e) => {
  if (e.type === "scan.done") doneAt = performance.now();
  emit(e);
};
const idx = createIndexer(deps);
let peak = process.memoryUsage().rss;
const iv = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 10);
const t0 = performance.now();
await idx.scan(args.includes("--s4") ? { reason: "bench" } : { until: "S1", reason: "bench" });
const end = performance.now();
clearInterval(iv);
const t = idx.lastTimings();
const r = (x: number | undefined) => Math.round(x ?? 0);
console.log(
  JSON.stringify({
    total: r(end - t0),
    afterDone: r(end - doneAt),
    s0: r(t?.s0),
    s1: r(t?.s1),
    s2: r(t?.s2),
    s3: r(t?.s3),
    s4: r(t?.s4),
    parsed: t?.filesParsed,
    W: t?.workers,
    batches,
    rssMB: r(peak / 1_048_576),
    peakFootprintMB: r((footprint()?.peakFootprint ?? 0) / 1_048_576),
    ms: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, r(v)])),
  }),
);
if (args.includes("--profiles")) for (const [k, v] of profiles) console.log(k, v.files, (v.bytes / 1_048_576).toFixed(1), "MB");
if (args.includes("--mem")) {
  const jsc = require("bun:jsc") as { heapStats(): { heapSize: number; objectTypeCounts: Record<string, number> } };
  const before = process.memoryUsage();
  Bun.gc(true);
  const hs = jsc.heapStats();
  const mb = (x: number) => (x / 1_048_576).toFixed(0);
  console.log(`main thread: rss ${mb(before.rss)} MB, heap ${mb(before.heapUsed)} → ${mb(hs.heapSize)} MB after GC`);
  console.log(
    Object.entries(hs.objectTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `${k}:${v}`)
      .join(" "),
  );
}
await idx.close();
process.exit(0);
