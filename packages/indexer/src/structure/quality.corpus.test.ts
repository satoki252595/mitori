/**
 * S3 partition quality on the corpus, through the real S0–S1 (spec §6, §11.4, §12.4 IDX-AT-31/32; CR m1-36): leaf
 * sizes and skeleton caps, modularity against the directory partition (m3e: ≥ 0.9 × the best of 50 Louvain orders),
 * directory purity, path names and directory parents, id stability across rescans. Each suite skips when its pinned
 * corpus clone is absent (`bun run corpus:fetch`).
 */
import { describe, expect, test } from "bun:test";
import type { RepoPath } from "@mitori/core";
import { STRUCTURE_PARAMS } from "../contract.ts";
import { corpusDir } from "../parse/test/corpus.ts";
import { nodeScope, undirected } from "./cluster.ts";
import { louvain, modularity, splitDisconnected } from "./louvain.ts";
import { loadStructure, saveStructure } from "./persist.ts";
import type { StructureResult } from "./stage.ts";
import { memDb } from "./test/db.ts";
import { docRowSeeds, NOW, partitionShape, runPipeline, xxh3 } from "./test/pipeline.ts";
import { loadReal } from "./test/real.ts";

const P = STRUCTURE_PARAMS;
const leavesOf = (st: StructureResult) => st.modules.filter((m) => m.paths.length > 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Share of each directory's (direct files') LOC in its majority leaf, LOC-weighted; a directory larger than one leaf counts as pure when its largest share fills a leaf. */
function purity(st: StructureResult, loc: (p: RepoPath) => number): number {
  const byDir = new Map<string, Map<string, number>>();
  for (const m of leavesOf(st))
    for (const p of m.paths) {
      const d = byDir.get(dirOf(p)) ?? new Map<string, number>();
      d.set(m.id, (d.get(m.id) ?? 0) + Math.max(1, loc(p)));
      byDir.set(dirOf(p), d);
    }
  let inMax = 0;
  let total = 0;
  for (const d of byDir.values()) {
    inMax += Math.min(Math.max(...d.values()), P.leafLocMax);
    total += Math.min(
      [...d.values()].reduce((a, b) => a + b, 0),
      P.leafLocMax,
    );
  }
  return inMax / total;
}

/** Best modularity of 50 Louvain visit orders (γ = 1, no size cap) on the graph `info.modularity` is measured on. */
function bestOf50(st: StructureResult, scopeOf: (v: number) => string): number {
  const { dep } = undirected(st.graph, scopeOf);
  const n = st.graph.paths.length;
  let best = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < 50; k++) {
    const keys = st.graph.paths.map((p, i) => ({ i, k: xxh3(`best50|${k}|${p}`) })).sort((a, b) => (a.k < b.k ? -1 : 1));
    const order = new Int32Array(n);
    keys.forEach((x, r) => {
      order[x.i] = r;
    });
    best = Math.max(best, modularity(dep, splitDisconnected(dep, louvain(dep, { gamma: 1, maxSize: Number.POSITIVE_INFINITY, order }), order)));
  }
  return best;
}

