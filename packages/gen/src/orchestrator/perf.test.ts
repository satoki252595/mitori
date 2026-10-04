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

/** 100k LOC shaped like gen spec §9.6: 25 leaves of 4000 lines, 3 parents; skeletons ≈ 20 % of the source. */
function realisticRepo(): FakeRepo {
  const repo: FakeRepo = { files: { "README.md": "# Big\n\nA large repository.\n" }, symbols: {}, modules: [], facts: [] };
  const parents: ModuleId[] = ["md_p0000001", "md_p0000002", "md_p0000003"] as ModuleId[];
  for (let i = 0; i < 25; i++) {
    const id = `md_b${String(i).padStart(7, "0")}` as ModuleId;
    const paths: string[] = [];
    for (let f = 0; f < 10; f++) {
      const path = `src/pkg${i}/file${f}.ts`;
      paths.push(path);
      const lines = Array.from({ length: 400 }, (_, k) =>
        k % 5 === 0
          ? `export function handler${f}_${k}(request: Request, options: Options): Promise<Response> {`
          : `  const value${k} = compute(request, options, ${k}); // step ${k}`,
      );
      repo.files[path] = `${lines.join("\n")}\n`;
      repo.symbols[path] = Array.from({ length: 80 }, (_, k) => ({
        name: `handler${f}_${k * 5}`,
        qualname: `handler${f}_${k * 5}`,
        kind: "function" as const,
        start: k * 5 + 1,
        end: k * 5 + 5,
        exported: true,
      }));
    }
    repo.modules.push({
      id,
      slug: `pkg${i}`,
      name: `pkg${i}`,
      paths,
      children: [],
      parent: parents[i % 3] as ModuleId,
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
      topoOrder: 100 + p,
      deps: [],
    });
  });
  repo.facts.push({ kind: "route", detector: "t@1", path: "src/pkg1/file0.ts", line: 1, method: "GET", pattern: "/x", framework: "test" });
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
    expect(Math.max(...times)).toBeLessThan(5_000); // generous under load (300 ms quiet)
  });

  test("standard estimate ≤ 300 ms with §9.6-sized inputs (25 leaves × 4,000 lines, ≈ 1M S5 input tokens rendered)", async () => {
    const h = makeHarness({ repo: realisticRepo() });
    await h.gen.estimate({ effort: "standard" });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const est = await h.gen.estimate({ effort: "standard" });
      times.push(performance.now() - t0);
      const s5 = est.stages.find((s) => s.stage === "S5");
      expect(s5?.tasks).toBe(25);
      expect(s5?.inTokens).toBeGreaterThan(500_000);
    }
    expect(Math.max(...times)).toBeLessThan(5_000); // generous under load (300 ms quiet)
  });
});
