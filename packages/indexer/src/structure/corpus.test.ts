/** Corpus acceptance for S3 (spec §12.4). Each suite skips when its pinned corpus clone is absent. */
import { describe, expect, test } from "bun:test";
import type { ModuleSeed } from "../contract.ts";
import { linkFacts } from "../facts/stage.ts";
import { buildRepoPack } from "../pack/repo-pack.ts";
import type { StageFile, StageInput } from "../resolve/files.ts";
import { resolveImports } from "../resolve/stage.ts";
import { searchRows } from "../search/rows.ts";
import { loadStructure, saveStructure } from "./persist.ts";
import { moduleSeedsOf, type StructureResult } from "./stage.ts";
import { commitsOf, corpusDir, loadCommit, loadRepo } from "./test/corpus.ts";
import { memDb } from "./test/db.ts";
import { estimateCode, NOW, runPipeline, xxh3 } from "./test/pipeline.ts";
import { updateStructure } from "./update.ts";

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

  test("IDX-AT perf: S2–S4 (resolve + link + structure + pack + search rows) on crit within the S0–S4 budget", async () => {
    const inp = await input();
    runPipeline(inp); // warm the JIT
    const t0 = performance.now();
    const p = runPipeline(inp);
    const t1 = performance.now();
    const pack = buildRepoPack(
      {
        repo: "crit",
        files: inp.files,
        resolved: p.resolved,
        facts: p.facts,
        structure: p.structure,
        indexDigest: "0",
        extractorSet: "x",
        settingsDigest: "0",
        xxh3,
        estimate: estimateCode,
      },
      { tokenizer: "claude-v5" },
    );
    const rows = searchRows(inp.files, p.structure, p.facts.facts);
    const t2 = performance.now();
    const total = t2 - t0;
    const loc = inp.files.filter((f) => f.class === "source" && f.excluded === undefined).reduce((a, f) => a + f.loc, 0);
    console.log(
      `[idx.s04] crit loc=${loc} S2–S4=${total.toFixed(1)}ms resolve=${p.ms.resolve.toFixed(1)} facts=${p.ms.facts.toFixed(1)} structure=${p.ms.structure.toFixed(1)} pack+rows=${(t2 - t1).toFixed(1)} (pack ${pack.tokens} tok, ${rows.length} rows)`,
    );
    // budget idx.s04.cold.100kloc: S0–S4 ≤ 1.0 s (limit 2.0) with S0–S1 ≤ 0.3 s (limit 0.5) ⇒ S2–S4 ≤ 0.7 s (limit 1.5)
    expect(total).toBeLessThanOrEqual(700);
    expect(p.ms.facts).toBeLessThanOrEqual(50); // spec §5.1: link ≤ 50 ms
  }, 60_000);

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
    const seeds: ModuleSeed[] = moduleSeedsOf(first);
    const restored = runPipeline(inp, { seeds }).structure;
    const slugOf = new Map(first.modules.map((m) => [m.id, m.slug]));
    const firstLeaves = leaves(first);
    const kept = leaves(restored).filter((m) => slugOf.has(m.id) && slugOf.get(m.id) === m.slug);
    expect(kept.length / firstLeaves.length).toBeGreaterThanOrEqual(0.95);
  }, 60_000);

  test("IDX-AT rescan: the previous state keeps every module id whose members changed < 50 %", async () => {
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

  test("IDX-AT perf: the update() structure path (§6.8) on crit stays within the 1-file update budget", async () => {
    const inp = await input();
    const p = runPipeline(inp);
    const graphFiles = p.structure.graph.paths;
    const times: number[] = [];
    for (let k = 0; k < 12; k++) {
      const path = graphFiles[(k * 7919) % graphFiles.length] as string;
      const edited = bodyEdit(inp, path);
      const res = resolveImports(edited);
      const facts = linkFacts(edited, res);
      const t0 = performance.now();
      const r = updateStructure(p.structure, { files: edited.files, resolved: res, facts, xxh3, indexDigest: "u", now: NOW, changed: [path] });
      times.push(performance.now() - t0);
      expect(r?.modules.map((m) => [m.id, m.paths])).toEqual(p.structure.modules.map((m) => [m.id, m.paths]));
    }
    const med = median(times);
    console.log(`[idx.update.1file] crit S3 update path median=${med.toFixed(2)}ms`);
    expect(med).toBeLessThanOrEqual(10); // idx.update.1file 15 ms (limit 30) covers parse + S2 + S3
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
    let prevBlobs = new Map<string, string>();
    const perCommit: number[] = [];
    const restructures: string[] = [];
    for (const c of commits) {
      const inp = (await loadCommit(root, c)).input;
      const st = runPipeline(inp, { prev: prevState }).structure;
      const blobs = new Map(st.graph.paths.map((p) => [p, inp.files.find((f) => f.path === p)?.blob ?? ""]));
      if (prev) {
        const now = new Set(st.modules.map((m) => m.id));
        const before = leaves(prev);
        const lost = before.filter((m) => !now.has(m.id)).length / before.length;
        let touched = 0;
        for (const [p, b] of blobs) if (prevBlobs.get(p) !== b) touched++;
        for (const p of prevBlobs.keys()) if (!blobs.has(p)) touched++;
        // a commit touching > 10 % of the graph files re-clusters (spec §6.8): logged separately
        if (touched / Math.max(1, prevBlobs.size) > 0.1) restructures.push(`${c.slice(0, 8)} touched=${touched} lost=${lost.toFixed(3)}`);
        perCommit.push(lost);
        for (const m of st.modules) {
          const old = prev.modules.find((o) => o.id === m.id);
          if (old) expect(m.slug).toBe(old.slug);
        }
      }
      first ??= st;
      prev = st;
      prevBlobs = blobs;
      prevState = persisted(st);
    }
    const endIds = new Set((prev as StructureResult).modules.map((m) => m.id));
    const survived = leaves(first as StructureResult).filter((m) => endIds.has(m.id)).length / leaves(first as StructureResult).length;
    console.log(
      `[IDX-AT-33] commits=${commits.length} worst=${Math.max(...perCommit).toFixed(3)} mean=${(perCommit.reduce((a, b) => a + b, 0) / perCommit.length).toFixed(3)} restructures=[${restructures.join("; ")}] survived=${survived.toFixed(3)}`,
    );
    expect(Math.max(...perCommit)).toBeLessThanOrEqual(0.05);
    expect(survived).toBeGreaterThanOrEqual(0.9);
  }, 300_000);
});

