// One cold indexer measurement in a fresh process (testing spec §6.2 `process` mode: new process, empty MITORI_HOME,
// new index.sqlite, new Worker pool; the OS page cache is warmed by the case's discarded first run). Prints one JSON
// line on stdout:
//   bun bench/runners/idx-cold.ts --repo <dir> --home <dir> [--until S1|S4] [--shadow] [--idle-ms <n>] [--structure]
// `--idle-ms` (idx.rss.idle, indexer spec §3.1: "60 s 無操作で Worker 0 本 → idle RSS 寄与 0"): after the scan and its
// background persistence, stay idle that long, then report how much RSS terminating the parse Workers by hand still frees
// (0 when the pool's own idle shrink released them) and how many Workers were still alive.
// `--structure` (idx.pack.tokens, idx.module.sig.tokens, idx.leaf.loc): the repo pack, every leaf's sig skeleton and
// the leaf LOC distribution of the scanned repository.
import { parseArgs } from "node:util";
import { benchIndexer, rssSampler, settled } from "../lib/indexer.ts";

export interface ColdResult {
  /** Wall time of `scan()` (to `scan.done`), ms. */
  ms: number;
  /** ScanTimings of the run (stage breakdown, Worker count, parse / cache counts). */
  timings: Record<string, number | null>;
  /** Peak RSS during the scan, MB (2^20). */
  rssPeakMB: number;
  /** RSS the parse Workers still held after the idle period, MB (only with --idle-ms). */
  rssIdleMB?: number;
  /** Parse Workers alive after the idle period (only with --idle-ms). */
  workersAfterIdle?: number;
  files: number;
  included: number;
  structure?: {
    packTokens: number;
    leaves: number;
    /** Largest sig skeleton of a leaf module (no budget given), tokens, and that leaf's slug and LOC. */
    sigTokensMax: number;
    sigTokensMaxLeaf: string;
    sigTokensMaxLoc: number;
    leafLoc: { median: number; p10: number; p90: number };
  };
}

const MB = 1_048_576;

/** RSS after a full GC, the lowest of the samples taken until it stops falling (the allocator returns pages lazily). */
async function settledRss(): Promise<number> {
  Bun.gc(true);
  let low = process.memoryUsage().rss;
  for (let k = 0, still = 0; k < 40 && still < 3; k++) {
    await Bun.sleep(50);
    const v = process.memoryUsage().rss;
    if (v < low) {
      low = v;
      still = 0;
    } else still++;
  }
  return low;
}

const quantile = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] as number);
};

async function main(): Promise<ColdResult> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: "string" },
      home: { type: "string" },
      until: { type: "string" },
      shadow: { type: "boolean" },
      "idle-ms": { type: "string" },
      structure: { type: "boolean" },
    },
  });
  if (!values.repo || !values.home) throw new Error("--repo and --home are required");
  const idle = values["idle-ms"] ? Number(values["idle-ms"]) : null;
  const b = await benchIndexer({ root: values.repo, home: values.home, shadow: values.shadow ?? false });
  const rss = rssSampler();
  const t0 = performance.now();
  const sum = await b.idx.scan({ reason: "bench", ...(values.until === "S1" ? { until: "S1" as const } : {}) });
  const ms = performance.now() - t0;
  const peak = rss.stop();
  await settled(b.idx);
  const out: ColdResult = {
    ms,
    timings: { ...(b.idx.lastTimings() as unknown as Record<string, number | null>) },
    rssPeakMB: peak / MB,
    files: sum.files,
    included: sum.included,
  };
  if (values.structure) {
    const leaves = b.idx.modules().filter((m) => m.children.length === 0);
    const sig = leaves.map((m) => b.idx.skeleton({ kind: "module", module: m.id }, "sig", "claude-v5").tokens);
    const locs = leaves.map((m) => m.loc);
    const top = sig.indexOf(Math.max(...sig));
    out.structure = {
      packTokens: b.idx.repoPack({ tokenizer: "claude-v5" }).tokens,
      leaves: leaves.length,
      sigTokensMax: sig.length ? Math.max(...sig) : 0,
      sigTokensMaxLeaf: leaves[top]?.slug ?? "",
      sigTokensMaxLoc: leaves[top]?.loc ?? 0,
      leafLoc: { median: quantile(locs, 0.5), p10: quantile(locs, 0.1), p90: quantile(locs, 0.9) },
    };
  }
  if (idle !== null) {
    await Bun.sleep(idle);
    out.workersAfterIdle = b.workers();
    const afterIdle = await settledRss();
    await b.shrinkWorkers();
    const afterShrink = await settledRss();
    out.rssIdleMB = Math.max(0, (afterIdle - afterShrink) / MB);
  }
  await b.close();
  return out;
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await main()));
    process.exit(0);
  } catch (err) {
    console.error(`idx-cold: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  }
}
