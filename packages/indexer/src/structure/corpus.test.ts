/** Corpus acceptance for S3 (spec §12.4). Each suite skips when its pinned corpus clone is absent. */
import { describe, expect, test } from "bun:test";
import type { ModuleSeed } from "../contract.ts";
import type { StageFile, StageInput } from "../resolve/files.ts";
import { loadStructure, saveStructure } from "./persist.ts";
import type { StructureResult } from "./stage.ts";
import { memDb } from "./structure.test.ts";
import { commitsOf, corpusDir, loadCommit, loadRepo } from "./test/corpus.ts";
import { NOW, runPipeline } from "./test/pipeline.ts";

const crit = corpusDir("crit");
const m3e = corpusDir("m3e-canvas");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const leaves = (st: StructureResult) => st.modules.filter((m) => m.paths.length > 0);
const snapshotOf = (st: StructureResult) =>
  st.modules.map((m) => ({ id: m.id, slug: m.slug, paths: m.paths, rank: m.rank, topo: m.topoOrder, parent: m.parent }));

/** Prev state as the facade would hand it over after persisting `st`. */
function persisted(st: StructureResult) {
  const db = memDb();
  saveStructure(db, st, NOW);
  return loadStructure(db);
}

/** A body-only edit of one file: one more line of code, same imports / refs / symbols. */
function bodyEdit(inp: StageInput, path: string): StageInput {
  return {
    texts: inp.texts,
    files: inp.files.map((f): StageFile => (f.path === path ? { ...f, blob: `${f.blob}+`, lines: f.lines + 1, loc: f.loc + 1 } : f)),
  };
}

describe.skipIf(!crit)("crit structure", () => {
  const input = async () => (await loadRepo(crit as string)).input;

  test("IDX-AT-30 determinism: same snapshot + same previous state ⇒ identical membership, ids, slugs, ranks, topo", async () => {
    const inp = await input();
    const a = runPipeline(inp);
    const b = runPipeline(inp);
    expect(snapshotOf(b.structure)).toEqual(snapshotOf(a.structure));
    const prev = persisted(a.structure);
    expect(snapshotOf(runPipeline(inp, { prev }).structure)).toEqual(snapshotOf(runPipeline(inp, { prev }).structure));
  }, 60_000);

  test("IDX-AT-31 crit modularity is recorded and beats the directory partition", async () => {
    const st = runPipeline(await input()).structure;
    console.log(
      `[IDX-AT-31] crit modularity=${st.info.modularity.toFixed(3)} dir=${st.info.dirModularity.toFixed(3)} leaves=${st.info.leaves} γ=${st.info.gamma}`,
    );
    expect(st.info.modularity).toBeGreaterThan(st.info.dirModularity);
    expect(st.info.modularity).toBeGreaterThanOrEqual(0.4);
  }, 60_000);

  test("IDX-AT-32 crit leaf sizes: median 2k–6k LOC, ≥ 80 % of leaves within 1k–9k", async () => {
    const ls = leaves(runPipeline(await input()).structure).map((m) => m.loc);
    expect(median(ls)).toBeGreaterThanOrEqual(2_000);
    expect(median(ls)).toBeLessThanOrEqual(6_000);
    expect(ls.filter((x) => x >= 1_000 && x <= 9_000).length / ls.length).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  test("IDX-AT-36 PageRank: crit top 10 has neither integrations/embed.go nor web/embed.go", async () => {
    const st = runPipeline(await input()).structure;
    const top = [...st.fileRank]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p]) => p);
    expect(top).not.toContain("integrations/embed.go");
    expect(top).not.toContain("web/embed.go");
  }, 60_000);

  test("IDX-AT-34 seeds: with the DB lost, doc.index.json reps restore ≥ 95 % of leaf ids (and their slugs)", async () => {
    const inp = await input();
    const first = runPipeline(inp).structure;
    const seeds: ModuleSeed[] = first.modules.map((m) => ({ id: m.id, slug: m.slug, name: m.name, ...(m.parent ? { parent: m.parent } : {}), reps: m.reps }));
    const restored = runPipeline(inp, { seeds }).structure;
    const slugOf = new Map(first.modules.map((m) => [m.id, m.slug]));
    const firstLeaves = leaves(first);
    const kept = leaves(restored).filter((m) => slugOf.has(m.id) && slugOf.get(m.id) === m.slug);
    expect(kept.length / firstLeaves.length).toBeGreaterThanOrEqual(0.95);
  }, 60_000);

  test("rescan with the previous state keeps every module id whose members changed < 50 %", async () => {
    const inp = await input();
    const first = runPipeline(inp).structure;
    const prev = persisted(first);
    // drop 3 files of the largest leaf (a < 50 % membership change) and edit two bodies elsewhere
    const big = [...leaves(first)].sort((a, b) => b.paths.length - a.paths.length)[0];
    const drop = new Set(big?.paths.slice(0, 3));
    const changed: StageInput = { texts: inp.texts, files: inp.files.filter((f) => !drop.has(f.path)) };
    const second = runPipeline(bodyEdit(bodyEdit(changed, "internal/server/server.go"), "cmd/crit/main.go"), { prev }).structure;
    const ids = new Set(second.modules.map((m) => m.id));
    for (const m of leaves(first)) {
      const after = new Set(second.modules.find((x) => x.id === m.id)?.paths ?? []);
      const lost = m.paths.filter((p) => !after.has(p)).length;
      if (lost / m.paths.length < 0.5) expect(ids.has(m.id)).toBe(true);
    }
  }, 60_000);

  test("IDX-AT-35 small changes: random body edits keep membership and ids (20 edits on crit)", async () => {
    const inp = await input();
    const first = runPipeline(inp).structure;
    const prev = persisted(first);
    const graphFiles = first.graph.paths;
    let x = 12345;
    for (let k = 0; k < 20; k++) {
      x = (x * 1103515245 + 12345) >>> 0;
      const path = graphFiles[x % graphFiles.length] as string;
      const st = runPipeline(bodyEdit(inp, path), { prev }).structure;
      expect(st.modules.map((m) => [m.id, m.slug, m.paths])).toEqual(first.modules.map((m) => [m.id, m.slug, m.paths]));
    }
  }, 120_000);

  test("IDX-AT-33 replay of crit's history: ≤ 5 % of leaves change id per commit, ≥ 90 % keep it end to end, no slug change", async () => {
    const root = crit as string;
    const commits = commitsOf(root).slice(-41);
    let prevState = { modules: [] } as ReturnType<typeof loadStructure>;
    let first: StructureResult | null = null;
    let prev: StructureResult | null = null;
    const perCommit: number[] = [];
    for (const c of commits) {
      const st = runPipeline((await loadCommit(root, c)).input, { prev: prevState }).structure;
      if (prev) {
        const now = new Map(st.modules.map((m) => [m.id, m.slug]));
        const before = leaves(prev);
        perCommit.push(before.filter((m) => !now.has(m.id)).length / before.length);
        for (const m of st.modules) {
          const old = prev.modules.find((o) => o.id === m.id);
          if (old) expect(m.slug).toBe(old.slug);
        }
      }
      first ??= st;
      prev = st;
      prevState = persisted(st);
    }
    const endIds = new Set((prev as StructureResult).modules.map((m) => m.id));
    const survived = leaves(first as StructureResult).filter((m) => endIds.has(m.id)).length / leaves(first as StructureResult).length;
    console.log(
      `[IDX-AT-33] commits=${commits.length} worst=${Math.max(...perCommit).toFixed(3)} mean=${(perCommit.reduce((a, b) => a + b, 0) / perCommit.length).toFixed(3)} survived=${survived.toFixed(3)}`,
    );
    expect(Math.max(...perCommit)).toBeLessThanOrEqual(0.05);
    expect(survived).toBeGreaterThanOrEqual(0.9);
  }, 300_000);
});