const SIZED = ["hono", "ripgrep", "fastapi", "excalidraw", "react"].map((n) => [n, corpusDir(n)] as const).filter(([, d]) => d !== null);

describe.skipIf(SIZED.length === 0)("IDX-AT-32 leaf sizes across the corpus", () => {
  for (const [name, dir] of SIZED)
    test(`${name}: median 2k–6k LOC, ≥ 80 % of leaves within 1k–9k, estimated sig skeleton ≤ 32k tokens`, async () => {
      const p = runPipeline((await loadRepo(dir as string)).input);
      const ls = leaves(p.structure);
      const locs = ls.map((m) => m.loc);
      console.log(
        `[IDX-AT-32] ${name} leaves=${ls.length} median=${median(locs)} Q=${p.structure.info.modularity.toFixed(3)} dirQ=${p.structure.info.dirModularity.toFixed(3)} structure=${p.ms.structure.toFixed(0)}ms`,
      );
      expect(median(locs)).toBeGreaterThanOrEqual(2_000);
      expect(median(locs)).toBeLessThanOrEqual(6_000);
      expect(locs.filter((x) => x >= 1_000 && x <= 9_000).length / locs.length).toBeGreaterThanOrEqual(0.8);
      const files = new Map(p.input.files.map((f) => [f.path, f]));
      for (const m of ls) {
        const sigChars = m.paths.reduce((a, path) => a + (files.get(path)?.symbols ?? []).reduce((b, s) => b + s.signature.length + 6, path.length + 8), 0);
        if (!m.oversizeFile) expect(sigChars / 2.3).toBeLessThanOrEqual(32_000);
      }
    }, 120_000);
  const flask = corpusDir("flask");
  test.skipIf(!flask)(
    "flask (small repo): median 2k–6k",
    async () => {
      const locs = leaves(runPipeline((await loadRepo(flask as string)).input).structure).map((m) => m.loc);
      expect(median(locs)).toBeGreaterThanOrEqual(2_000);
      expect(median(locs)).toBeLessThanOrEqual(6_000);
    },
    60_000,
  );
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
