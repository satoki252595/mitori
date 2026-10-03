// IDX-AT-14 helper, run in a child process so the RSS is this workload's alone: parse crit's Go `passes` times in one
// Worker handler (GC after each pass) and print `{ rss: number[], parses, deletes }` as JSON.
//   bun packages/indexer/src/update/test/rss-passes.ts <root> [passes]
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { env, workerInit } from "../../parse/test/env.ts";
import { createWorkerHandler } from "../../parse/worker.ts";

const root = process.argv[2] as string;
const passes = Number(process.argv[3] ?? 10);
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== "testdata") walk(p);
    } else if (e.name.endsWith(".go")) files.push(p);
  }
};
for (const top of ["cmd", "internal"]) walk(join(root, top));
files.sort();
const h = await createWorkerHandler(env, workerInit());
const items = files.map((abs) => ({
  path: relative(root, abs),
  abs,
  size: statSync(abs).size,
  lang: "go" as const,
  grammar: "go" as const,
  profile: "full" as const,
  knownBlob: null,
  detectors: [],
  provisionalClass: "source" as const,
  scope: "main" as const,
}));
const rss: number[] = [];
for (let pass = 0; pass < passes; pass++) {
  for (let i = 0; i < items.length; i += 64) await h.handle({ id: pass * 1_000 + i, items: items.slice(i, i + 64) });
  Bun.gc(true);
  rss.push(process.memoryUsage().rss);
}
const { parses, deletes } = h.stats();
h.dispose();
console.log(JSON.stringify({ rss, parses, deletes }));