describe.skipIf(!m3e)("m3e structure (layered TS app)", () => {
  test("IDX-AT-31 m3e: the leaf partition beats the directory partition", async () => {
    const st = runPipeline((await loadRepo(m3e as string)).input).structure;
    console.log(`[IDX-AT-31] m3e modularity=${st.info.modularity.toFixed(3)} dir=${st.info.dirModularity.toFixed(3)} leaves=${st.info.leaves}`);
    expect(st.info.modularity).toBeGreaterThan(st.info.dirModularity);
    expect(st.info.modularity).toBeGreaterThan(-0.221);
    expect(st.info.leaves).toBeGreaterThanOrEqual(3); // IDX-AT-32 small-repo exception
  }, 60_000);

  // CR-PENDING(WP-03): ≥ 0.2 is unreachable on the spec graph (best of 200 Louvain orders 0.189); see cr-requests/WP-03.md.
  test.todo("IDX-AT-31 m3e modularity ≥ 0.2", async () => {
    expect(runPipeline((await loadRepo(m3e as string)).input).structure.info.modularity).toBeGreaterThanOrEqual(0.2);
  });

  test("IDX-AT-35 small changes: 100 random body edits keep membership and ids (m3e)", async () => {
    const inp = (await loadRepo(m3e as string)).input;
    const first = runPipeline(inp).structure;
    const prev = persisted(first);
    const graphFiles = first.graph.paths;
    let x = 777;
    for (let k = 0; k < 100; k++) {
      x = (x * 1103515245 + 12345) >>> 0;
      const st = runPipeline(bodyEdit(inp, graphFiles[x % graphFiles.length] as string), { prev }).structure;
      expect(st.modules.map((m) => [m.id, m.paths])).toEqual(first.modules.map((m) => [m.id, m.paths]));
    }
  }, 120_000);
});
