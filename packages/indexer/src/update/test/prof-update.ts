// update() profile on a copy of crit: a full S0–S4 scan, then N body edits of one function; prints the split between
// the S0/S1 part (facade) and the later stages (S2–S4 update). Run with `bun --cpu-prof` for the call tree.
//   scripts/nd bun packages/indexer/src/update/test/prof-update.ts [--runs 20] [--until S1] [--path internal/diff/diff.go]
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { bunWorkerPool } from "../../parse/test/bun-pool.ts";
import { corpusDir } from "../../parse/test/corpus.ts";
import { workerInit } from "../../parse/test/env.ts";
import { createIndexerWith } from "./../facade.ts";
import { defaultStagesFactory, type LaterStages } from "../stages.ts";
import { testDeps } from "./deps.ts";
import { cliGit } from "./git.ts";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? (args[args.indexOf(k) + 1] as string) : d);
const runs = Number(arg("--runs", "20"));
const rel = arg("--path", "internal/diff/diff.go");
const anchor = arg("--anchor", "func ComputeLineDiff(");
const src = corpusDir(arg("--repo", "crit")) as string;
const dir = mkdtempSync(join(tmpdir(), "mitori-prof-update-"));
try {
  cpSync(src, dir, { recursive: true, verbatimSymlinks: true });
  const deps = testDeps(dir, { git: cliGit(dir), pool: bunWorkerPool(workerInit()) });
  deps.hardware = { cores: availableParallelism(), perfCores: 6 };
  let laterMs = 0;
  const idx = createIndexerWith(deps, (view) => {
    const s: LaterStages = defaultStagesFactory(view);
    return {
      ...s,
      async update(changed) {
        const t0 = performance.now();
        const r = await s.update(changed);
        laterMs += performance.now() - t0;
        return r;
      },
    };
  });
  await idx.scan({ reason: "bench" });
  for (let i = 0; i < 400 && idx.lastTimings()?.persist === null; i++) await Bun.sleep(25);
  await Bun.sleep(300);
  const original = readFileSync(join(dir, rel), "utf8");
  const lines = original.split("\n");
  const at = lines.findIndex((l) => l.startsWith(anchor)) + 1;
  const total: number[] = [];
  const later: number[] = [];
  for (let i = 0; i <= runs; i++) {
    const edited = [...lines.slice(0, at), `\t_ = ${i} // bench edit`, ...lines.slice(at)].join("\n");
    writeFileSync(join(dir, rel), edited);
    laterMs = 0;
    const t0 = performance.now();
    const d = await idx.update([{ kind: "change", path: rel }]);
    const dt = performance.now() - t0;
    if (d.changed.length !== 1) throw new Error("update did not register the edit");
    if (i > 0) {
      total.push(dt);
      later.push(laterMs);
    }
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
  console.log(
    `update() median ${med(total).toFixed(1)} ms (later stages ${med(later).toFixed(1)} ms, S0/S1 part ${(med(total) - med(later)).toFixed(1)} ms) runs ${total.map((x) => x.toFixed(0)).join(",")}`,
  );
  await idx.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
