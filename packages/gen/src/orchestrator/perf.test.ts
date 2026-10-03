import { describe, expect, test } from "bun:test";
import type { ModuleId } from "@mitori/core";
import { makeHarness } from "../test/harness.ts";
import type { FakeRepo } from "../test/repo.ts";

/** ~100k LOC: 400 leaf modules of 250 lines, 40 parents. */
function bigRepo(): FakeRepo {
  const repo: FakeRepo = { files: { "README.md": "# Big\n\nA large repository.\n" }, symbols: {}, modules: [], facts: [] };
  const body = Array.from({ length: 250 }, (_, i) =>
    i % 25 === 0 ? `export function f${i}(x: number): number {` : i % 25 === 24 ? "}" : `  x = x + ${i};`,
  ).join("\n");
  const parents: ModuleId[] = [];
  for (let p = 0; p < 40; p++) parents.push(`md_p${String(p).padStart(7, "0")}` as ModuleId);
  for (let i = 0; i < 400; i++) {
    const id = `md_b${String(i).padStart(7, "0")}` as ModuleId;
    const path = `src/pkg${i}/mod.ts`;
    repo.files[path] = `${body}\n`;
    repo.symbols[path] = Array.from({ length: 10 }, (_, k) => ({
      name: `f${k * 25}`,
      qualname: `f${k * 25}`,
      kind: "function" as const,
      start: k * 25 + 1,
      end: k * 25 + 25,
      exported: true,
    }));
    const parent = parents[i % 40] as ModuleId;
    repo.modules.push({
      id,
      slug: `pkg${i}`,
      name: `pkg${i}`,
      paths: [path],
      children: [],
      parent,
      rank: (i % 97) / 100,
      topoOrder: i,
      deps: i > 0 ? [{ module: `md_b${String(i - 1).padStart(7, "0")}` as ModuleId, weight: 0.5 }] : [],
    });
  }
  parents.forEach((id, p) => {
    repo.modules.push({
      id,
      slug: `group${p}`,
      name: `group${p}`,
      paths: [],
      children: repo.modules.filter((m) => m.parent === id).map((m) => m.id),
      rank: 0.5,
      topoOrder: 400 + p,
      deps: [],
    });
  });
  repo.facts.push({ kind: "route", detector: "t@1", path: "src/pkg1/mod.ts", line: 1, method: "GET", pattern: "/x", framework: "test" });
  return repo;
}

// AC-27: POST /gen/estimate p95 ≤ 300 ms at 100k LOC (no LLM). Fake index, real planner / renderer / estimator.
describe("AC-27 estimate latency (synthetic 100k LOC)", () => {
  test("standard estimate ≤ 300 ms", async () => {
    const h = makeHarness({ repo: bigRepo() });
    await h.gen.estimate({ effort: "standard" }); // warm-up (salt, pinned system)
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const est = await h.gen.estimate({ effort: "standard" });
      times.push(performance.now() - t0);
      expect(est.stages.find((s) => s.stage === "S5")?.tasks).toBe(40);
    }
    expect(Math.max(...times)).toBeLessThan(300);
  });
});
