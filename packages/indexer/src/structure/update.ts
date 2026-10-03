/**
 * Per-`update()` structure maintenance (spec §6.8 "update() 1 回ごと"): the edges of the changed files are rebuilt with
 * the graph, new files join a leaf (neighbour vote → same directory → nearest directory), deleted files leave, and only
 * the touched modules get new paths / LOC / digests. PageRank, Louvain, identities, ranks and topo order are carried
 * from `prev` until the structure refresh (`buildStructure`, after the quiet period). Returns null when the update
 * cannot be absorbed (no previous leaves, or a leaf lost every file): run `buildStructure` instead.
 */
import type { Fact, Iso8601, ModuleId, RepoPath, Xxh3 } from "@mitori/core";
import type { ModuleDetail } from "../contract.ts";
import { STRUCTURE_PARAMS } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import type { StageFile } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import { moduleDigests } from "./digests.ts";
import { buildFileGraph, edgeWeight } from "./graph.ts";
import { assignNewcomers } from "./incremental.ts";
import { attachTests, crossCutting, dominantDir, type ModuleEdge, type StructureResult } from "./stage.ts";
import { DEFAULT_TUNING, type Tuning } from "./tuning.ts";

export interface UpdateInput {
  files: readonly StageFile[];
  resolved: ResolveResult;
  facts: FactsResult;
  xxh3: (s: string) => Xxh3;
  indexDigest: Xxh3;
  now: Iso8601;
  /** Paths whose content changed, appeared or disappeared since `prev` (their modules are re-digested). */
  changed: readonly RepoPath[];
  tuning?: Tuning;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x: number) => Math.round(x * 100) / 100;
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function updateStructure(prev: StructureResult, u: UpdateInput): StructureResult | null {
  const tuning = u.tuning ?? DEFAULT_TUNING;
  const fg = buildFileGraph(u.files, u.resolved);
  const files = u.resolved.index.files.byPath;
  const locOf = (p: RepoPath) => files.get(p)?.loc ?? 0;
  const leaves = prev.modules.filter((m) => m.paths.length > 0);
  if (leaves.length === 0) return null;

  // membership: previous leaves, newcomers by vote
  const leafOf = new Int32Array(fg.paths.length).fill(-1);
  leaves.forEach((m, li) => {
    for (const p of m.paths) {
      const i = fg.index.get(p);
      if (i !== undefined) leafOf[i] = li;
    }
  });
  assignNewcomers(fg, leafOf);
  const members: RepoPath[][] = leaves.map(() => []);
  for (let v = 0; v < fg.paths.length; v++) {
    const l = leafOf[v] as number;
    if (l < 0) return null;
    (members[l] as RepoPath[]).push(fg.paths[v] as RepoPath); // fg.paths is sorted ⇒ members are sorted
  }
  if (members.some((m) => m.length === 0)) return null;

  // effective leaf edges (weights of the current graph)
  const L = leaves.length;
  const w = new Map<number, number>();
  fg.out.forEach((m, i) => {
    const a = leafOf[i] as number;
    for (const [j, e] of m) {
      const b = leafOf[j] as number;
      if (a !== b) w.set(a * L + b, (w.get(a * L + b) ?? 0) + edgeWeight(e));
    }
  });
  const idOf = (li: number) => (leaves[li] as ModuleDetail).id;
  const leafEdges: ModuleEdge[] = [...w]
    .filter(([, x]) => x >= STRUCTURE_PARAMS.moduleEdgeMin)
    .map(([k, x]) => ({ from: idOf(Math.floor(k / L)), to: idOf(k % L), weight: round2(x) }))
    .sort((a, b) => byPath(a.from, b.from) || byPath(a.to, b.to));
  const edgeIds = (edges: readonly ModuleEdge[]) => {
    const out = new Map<ModuleId, { o: ModuleId[]; i: ModuleId[] }>();
    const get = (id: ModuleId) => out.get(id) ?? (out.set(id, { o: [], i: [] }).get(id) as { o: ModuleId[]; i: ModuleId[] });
    for (const e of edges) {
      get(e.from).o.push(e.to);
      get(e.to).i.push(e.from);
    }
    for (const v of out.values()) {
      v.o.sort(byPath);
      v.i.sort(byPath);
    }
    return out;
  };
  const before = edgeIds(prev.leafEdges);
  const after = edgeIds(leafEdges);

  // tests follow their subjects
  const moduleOf = new Map<RepoPath, ModuleId>();
  members.forEach((ps, li) => {
    for (const p of ps) moduleOf.set(p, idOf(li));
  });
  const testsOf = attachTests({ facts: u.facts, resolved: u.resolved }, moduleOf, leaves, members, locOf);

  const factsByPath = new Map<RepoPath, Fact[]>();
  u.facts.facts.forEach((f, i) => {
    if (u.facts.scopes[i] === "test" && f.kind !== "test") return;
    const list = factsByPath.get(f.path);
    if (list) list.push(f);
    else factsByPath.set(f.path, [f]);
  });
  const changed = new Set(u.changed);
  const fileOf = (p: RepoPath) => files.get(p) as StageFile;
  const digestsOf = (paths: readonly RepoPath[], tests: readonly RepoPath[], out: ModuleId[], inn: ModuleId[]) =>
    moduleDigests(
      u.xxh3,
      paths.map(fileOf),
      tests.map((t) => files.get(t)).filter((f): f is StageFile => f !== undefined),
      [...paths, ...tests].flatMap((p) => factsByPath.get(p) ?? []),
      out,
      inn,
    );

  const next = new Map<ModuleId, ModuleDetail>();
  const touched = new Set<ModuleId>();
  leaves.forEach((m, li) => {
    const paths = members[li] as RepoPath[];
    const tests = (testsOf.get(m.id) ?? []).sort(byPath);
    const e0 = before.get(m.id) ?? { o: [], i: [] };
    const e1 = after.get(m.id) ?? { o: [], i: [] };
    const dirty =
      !sameList(paths, m.paths) ||
      !sameList(tests, m.tests) ||
      !sameList(e0.o, e1.o) ||
      !sameList(e0.i, e1.i) ||
      paths.some((p) => changed.has(p)) ||
      tests.some((p) => changed.has(p)) ||
      m.tests.some((p) => changed.has(p));
    if (!dirty) return;
    touched.add(m.id);
    const dg = digestsOf(paths, tests, e1.o, e1.i);
    const loc = paths.reduce((s, p) => s + locOf(p), 0);
    next.set(m.id, {
      ...m,
      paths,
      tests,
      loc,
      membersDigest: dg.membersDigest,
      ifaceDigest: dg.ifaceDigest,
      bodyDigest: dg.bodyDigest,
      factsDigest: dg.factsDigest,
      testsDigest: dg.testsDigest,
      crossCutting: crossCutting(paths, locOf).cross,
      dominantDir: dominantDir(paths, locOf),
      oversizeFile: paths.length === 1 && loc > tuning.leafLocHard,
    });
  });

  // parents above a touched leaf aggregate their (new) leaves
  const byId = new Map(prev.modules.map((m) => [m.id, m]));
  const dirtyParents = new Set<ModuleId>();
  for (const id of touched) for (let p = byId.get(id)?.parent, hops = 0; p !== undefined && hops < 8; p = byId.get(p)?.parent, hops++) dirtyParents.add(p);
  const leavesBelow = (m: ModuleDetail): ModuleDetail[] =>
    m.paths.length > 0 ? [next.get(m.id) ?? m] : m.children.flatMap((c) => (byId.has(c) ? leavesBelow(byId.get(c) as ModuleDetail) : []));
  for (const id of dirtyParents) {
    const m = byId.get(id) as ModuleDetail;
    const below = leavesBelow(m);
    const paths = below.flatMap((x) => x.paths).sort(byPath);
    const tests = below.flatMap((x) => x.tests).sort(byPath);
    const dg = digestsOf(paths, tests, [], []);
    next.set(id, {
      ...m,
      loc: paths.reduce((s, p) => s + locOf(p), 0),
      membersDigest: dg.membersDigest,
      ifaceDigest: dg.ifaceDigest,
      bodyDigest: dg.bodyDigest,
      factsDigest: dg.factsDigest,
      testsDigest: dg.testsDigest,
      tests,
      crossCutting: crossCutting(paths, locOf).cross,
    });
  }

  const fileRank = new Map<RepoPath, number>();
  for (const p of fg.paths) fileRank.set(p, prev.fileRank.get(p) ?? 0);
  return {
    modules: prev.modules.map((m) => next.get(m.id) ?? m),
    tombstones: prev.tombstones,
    moduleOf,
    fileRank,
    graph: fg,
    leafEdges,
    info: { ...prev.info, indexDigest: u.indexDigest, clustered: false, at: u.now },
    notices: [],
    base: prev.base,
  };
}
