import { describe, expect, test } from "bun:test";
import { isId, type ModuleId, type RepoPath, SLUG_RE } from "@mitori/core";
import type { ModuleDetail, ModuleSeed } from "../contract.ts";
import { linkFacts } from "../facts/stage.ts";
import { resolveImports } from "../resolve/stage.ts";
import { imp, input, ref, sf } from "../resolve/test/stage-files.ts";
import { dependents, graphData } from "./graph-data.ts";
import { assignIdentities, type Community, type IdentityContext, type PrevModule } from "./identity.ts";
import { moduleIdFor, slugify } from "./index.ts";
import { buildUGraph, louvain, modularity, splitDisconnected } from "./louvain.ts";
import { pagerank } from "./pagerank.ts";
import { loadStructure, saveStructure } from "./persist.ts";
import { bottomUpOrder, tarjan } from "./scc.ts";
import { moduleSeedsOf } from "./stage.ts";
import { memDb } from "./test/db.ts";
import { NOW, runPipeline, xxh3 } from "./test/pipeline.ts";
import { TEST_TUNING } from "./tuning.ts";
import { updateStructure } from "./update.ts";

describe("IDX-U module ids and slugs (spec §6.6)", () => {
  test("moduleIdFor is md_ + 8 base32 chars of xxh3(md|anchor|n), deterministic and n-sensitive", () => {
    const a = moduleIdFor("internal/session/session.go", 0, xxh3);
    expect(a).toMatch(/^md_[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
    expect(moduleIdFor("internal/session/session.go", 0, xxh3)).toBe(a);
    expect(moduleIdFor("internal/session/session.go", 1, xxh3)).not.toBe(a);
  });
  test("slugify drops noise segments, keeps the last 3, normalizes, falls back to the anchor stem at the root", () => {
    expect(slugify("internal/session", "internal/session/a.go")).toBe("internal-session");
    expect(slugify("packages/core/src/lib", "x.ts")).toBe("core");
    expect(slugify("src", "src/index.ts")).toBe("src");
    expect(slugify("a/b/c/d/e", "x")).toBe("c-d-e");
    expect(slugify(".", "cli_dispatch.go")).toBe("cli-dispatch");
    expect(slugify("ＡＰＩ/Ｖ２", "x")).toBe("api-v2");
    expect(slugify("日本語", "メモ.md")).toBe("module");
    expect(slugify("a".repeat(80), "x").length).toBeLessThanOrEqual(48);
    for (const s of ["internal-session", "core", "c-d-e", "api-v2"]) expect(SLUG_RE.test(s)).toBe(true);
  });
});

describe("IDX-U deterministic Louvain (spec §6.2 R1)", () => {
  // two 4-cliques joined by one weak bridge
  const edges: [number, number, number][] = [];
  for (const g of [0, 4]) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) edges.push([g + a, g + b, 1]);
  edges.push([3, 4, 0.1]);
  const g = buildUGraph(8, edges, new Float64Array(8).fill(100));
  const order = Int32Array.from([5, 1, 7, 0, 3, 6, 2, 4]);
  test("finds the two cliques, with the same labels on every run", () => {
    const a = louvain(g, { gamma: 1, maxSize: 1e9, order });
    const b = louvain(g, { gamma: 1, maxSize: 1e9, order });
    expect([...a]).toEqual([...b]);
    expect(new Set(a.slice(0, 4)).size).toBe(1);
    expect(new Set(a.slice(4)).size).toBe(1);
    expect(a[0]).not.toBe(a[4]);
    expect(modularity(g, a)).toBeGreaterThan(0.4);
  });
  test("the size cap is never exceeded by a move; warm start + hysteresis keeps a good partition", () => {
    const capped = louvain(g, { gamma: 0.01, maxSize: 250, order });
    const sizes = new Map<number, number>();
    for (const l of capped) sizes.set(l, (sizes.get(l) ?? 0) + 100);
    expect(Math.max(...sizes.values())).toBeLessThanOrEqual(250);
    const warm = louvain(g, { gamma: 1, maxSize: 1e9, order, init: Int32Array.from([0, 0, 0, 0, 1, 1, 1, 1]), hysteresis: 1e-4 });
    expect([...warm]).toEqual([0, 0, 0, 0, 1, 1, 1, 1].map((x) => (x === 0 ? (warm[0] as number) : (warm[4] as number))));
  });
  test("disconnected communities are split by BFS", () => {
    const h = buildUGraph(
      4,
      [
        [0, 1, 1],
        [2, 3, 1],
      ],
      new Float64Array(4).fill(1),
    );
    const labels = splitDisconnected(h, Int32Array.from([0, 0, 0, 0]), Int32Array.from([0, 1, 2, 3]));
    expect([...labels]).toEqual([0, 0, 1, 1]);
  });
});

describe("IDX-U PageRank / Tarjan (spec §6.4–6.5)", () => {
  test("PageRank: sinks of a chain rank highest; personalization lifts a node; Σ = 1", () => {
    const r = pagerank(3, [[[1, 1]], [[2, 1]], []], new Float64Array([1, 1, 1]));
    expect((r[2] as number) > (r[1] as number) && (r[1] as number) > (r[0] as number)).toBe(true);
    expect([...r].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const p = pagerank(3, [[], [], []], new Float64Array([5, 1, 1]));
    expect((p[0] as number) > (p[1] as number)).toBe(true);
  });
  test("IDX-AT-37 cycles are reported and the order puts dependencies first (except inside an SCC)", () => {
    // 0 → 1 → 2 → 1 (cycle {1,2}), 3 → 0, 4 isolated
    const adj = [[1], [2], [1], [0], []];
    const sccs = tarjan(5, adj)
      .filter((c) => c.length > 1)
      .map((c) => c.sort());
    expect(sccs).toEqual([[1, 2]]);
    const { order } = bottomUpOrder(5, adj, (a, b) => a - b);
    const pos = new Map(order.map((v, i) => [v, i]));
    for (let u = 0; u < 5; u++)
      for (const v of adj[u] ?? []) {
        const inScc = sccs.some((c) => c.includes(u) && c.includes(v));
        if (!inScc) expect(pos.get(v) as number).toBeLessThan(pos.get(u) as number);
      }
    expect(order).toHaveLength(5);
    // deep chains do not overflow (iterative)
    const n = 50_000;
    const chain = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : []));
    expect(tarjan(n, chain)).toHaveLength(n);
  });
});

