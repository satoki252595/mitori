import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ModuleId, RepoPath } from "@mitori/core";
import type { StageFile } from "../resolve/files.ts";
import { corpusDir, FIXTURES, loadRepo } from "../structure/test/corpus.ts";
import { runPipeline } from "../structure/test/pipeline.ts";
import { flowSeeds, moduleStats } from "./flow.ts";

const FIX = ["ts-small", "go-small", "py-small", "rust-small", "mixed"];

describe("IDX-U flow seeds (gen I4, spec §7.8)", () => {
  for (const name of FIX)
    test(`${name}: ranked main-scope entry points walking existing module edges`, async () => {
      const p = runPipeline((await loadRepo(join(FIXTURES, name))).input);
      const st = p.structure;
      const seeds = flowSeeds(st, p.facts);
      expect(seeds.length).toBeGreaterThan(0);
      expect(seeds.length).toBeLessThanOrEqual(8);
      const edges = new Set(st.leafEdges.map((e) => `${e.from}>${e.to}`));
      seeds.forEach((s, i) => {
        expect(s.k).toBe(i + 1);
        expect(s.modules.length).toBeGreaterThan(0);
        expect(s.modules.length).toBeLessThanOrEqual(7);
        for (let j = 1; j < s.modules.length; j++) expect(edges.has(`${s.modules[j - 1]}>${s.modules[j]}`)).toBe(true);
        expect(new Set(s.modules).size).toBe(s.modules.length);
        // one file per module, each a member of its module
        expect(s.files.length).toBe(s.modules.length);
        s.files.forEach((f, j) => {
          expect(st.moduleOf.get(f)).toBe(s.modules[j] as ModuleId);
        });
      });
      // deterministic, and the limit is honoured
      expect(flowSeeds(runPipeline(p.input).structure, p.facts)).toEqual(seeds);
      expect(flowSeeds(st, p.facts, 1)).toEqual(seeds.slice(0, 1));
    });
});

const crit = corpusDir("crit");

describe.skipIf(!crit)("IDX-AT-48 flow seeds on crit", () => {
  test("≥ 5 seeds, each a contiguous path over effective module edges, one member file per module", async () => {
    const p = runPipeline((await loadRepo(crit as string)).input);
    const st = p.structure;
    const seeds = flowSeeds(st, p.facts);
    expect(seeds.length).toBeGreaterThanOrEqual(5);
    const edges = new Set(st.leafEdges.map((e) => `${e.from}>${e.to}`));
    for (const s of seeds) {
      for (let j = 1; j < s.modules.length; j++) expect(edges.has(`${s.modules[j - 1]}>${s.modules[j]}`)).toBe(true);
      s.files.forEach((f, j) => {
        expect(st.moduleOf.get(f)).toBe(s.modules[j] as ModuleId);
      });
    }
    expect(seeds[0]?.kind).toBe("route"); // routes first (spec §7.8)
    expect(seeds.some((s) => s.kind === "cli")).toBe(true);
  }, 60_000);
});

describe("IDX-U module stats (gen I3)", () => {
  for (const name of FIX)
    test(`${name}: leaf counts add up and edges match the module graph`, async () => {
      const p = runPipeline((await loadRepo(join(FIXTURES, name))).input);
      const st = p.structure;
      const files = new Map<RepoPath, StageFile>(p.input.files.map((f) => [f.path, f]));
      expect(moduleStats("md_nope" as ModuleId, st, p.facts, files)).toBeNull();
      const leaves = st.modules.filter((m) => m.paths.length > 0);
      let total = 0;
      for (const m of leaves) {
        const s = moduleStats(m.id, st, p.facts, files);
        if (!s) throw new Error(`no stats for ${m.id}`);
        expect(s.files).toBe(m.paths.length);
        expect(s.loc).toBe(m.loc);
        expect(s.exportedSymbols).toBeLessThanOrEqual(s.symbols);
        expect(s.testFiles).toBe(new Set(m.tests).size);
        const out = st.leafEdges.filter((e) => e.from === m.id && e.to !== m.id);
        expect(s.depsOut.map((d) => d.module).sort()).toEqual(out.map((e) => e.to).sort());
        for (let i = 1; i < s.depsOut.length; i++)
          expect((s.depsOut[i - 1] as { weight: number }).weight).toBeGreaterThanOrEqual((s.depsOut[i] as { weight: number }).weight);
        total += s.symbols;
      }
      const memberSymbols = leaves.flatMap((m) => m.paths).reduce((n, path) => n + (files.get(path)?.symbols.length ?? 0), 0);
      expect(total).toBe(memberSymbols);
      // a parent aggregates its leaves
      const parent = st.modules.find((m) => m.paths.length === 0);
      if (parent) {
        const s = moduleStats(parent.id, st, p.facts, files);
        const kids = leaves.filter((m) => m.parent === parent.id || st.modules.find((x) => x.id === m.parent)?.parent === parent.id);
        expect(s?.files).toBe(kids.reduce((n, m) => n + m.paths.length, 0));
      }
    });
});