/** The path a name stands for: its head before ` (`, ` · ` or ` …`. */
const nameHead = (name: string) => name.split(/ \(| · | …/)[0] as string;

const REPOS = ["crit", "m3e-canvas", "hono", "flask", "ripgrep", "excalidraw", "fastapi"] as const;
/** Repos smaller than this get ≥ 3 leaves instead of the median rule (IDX-AT-32 small-repo exception). */
const SMALL_REPO_LOC = 30_000;

for (const name of REPOS) {
  const dir = corpusDir(name);
  describe.skipIf(dir === null)(`S3 quality on ${name} (real parse)`, () => {
    const run = async () => runPipeline(await loadReal(dir as string));

    test("IDX-AT-32 leaf sizes and skeleton caps; IDX-AT-31 modularity above the directory partition; directory purity", async () => {
      const p = await run();
      const st = p.structure;
      const files = new Map(p.input.files.map((f) => [f.path, f]));
      const loc = (x: RepoPath) => files.get(x)?.loc ?? 0;
      const ls = leavesOf(st);
      const locs = ls.map((m) => m.loc);
      const total = locs.reduce((a, b) => a + b, 0);
      const pur = purity(st, loc);
      console.log(
        `[S3 quality] ${name} leaves=${ls.length} parents=${st.modules.length - ls.length} loc min/median/max=${Math.min(...locs)}/${median(locs)}/${Math.max(...locs)} Q=${st.info.modularity.toFixed(3)} dirQ=${st.info.dirModularity.toFixed(3)} purity=${pur.toFixed(3)} γ=${st.info.gamma}`,
      );
      for (const m of ls) {
        if (m.paths.length > 1) expect([m.slug, m.loc <= P.leafLocHard]).toEqual([m.slug, true]);
        const sig = m.paths.reduce((a, x) => a + (files.get(x)?.symbols ?? []).reduce((b, s) => b + s.signature.length + 6, x.length + 8), 0) / 2.3;
        if (!m.oversizeFile) expect([m.slug, sig <= P.leafSkeletonTokensMax]).toEqual([m.slug, true]);
      }
      expect(ls.filter((m) => m.loc <= P.leafLocMax * 1.1).length / ls.length).toBeGreaterThanOrEqual(0.8);
      if (total < SMALL_REPO_LOC) expect(ls.length).toBeGreaterThanOrEqual(3);
      else {
        expect(median(locs)).toBeGreaterThanOrEqual(P.leafLocMin);
        expect(median(locs)).toBeLessThanOrEqual(P.leafLocMax);
      }
      expect(st.info.modularity).toBeGreaterThan(st.info.dirModularity);
      expect(pur).toBeGreaterThanOrEqual(name === "m3e-canvas" ? 0.7 : 0.9);
    }, 120_000);

    test("names are paths of their members (no `a + b · Symbol`), unique per level; parents are directories", async () => {
      const st = (await run()).structure;
      const byId = new Map(st.modules.map((m) => [m.id, m]));
      const levels = new Map<string, string[]>();
      for (const m of st.modules) {
        expect(m.name).not.toMatch(/ \+ /);
        expect(m.name).not.toMatch(/ · [A-Z][A-Za-z0-9]*$/);
        const lv = m.parent ?? "";
        levels.set(lv, [...(levels.get(lv) ?? []), m.name]);
        const members = m.paths.length > 0 ? m.paths : st.modules.filter((x) => x.paths.length > 0 && isBelow(x.id, m.id, byId)).flatMap((x) => x.paths);
        const head = nameHead(m.name);
        if (head !== "(root)")
          expect([m.name, members.some((x) => x === head || x.startsWith(`${head}/`) || head.split("/").every((seg) => x.split("/").includes(seg)))]).toEqual([
            m.name,
            true,
          ]);
        if (m.paths.length === 0) expect(m.children.length).toBeGreaterThanOrEqual(2);
      }
      for (const [lv, names] of levels) expect([lv, new Set(names).size]).toEqual([lv, names.length]);
    }, 120_000);

    test("ids, slugs and names survive a rescan with the previous state; a forced re-cluster keeps the ids", async () => {
      const p = await run();
      const db = memDb();
      saveStructure(db, p.structure, NOW);
      const prev = loadStructure(db);
      const again = runPipeline(p.input, { prev }).structure;
      expect(again.modules.map((m) => [m.id, m.slug, m.name, m.paths])).toEqual(p.structure.modules.map((m) => [m.id, m.slug, m.name, m.paths]));
      const forced = runPipeline(p.input, { prev, force: true }).structure;
      const ids = new Set(forced.modules.map((m) => m.id));
      const kept = leavesOf(p.structure).filter((m) => ids.has(m.id)).length / leavesOf(p.structure).length;
      expect(kept).toBeGreaterThanOrEqual(0.9);
    }, 120_000);
  });
}

function isBelow(leaf: string, ancestor: string, byId: Map<string, { parent?: string }>): boolean {
  for (let m = byId.get(leaf), hops = 0; m && hops < 8; m = m.parent ? byId.get(m.parent) : undefined, hops++) if (m.parent === ancestor) return true;
  return false;
}

const m3e = corpusDir("m3e-canvas");
describe.skipIf(m3e === null)("IDX-AT-31 m3e (layered TS app, CR m1-36)", () => {
  test("modularity beats the directory partition and reaches 0.9 × the best of 50 Louvain orders on the same graph", async () => {
    const p = runPipeline(await loadReal(m3e as string));
    const st = p.structure;
    const files = new Map(p.input.files.map((f) => [f.path, f]));
    const best = bestOf50(st, nodeScope(st.graph, files));
    console.log(`[IDX-AT-31] m3e modularity=${st.info.modularity.toFixed(3)} dir=${st.info.dirModularity.toFixed(3)} best50=${best.toFixed(3)}`);
    expect(st.info.modularity).toBeGreaterThan(st.info.dirModularity);
    expect(st.info.modularity).toBeGreaterThanOrEqual(0.9 * best);
  }, 120_000);
});

/** Directory units the corpus must keep as named modules (the partition reads like the repository). */
const EXPECTED: Record<string, { leaves: string[]; parents?: string[] }> = {
  crit: { leaves: ["internal/vcs", "internal/server", "cmd/crit"], parents: ["internal", "web"] },
  hono: { leaves: ["src/middleware", "src/jsx"] },
  ripgrep: { leaves: ["crates/ignore/src", "crates/globset/src", "crates/searcher/src", "crates/printer/src"] },
  flask: { leaves: ["src/flask", "src/flask/sansio"] },
};
for (const [name, want] of Object.entries(EXPECTED)) {
  const dir = corpusDir(name);
  test.skipIf(dir === null)(
    `${name}: the directory units are modules of their own`,
    async () => {
      const st = runPipeline(await loadReal(dir as string)).structure;
      const leafNames = leavesOf(st).map((m) => m.name);
      for (const l of want.leaves) expect(leafNames).toContain(l);
      const parentNames = st.modules.filter((m) => m.paths.length === 0).map((m) => m.name);
      for (const x of want.parents ?? []) expect(parentNames).toContain(x);
    },
    120_000,
  );
}

/**
 * CR gen #8 (reopen stability): a checkout opened with a fresh home (copied repo, teammate's clone, reinstall) seeds
 * S3 from `.mitori/doc.index.json`; the same commit must come back with the same partition — ids, slugs, tree,
 * members — open after open. Before, the parent rows (no files of their own) were re-born on every seeded open
 * (`internal` ⇄ `internal-2`, `web` ⇄ `web-2` on crit; three parents on excalidraw), which moved module pages and
 * re-planned module tasks without any code change.
 */
for (const name of ["crit", "excalidraw"] as const) {
  const dir = corpusDir(name);
  test.skipIf(dir === null)(
    `CR gen #8 ${name}: seeded reopens of the same commit reproduce the partition (ids, slugs, tree, members)`,
    async () => {
      const input = await loadReal(dir as string);
      const first = runPipeline(input).structure;
      expect(first.modules.some((m) => m.children.length > 0)).toBe(true);
      // a first open without `.mitori/` is deterministic too
      expect(partitionShape(runPipeline(input).structure)).toEqual(partitionShape(first));
      let st = first;
      for (let open = 1; open <= 3; open++) {
        st = runPipeline(input, { seeds: docRowSeeds(st) }).structure;
        expect(partitionShape(st)).toEqual(partitionShape(first));
      }
    },
    180_000,
  );
}
