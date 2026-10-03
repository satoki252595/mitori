// Warm rescans (budgets idx.warm.rescan / idx.warm.rescan.7k): one cold scan, then unchanged rescans, through the
// production GitReader of @mitori/platform (`--reader cli` uses the test reader). Prints the median and where it went.
//   scripts/nd bun packages/indexer/src/update/test/prof-warm.ts --repo crit [--runs 20] [--reader platform|cli]
import { homedir } from "node:os";
import { join } from "node:path";
import type { GitReader } from "@mitori/core";
import { createGitReader } from "@mitori/platform";
import { INVENTORY_SETS } from "../../contract.ts";
import { corpusDir } from "../../parse/test/corpus.ts";
import { createIndexer } from "../index.ts";
import { testDeps } from "./deps.ts";
import { cliGit, shadowGit } from "./git.ts";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? (args[args.indexOf(k) + 1] as string) : d);
const repo = arg("--repo", "crit");
const runs = Number(arg("--runs", "20"));
const kind = arg("--reader", "platform");
const root = corpusDir(repo);
if (root === null) throw new Error(`corpus ${repo} not available`);
const shadowDir = join(homedir(), ".cache", "mitori-bench", `${repo}-shadow.git`);
const shadow = repo === "gostd";
if (shadow) shadowGit(root, shadowDir); // creates the shadow repo (info/exclude) when missing
void INVENTORY_SETS;
const base: GitReader =
  kind === "cli"
    ? shadow
      ? shadowGit(root, shadowDir)
      : cliGit(root)
    : createGitReader({ workTree: root, ...(shadow ? { gitDir: shadowDir } : {}), env: { PATH: process.env.PATH, HOME: process.env.HOME } });
const calls = new Map<string, { n: number; ms: number }>();
const timed: GitReader = Object.fromEntries(
  Object.entries(base).map(([k, v]) => [
    k,
    typeof v !== "function"
      ? v
      : async (...a: unknown[]) => {
          const t0 = performance.now();
          try {
            return await (v as (...x: unknown[]) => unknown).apply(base, a);
          } finally {
            const c = calls.get(k) ?? { n: 0, ms: 0 };
            c.n++;
            c.ms += performance.now() - t0;
            calls.set(k, c);
          }
        },
  ]),
) as unknown as GitReader;
const deps = testDeps(root, { git: timed as never, kind: shadow ? "shadow" : "git" });
const idx = createIndexer(deps);
const c0 = performance.now();
await idx.scan({ until: "S1", reason: "bench" });
console.log(`${repo} cold scan ${(performance.now() - c0).toFixed(0)} ms (S0 ${idx.lastTimings()?.s0.toFixed(0)} ms)`);
for (const [k, v] of calls) console.log(`  cold git.${k}: ${v.n}× ${(v.ms / v.n).toFixed(1)} ms`);
for (let i = 0; i < 400 && idx.lastTimings()?.persist === null; i++) await Bun.sleep(25);
const ms: number[] = [];
calls.clear();
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  await idx.scan({ until: "S1", reason: "bench" });
  ms.push(performance.now() - t0);
}
ms.sort((a, b) => a - b);
console.log(
  `${repo} warm rescan (${kind} git) median ${(ms[ms.length >> 1] as number).toFixed(1)} ms, min ${(ms[0] as number).toFixed(1)}, p90 ${(ms[Math.floor(ms.length * 0.9)] as number).toFixed(1)}; files ${idx.files({ includeExcluded: true }).length}`,
);
for (const [k, v] of calls) console.log(`  git.${k}: ${v.n}× ${(v.ms / v.n).toFixed(1)} ms`);
await idx.close();
await (base as { close?: () => Promise<void> }).close?.();
process.exit(0);