describe("IDX-U name-reference edges (spec §4.6)", () => {
  test("names bind within a language family only (TS ↔ JS yes, Python → TS no)", () => {
    const def = { name: "renderInvoice", kind: "function" as const };
    const files = [
      sf("web/invoice.ts", { symbols: [def] }),
      sf("web/page.js", { refs: [ref("renderInvoice", 2)] }),
      sf("jobs/report.py", { refs: [ref("renderInvoice", 2)] }),
      ...Array.from({ length: 8 }, (_, i) => sf(`pad/p${i}.ts`)),
    ];
    const g = runPipeline(input(files)).structure.graph;
    const edge = (a: string, b: string) => g.out[g.index.get(a) as number]?.get(g.index.get(b) as number);
    expect(edge("web/page.js", "web/invoice.ts")?.ref ?? 0).toBeGreaterThan(0);
    expect(edge("jobs/report.py", "web/invoice.ts")).toBeUndefined();
  });
});

describe("IDX-U identity matching (spec §6.6)", () => {
  const ctx = (): IdentityContext => ({ loc: () => 100, exists: () => true, xxh3, now: NOW, takenIds: new Set(), takenSlugs: new Set(), notices: [] });
  const comm = (members: string[], dominantDir = "a"): Community => ({ members, anchor: members[0] as string, dominantDir, name: dominantDir, leaf: true });
  const prev = (id: string, slug: string, members: string[], over: Partial<PrevModule> = {}): PrevModule => ({
    id: id as ModuleId,
    slug,
    name: slug,
    leaf: true,
    alive: true,
    members,
    reps: members,
    anchor: members[0] as string,
    bornAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  test("J ≥ 0.5 keeps id / slug / name; a split keeps lineage; unmatched old modules are returned", () => {
    const c = ctx();
    const old = [prev("md_aaaaaaaa", "core", ["a/1", "a/2", "a/3", "a/4"]), prev("md_bbbbbbbb", "gone", ["z/1"])];
    for (const o of old) {
      c.takenIds.add(o.id);
      c.takenSlugs.add(o.slug);
    }
    const r = assignIdentities([comm(["a/1", "a/2", "a/3"]), comm(["a/4", "a/5"], "a")], old, c);
    expect(r.ids[0]).toMatchObject({ id: "md_aaaaaaaa", slug: "core", from: "md_aaaaaaaa" });
    expect(r.ids[1]?.from).toBeNull();
    expect(r.ids[1]?.slug).toBe("a");
    expect(r.unmatched.map((m) => m.id)).toEqual(["md_bbbbbbbb"]);
    const split = assignIdentities([comm(["a/1", "a/2"]), comm(["a/3", "a/4"])], [prev("md_cccccccc", "c", ["a/1", "a/2", "a/3", "a/4"])], ctx());
    expect(split.ids.map((x) => x.from)).toEqual(["md_cccccccc", null]);
    expect(split.ids[1]?.splitFrom).toBe("md_cccccccc");
  });
  test("tombstones resurrect by representative hits; seeds match by reps and invalid seed slugs are rewritten", () => {
    const t = assignIdentities([comm(["a/1", "a/2"])], [prev("md_dddddddd", "back", [], { alive: false, reps: ["a/1", "a/2"], deadAt: NOW })], ctx());
    expect(t.ids[0]?.id).toBe("md_dddddddd");
    const c = ctx();
    const s = assignIdentities([comm(["a/1", "a/2", "a/3"])], [prev("md_eeeeeeee", "../evil", [], { seed: true, reps: ["a/1", "a/2"] })], c);
    expect(s.ids[0]?.id).toBe("md_eeeeeeee");
    expect(SLUG_RE.test(s.ids[0]?.slug ?? "")).toBe(true);
    expect(c.notices.some((n) => n.startsWith("notice.slug.rewritten"))).toBe(true);
  });
  test("newborn slugs never collide (with alive or tombstoned modules)", () => {
    const c = ctx();
    c.takenSlugs.add("a");
    const r = assignIdentities([comm(["a/1"]), comm(["a/2"])], [], c);
    expect(r.ids.map((x) => x.slug)).toEqual(["a-2", "a-3"]);
    expect(new Set(r.ids.map((x) => x.id)).size).toBe(2);
  });
});

/** A small repo: three directories of related files with a clear dependency structure. */
function smallRepo(extra: Parameters<typeof sf>[] = []) {
  const files = [
    sf("api/routes.ts", { loc: 120, imports: [imp("../store/repo.ts"), imp("../core/model.ts")] }),
    sf("api/handlers.ts", { loc: 110, imports: [imp("./routes.ts"), imp("../core/model.ts")] }),
    sf("store/repo.ts", { loc: 130, imports: [imp("../core/model.ts"), imp("./db.ts")] }),
    sf("store/db.ts", { loc: 90, imports: [imp("./sql.ts")] }),
    sf("store/sql.ts", { loc: 80 }),
    sf("core/model.ts", { loc: 100, symbols: [{ name: "Model", kind: "class" }] }),
    sf("core/util.ts", { loc: 60, imports: [imp("./model.ts")] }),
    sf("ui/view.tsx", { loc: 140, imports: [imp("../api/routes.ts")], refs: [ref("Model", 2, "type")] }),
    sf("ui/form.tsx", { loc: 150, imports: [imp("./view.tsx")] }),
    sf("test/repo.test.ts", { imports: [imp("../store/repo.ts")], tests: [{ name: "repo works", line: 1 }] }),
    ...extra.map((a) => sf(...a)),
  ];
  return input(files);
}

describe("IDX-U structure stage on a small repo (TEST_TUNING)", () => {
  test("leaves are size-bounded, tests attach to their subject, ids/slugs are valid and topo is bottom-up", () => {
    const p = runPipeline(smallRepo(), { tuning: TEST_TUNING });
    const leaves = p.structure.modules.filter((m) => m.paths.length > 0);
    expect(leaves.length).toBeGreaterThanOrEqual(2);
    for (const m of p.structure.modules) {
      expect(m.id).toMatch(/^md_/);
      expect(SLUG_RE.test(m.slug)).toBe(true);
    }
    expect(p.structure.moduleOf.get("test/repo.test.ts")).toBe(p.structure.moduleOf.get("store/repo.ts"));
    const topo = new Map(p.structure.modules.map((m) => [m.id, m.topoOrder]));
    const inCycle = (a: ModuleId, b: ModuleId) => p.structure.info.cycles.some((c) => c.includes(a) && c.includes(b));
    for (const e of p.structure.leafEdges) if (!inCycle(e.from, e.to)) expect(topo.get(e.to) as number).toBeLessThan(topo.get(e.from) as number);
  });

  test("persist → load round trip feeds the next scan: same ids, tombstones kept, γ reused", () => {
    const db = memDb();
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING });
    saveStructure(db, first.structure, NOW);
    const prev = loadStructure(db);
    expect(
      prev.modules
        .filter((m) => m.alive)
        .map((m) => m.id)
        .sort(),
    ).toEqual(first.structure.modules.map((m) => m.id).sort());
    expect(prev.gamma).toBe(first.structure.info.gamma);
    const second = runPipeline(smallRepo(), { tuning: TEST_TUNING, prev });
    expect(second.structure.modules.map((m) => [m.id, m.slug, m.paths])).toEqual(first.structure.modules.map((m) => [m.id, m.slug, m.paths]));
    expect(second.structure.tombstones).toEqual([]);
    expect(second.structure.info.clustered).toBe(false); // nothing changed: the refresh carries the leaves over (§6.8)
  });

  test("refresh (§6.8): a new file joins its strongest neighbour's module; > 10 % changes or force re-cluster", () => {
    const db = memDb();
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING });
    saveStructure(db, first.structure, NOW);
    const prev = loadStructure(db);
    const grown = runPipeline(smallRepo([["store/cache.ts", { loc: 40, imports: [imp("./db.ts"), imp("./sql.ts")] }]]), { tuning: TEST_TUNING, prev });
    expect(grown.structure.info.clustered).toBe(false);
    expect(grown.structure.moduleOf.get("store/cache.ts")).toBe(grown.structure.moduleOf.get("store/db.ts"));
    expect(grown.structure.modules.map((m) => m.id).sort()).toEqual(first.structure.modules.map((m) => m.id).sort());
    expect(runPipeline(smallRepo(), { tuning: TEST_TUNING, prev, force: true }).structure.info.clustered).toBe(true);
    const many = smallRepo(Array.from({ length: 5 }, (_, i) => [`extra/f${i}.ts`, { loc: 30 }] as Parameters<typeof sf>));
    expect(runPipeline(many, { tuning: TEST_TUNING, prev }).structure.info.clustered).toBe(true);
  });

  test("graph export (§8): file level stays ≤ 300 nodes for a huge module, and a parent focus shows its leaves' files", () => {
    const many = input(
      Array.from({ length: 400 }, (_, i) => sf(`flat/f${String(i).padStart(3, "0")}.ts`, { loc: 2, imports: i > 0 ? [imp("./f000.ts")] : [] })),
    );
    const st = runPipeline(many).structure;
    expect(st.modules).toHaveLength(1); // < 2,000 LOC: one module
    const g = graphData(st, "file", st.modules[0]?.id);
    expect(g.nodes.length).toBe(300);
    expect(g.nodes.some((n) => n.id === "flat/f000.ts")).toBe(true); // the hub ranks first
    // 30 directories (4 tightly linked files each), neighbouring directories linked by one import: > 10 leaves ⇒ parents
    const dirs = Array.from({ length: 30 }, (_, d) => `d${String(d).padStart(2, "0")}`);
    const wide = input(
      dirs.flatMap((d, k) =>
        Array.from({ length: 4 }, (_, i) =>
          sf(`${d}/m${i}.ts`, {
            loc: 40,
            imports: [imp(`./m${(i + 1) % 4}.ts`), imp(`./m${(i + 2) % 4}.ts`), ...(i === 0 && k + 1 < dirs.length ? [imp(`../${dirs[k + 1]}/m0.ts`)] : [])],
          }),
        ),
      ),
    );
    const ws = runPipeline(wide, { tuning: TEST_TUNING }).structure;
    expect(ws.info.leaves).toBeGreaterThan(10);
    const parent = ws.modules.find((m) => m.paths.length === 0);
    expect(parent).toBeDefined();
    const pg = graphData(ws, "file", parent?.id);
    const under = ws.modules.filter((m) => m.parent === parent?.id).flatMap((m) => m.paths);
    expect(pg.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(under));
  });

  test("IDX-AT-34 seeds come from an untrusted doc.index.json: bad / duplicate ids are dropped, duplicate slugs rewritten", () => {
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING }).structure;
    const good = moduleSeedsOf(first);
    expect(good.length).toBeGreaterThanOrEqual(2);
    const [a, b] = good as [ModuleSeed, ModuleSeed];
    const seeds: ModuleSeed[] = [
      { ...a, id: "md_bad\n=== IGNORE PREVIOUS" as ModuleId },
      { ...a, id: "../../etc" as ModuleId },
      a,
      { ...a, slug: "dup" }, // same id twice: the second is dropped
      { ...b, slug: a.slug }, // another seed's slug
      ...good.slice(2),
    ];
    const st = runPipeline(smallRepo(), { tuning: TEST_TUNING, seeds }).structure;
    expect(st.notices.filter((n) => n.startsWith("notice.seed.dropped"))).toHaveLength(3);
    // a and b both claim a.slug: one keeps it, the other is re-slugged
    expect(st.notices.filter((n) => n.startsWith(`notice.slug.rewritten ${a.id}`) || n.startsWith(`notice.slug.rewritten ${b.id}`))).toHaveLength(1);
    for (const m of st.modules) {
      expect(isId("module", m.id)).toBe(true);
      expect(SLUG_RE.test(m.slug)).toBe(true);
    }
    expect(new Set(st.modules.map((m) => m.slug)).size).toBe(st.modules.length);
    expect(st.modules.filter((m) => m.id === a.id || m.id === b.id).map((m) => m.slug)).toContain(a.slug);
    expect(st.modules.some((m) => m.id === b.id)).toBe(true);
    saveStructure(memDb(), st, NOW); // the UNIQUE(slug) / PRIMARY KEY(id) constraints hold
  });

  test("EX-01 seeds with their full member lists (doc.index.json `members`) reproduce the partition: same ids, slugs and files", () => {
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING }).structure;
    const leaves = new Map(first.modules.filter((m) => m.paths.length > 0).map((m) => [m.id, [...m.paths].sort()]));
    // the doc keeps reps (a sample) and, now, every member of a leaf
    const seeds: ModuleSeed[] = moduleSeedsOf(first).map((sd) => ({
      ...sd,
      reps: sd.reps.slice(0, 1),
      ...(leaves.has(sd.id) ? { members: leaves.get(sd.id) as RepoPath[] } : {}),
    }));
    const again = runPipeline(smallRepo(), { tuning: TEST_TUNING, seeds }).structure;
    const shape = (st: typeof first) =>
      st.modules.map((m) => ({ id: m.id, slug: m.slug, parent: m.parent ?? null, paths: [...m.paths].sort() })).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(shape(again)).toEqual(shape(first));
    expect(again.info.clustered).toBe(false); // carried, not re-clustered
  });

  test("seed restore never carries a stale doc whose few surviving reps would soak up the repo (size cap)", () => {
    const seeds: ModuleSeed[] = [{ id: "md_aaaaaaaa", slug: "old", name: "old", reps: ["api/routes.ts", "gone/x.ts"] }];
    const st = runPipeline(smallRepo(), { tuning: TEST_TUNING, seeds }).structure;
    expect(st.info.clustered).toBe(true);
    const leaves = st.modules.filter((m) => m.paths.length > 0);
    expect(leaves.length).toBeGreaterThanOrEqual(2);
    for (const m of leaves) if (m.paths.length > 1) expect(m.loc).toBeLessThanOrEqual(TEST_TUNING.leafLocHard);
    expect(st.moduleOf.get("api/routes.ts")).toBe("md_aaaaaaaa" as ModuleId); // its leaf still continues the seed
  });

  test("update() path (§6.8): new files join their neighbours' module, only touched modules are re-digested", () => {
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING });
    const upd = (extra: Parameters<typeof sf>[], changed: string[], edit?: (f: ReturnType<typeof sf>) => ReturnType<typeof sf>) => {
      const inp = smallRepo(extra);
      const files = edit ? inp.files.map(edit) : inp.files;
      const res = resolveImports({ files, texts: inp.texts });
      const facts = linkFacts({ files, texts: inp.texts }, res);
      return updateStructure(first.structure, { files, resolved: res, facts, xxh3, indexDigest: "1", now: NOW, changed, tuning: TEST_TUNING });
    };
    // a new file importing store/db.ts and store/sql.ts
    const grown = upd([["store/cache.ts", { loc: 40, imports: [imp("./db.ts"), imp("./sql.ts")] }]], ["store/cache.ts"]);
    if (!grown) throw new Error("update not absorbed");
    const home = first.structure.moduleOf.get("store/db.ts") as ModuleId;
    expect(grown.moduleOf.get("store/cache.ts")).toBe(home);
    expect(grown.modules.map((m) => [m.id, m.slug, m.topoOrder])).toEqual(first.structure.modules.map((m) => [m.id, m.slug, m.topoOrder]));
    const before = new Map(first.structure.modules.map((m) => [m.id, m]));
    for (const m of grown.modules) {
      const old = before.get(m.id) as ModuleDetail;
      if (m.id === home || m.children.includes(home)) expect(m.membersDigest).not.toBe(old.membersDigest);
      else if (m.paths.length > 0) expect(m).toBe(old); // untouched modules are the very same objects
    }
    // the same assignment the structure refresh (carry-over) makes
    const db = memDb();
    saveStructure(db, first.structure, NOW);
    const refreshed = runPipeline(smallRepo([["store/cache.ts", { loc: 40, imports: [imp("./db.ts"), imp("./sql.ts")] }]]), {
      tuning: TEST_TUNING,
      prev: loadStructure(db),
    }).structure;
    for (const m of refreshed.modules) if (m.paths.length > 0) expect(grown.modules.find((x) => x.id === m.id)?.paths).toEqual(m.paths);
    // a body-only edit re-digests its module's body digest only
    const edited = upd([], ["core/model.ts"], (f) =>
      f.path === "core/model.ts" ? { ...f, symbols: f.symbols.map((s) => ({ ...s, bodyHash: "changed" })) } : f,
    );
    const mod = first.structure.moduleOf.get("core/model.ts") as ModuleId;
    const a = first.structure.modules.find((m) => m.id === mod) as ModuleDetail;
    const b = edited?.modules.find((m) => m.id === mod) as ModuleDetail;
    expect(b.bodyDigest).not.toBe(a.bodyDigest);
    expect([b.membersDigest, b.ifaceDigest, b.paths]).toEqual([a.membersDigest, a.ifaceDigest, a.paths]);
    // a leaf that loses every file needs the refresh
    const leaf = first.structure.modules.find((m) => m.paths.length > 0) as ModuleDetail;
    const gone = new Set(leaf.paths);
    const inp = smallRepo();
    const files = inp.files.filter((f) => !gone.has(f.path));
    const res = resolveImports({ files, texts: inp.texts });
    expect(
      updateStructure(first.structure, {
        files,
        resolved: res,
        facts: linkFacts({ files, texts: inp.texts }, res),
        xxh3,
        indexDigest: "2",
        now: NOW,
        changed: [...gone],
      }),
    ).toBeNull();
  });

  test("update() path is cheap: a 1-file change on a 300-file repo", () => {
    const big = input(
      Array.from({ length: 300 }, (_, i) =>
        sf(`p${Math.floor(i / 20)}/f${i}.ts`, {
          loc: 60,
          imports: [imp(`./f${Math.floor(i / 20) * 20}.ts`), ...(i % 20 === 0 && i > 0 ? [imp(`../p${i / 20 - 1}/f${i - 20}.ts`)] : [])],
        }),
      ),
    );
    const first = runPipeline(big).structure;
    const files = big.files.map((f) => (f.path === "p3/f65.ts" ? { ...f, blob: "x", loc: 61 } : f));
    const res = resolveImports({ files, texts: big.texts });
    const facts = linkFacts({ files, texts: big.texts }, res);
    const t0 = performance.now();
    const r = updateStructure(first, { files, resolved: res, facts, xxh3, indexDigest: "1", now: NOW, changed: ["p3/f65.ts"] });
    expect(performance.now() - t0).toBeLessThan(500); // generous; the update path is timed by bench idx.update.1file
    expect(r?.modules.map((m) => m.id)).toEqual(first.modules.map((m) => m.id));
  });

  test("repo-settings mergeInto pins a prefix into the module holding the target path (spec §6.6)", () => {
    const plain = runPipeline(smallRepo(), { tuning: TEST_TUNING }).structure.moduleOf;
    expect(plain.get("ui/view.tsx")).not.toBe(plain.get("store/db.ts") as ModuleId);
    const p = runPipeline(smallRepo(), { tuning: TEST_TUNING, overrides: { "ui/": { mergeInto: "store/db.ts" }, nope: { mergeInto: "missing.ts" } } });
    const m = p.structure.moduleOf;
    expect(m.get("ui/view.tsx")).toBe(m.get("store/db.ts") as ModuleId);
    expect(m.get("ui/form.tsx")).toBe(m.get("store/db.ts") as ModuleId);
    expect(p.structure.notices.some((n) => n.startsWith("notice.module.mergeInto.missing"))).toBe(true);
    // it survives the next refresh (carried leaves) and a forced re-cluster
    const db = memDb();
    saveStructure(db, p.structure, NOW);
    for (const force of [false, true]) {
      const again = runPipeline(smallRepo(), { tuning: TEST_TUNING, prev: loadStructure(db), force, overrides: { "ui/": { mergeInto: "store/db.ts" } } });
      expect(again.structure.moduleOf.get("ui/view.tsx")).toBe(again.structure.moduleOf.get("store/db.ts") as ModuleId);
    }
  });

  test("repo-settings names win over inherited names; ids and slugs stay", () => {
    const db = memDb();
    const first = runPipeline(smallRepo(), { tuning: TEST_TUNING }).structure;
    saveStructure(db, first, NOW);
    const leaf = first.modules.find((m) => m.paths.includes("store/repo.ts")) as ModuleDetail;
    const p = runPipeline(smallRepo(), { tuning: TEST_TUNING, prev: loadStructure(db), overrides: { [leaf.dominantDir]: { name: "保存層" } } });
    const again = p.structure.modules.find((m) => m.id === leaf.id);
    expect(again).toMatchObject({ id: leaf.id, slug: leaf.slug, name: "保存層" });
  });

  test("graph export (§8): module level = leaves with effective edges; file level = members + 1 hop; no prior edges", () => {
    const p = runPipeline(smallRepo(), { tuning: TEST_TUNING });
    const mod = graphData(p.structure, "module");
    expect(mod.nodes.map((n) => n.id).sort()).toEqual(
      p.structure.modules
        .filter((m) => m.paths.length > 0)
        .map((m) => m.id)
        .sort(),
    );
    for (const e of mod.edges) expect(mod.nodes.some((n) => n.id === e.from) && mod.nodes.some((n) => n.id === e.to)).toBe(true);
    const leaf = p.structure.modules.find((m) => m.paths.includes("store/repo.ts"));
    const file = graphData(p.structure, "file", leaf?.id);
    expect(file.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(leaf?.paths ?? []));
    expect(file.edges.every((e) => e.kind !== "same_dir")).toBe(true);
    expect(file.edges.some((e) => e.from === "api/routes.ts" && e.to === "store/repo.ts")).toBe(true);
    expect(dependents(p.structure, "core/model.ts").map((d) => d.path)).toEqual(
      expect.arrayContaining(["api/routes.ts", "api/handlers.ts", "store/repo.ts", "core/util.ts", "ui/view.tsx"]),
    );
    expect(dependents(p.structure, "core/model.ts").find((d) => d.path === "store/repo.ts")).toMatchObject({ kind: "import", weight: 1 });
    expect(dependents(p.structure, "test/repo.test.ts")).toEqual([]); // tests are not graph nodes
    const seeds = moduleSeedsOf(p.structure);
    expect(seeds.map((x) => x.id)).toEqual([...seeds.map((x) => x.id)].sort());
    for (const sd of seeds) expect(sd.reps).toEqual([...sd.reps].sort());
  });
});
