/**
 * S3 structure stage (spec §6): graph → PageRank → leaves (warm-started deterministic Louvain + post-processing)
 * → identities (previous state / seeds) → parents → module edges, ranks, SCC/topo, digests. Pure: persistence is
 * `persist.ts`, the facade (WP-02) wires both.
 */
import { CHARS_PER_TOKEN, type Fact, type Iso8601, isId, type ModuleId, type RepoPath, type RepoSettings, type Xxh3 } from "@mitori/core";
import { type ModuleDetail, type ModuleSeed, PAGERANK_PERSONALIZATION, STRUCTURE_PARAMS, type StructureInfo } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import { dirOf, type StageFile } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import { clusterLeaves, dirPartition, nodeScope, undirected } from "./cluster.ts";
import { moduleDigests } from "./digests.ts";
import { buildFileGraph, edgeWeight, type FileGraph } from "./graph.ts";
import { directoryTree, groupLevel, type TreeParent } from "./hierarchy.ts";
import { assignIdentities, type Community, type Identity, type IdentityContext, type PrevModule } from "./identity.ts";
import { carryOver } from "./incremental.ts";
import { slugify } from "./index.ts";
import { modularity } from "./louvain.ts";
import { moduleNames } from "./naming.ts";
import { pagerank } from "./pagerank.ts";
import { q } from "./quantize.ts";
import { bottomUpOrder } from "./scc.ts";
import { DEFAULT_TUNING, type Tuning } from "./tuning.ts";

export interface StructurePrev {
  /** Previous modules of every level, alive and tombstoned (`persist.ts loadStructure`). */
  modules: readonly PrevModule[];
  /** γ of the previous run (`idx_meta.leiden_gamma`). */
  gamma?: number;
  /** path → blob of the graph files at the last clustering (re-cluster after > 10 % changes, spec §6.8). */
  base?: ReadonlyMap<RepoPath, string>;
}

export interface StructureInput {
  files: readonly StageFile[];
  resolved: ResolveResult;
  facts: FactsResult;
  prev: StructurePrev;
  /** Seeds from the committed doc; used only when `prev.modules` is empty (spec §6.6). */
  seeds: readonly ModuleSeed[];
  xxh3: (s: string) => Xxh3;
  now: Iso8601;
  indexDigest: Xxh3;
  /** Repo settings `modules[<prefix>]` (name / slug overrides). */
  overrides?: RepoSettings["modules"];
  /** Size / search knobs (default STRUCTURE_PARAMS; fixture truth uses TEST_TUNING). */
  tuning?: Tuning;
  /** Re-cluster even when the previous leaves could be carried over (`scan({force})`). */
  force?: boolean;
}

/** A tombstoned module (`alive: false`) and when it died. */
export type TombstoneDetail = ModuleDetail & { deadAt: Iso8601; leaf: boolean };

export interface ModuleEdge {
  from: ModuleId;
  to: ModuleId;
  weight: number;
}

export interface StructureResult {
  /** Alive modules (leaves and parents) in topological order. */
  modules: ModuleDetail[];
  /** Tombstones kept for resurrection (≤ 90 days). */
  tombstones: TombstoneDetail[];
  /** Leaf of every member and attached test file. */
  moduleOf: Map<RepoPath, ModuleId>;
  /** File PageRank (probabilities). */
  fileRank: Map<RepoPath, number>;
  graph: FileGraph;
  /** Leaf-level dependencies above the threshold (weights rounded to 2 decimals). */
  leafEdges: ModuleEdge[];
  info: StructureInfo;
  /** Notices (`notice.slug.rewritten` …). */
  notices: string[];
  /** path → blob of the graph files at the clustering these leaves come from (persisted for the next refresh). */
  base: Map<RepoPath, string>;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Deepest directory holding ≥ 60 % of the LOC (`.` for the root). */
export function dominantDir(paths: readonly RepoPath[], loc: (p: RepoPath) => number): string {
  const acc = new Map<string, number>();
  let total = 0;
  for (const p of paths) {
    const w = Math.max(1, loc(p));
    total += w;
    for (let d = dirOf(p); ; d = dirOf(d)) {
      acc.set(d, (acc.get(d) ?? 0) + w);
      if (d === "") break;
    }
  }
  let best = "";
  for (const [d, w] of acc) {
    if (w < STRUCTURE_PARAMS.dominantDirShare * total) continue;
    const depth = d === "" ? 0 : d.split("/").length;
    const bestDepth = best === "" ? 0 : best.split("/").length;
    if (depth > bestDepth || (depth === bestDepth && d < best)) best = d;
  }
  return best === "" ? "." : best;
}

/** Cross-cutting: LOC spans ≥ 2 depth-1 directories and no depth-2 directory holds 60 % (spec §6.3-5). */
export function crossCutting(paths: readonly RepoPath[], loc: (p: RepoPath) => number): { cross: boolean; top: string[] } {
  const d1 = new Map<string, number>();
  const d2 = new Map<string, number>();
  let total = 0;
  for (const p of paths) {
    const w = Math.max(1, loc(p));
    total += w;
    const segs = p.split("/");
    if (segs.length >= 2) d1.set(segs[0] as string, (d1.get(segs[0] as string) ?? 0) + w);
    // a file directly in a depth-1 directory counts for that directory (`web/app.js` is in `web`, not in no depth-2 dir)
    if (segs.length >= 2) {
      const k = segs.length >= 3 ? `${segs[0]}/${segs[1]}` : (segs[0] as string);
      d2.set(k, (d2.get(k) ?? 0) + w);
    }
  }
  const top = [...d1].sort((a, b) => b[1] - a[1] || byPath(a[0], b[0])).map(([d]) => d);
  const cross = d1.size >= 2 && [...d2.values()].every((w) => w < STRUCTURE_PARAMS.dominantDirShare * total);
  return { cross, top };
}

/** PageRank personalization (spec §6.4 [仮]). */
function personalization(fg: FileGraph, files: ReadonlyMap<RepoPath, StageFile>, facts: readonly Fact[]): Float64Array {
  const P = PAGERANK_PERSONALIZATION;
  const p = new Float64Array(fg.paths.length).fill(1);
  const mul = (path: RepoPath | undefined, k: number, seen: Set<number>) => {
    const i = path === undefined ? undefined : fg.index.get(path);
    if (i === undefined || seen.has(i)) return;
    seen.add(i);
    p[i] = (p[i] as number) * k;
  };
  const entry = new Set<number>();
  const route = new Set<number>();
  const cli = new Set<number>();
  for (const f of facts) {
    if (f.scope === "example") continue;
    if (f.kind === "entry") {
      mul(f.path, P.entry, entry);
      if (f.entry === "main") mul(f.label, P.entry, entry);
    } else if (f.kind === "route") mul(f.handler?.slice(0, f.handler.indexOf("#")) ?? f.path, P.routeHandler, route);
    else if (f.kind === "cli") mul(f.path, P.cli, cli);
  }
  fg.paths.forEach((path, i) => {
    const f = files.get(path);
    if (!f) return;
    if (f.symbols.filter((s) => s.exported).length >= P.exportDenseMinSymbols) p[i] = (p[i] as number) * P.exportDense;
    if (f.scope === "example") p[i] = (p[i] as number) * P.example;
    if (f.scope === "tooling") p[i] = (p[i] as number) * P.tooling;
  });
  return p;
}

/** Estimated sig-skeleton tokens of a file (split rule, spec §6.3-1): signatures + header. */
function sigTokens(f: StageFile): number {
  let chars = f.path.length + 8;
  for (const s of f.symbols) chars += s.signature.length + 6;
  return chars / CHARS_PER_TOKEN["claude-v5"].code;
}

export function buildStructure(input: StructureInput): StructureResult {
  const P = STRUCTURE_PARAMS;
  const tuning = input.tuning ?? DEFAULT_TUNING;
  const files = input.resolved.index.files.byPath;
  const fg = buildFileGraph(input.files, input.resolved);
  const n = fg.paths.length;
  const locOf = (p: RepoPath) => files.get(p)?.loc ?? 0;
  const notices: string[] = [];

  // visit order: xxh3("ord|" + path) ascending, path as the tie-break
  const ordKeys = fg.paths.map((p, i) => ({ i, k: input.xxh3(`ord|${p}`), p }));
  ordKeys.sort((a, b) => byPath(a.k, b.k) || byPath(a.p, b.p));
  const order = new Int32Array(n);
  ordKeys.forEach((o, r) => {
    order[o.i] = r;
  });

  // PageRank over import/ref edges
  const outList = fg.out.map((m) => [...m].map(([j, e]) => [j, edgeWeight(e)] as const).sort((a, b) => a[0] - b[0]));
  const pr = pagerank(n, outList, personalization(fg, files, input.facts.facts));
  const fileRank = new Map(fg.paths.map((p, i) => [p, pr[i] as number]));
  const rankOf = (p: RepoPath) => fileRank.get(p) ?? 0;

  // warm start: previous alive leaves → seeds' reps → DirPartition groups
  const prevLeaves = input.prev.modules.filter((m) => m.leaf);
  const seeded = input.prev.modules.length === 0 && input.seeds.length > 0;
  const seedPrev: PrevModule[] = seeded ? seedModules(input.seeds, input.now, notices) : [];
  const warmKey = new Map<RepoPath, string>();
  for (const m of prevLeaves) if (m.alive) for (const p of m.members) warmKey.set(p, `p:${m.id}`);
  for (const m of seedPrev) if (m.leaf) for (const p of m.reps) if (!warmKey.has(p)) warmKey.set(p, `s:${m.id}`);
  const dirs = dirPartition(fg.paths, fg.size, tuning);
  const labelIds = new Map<string, number>();
  const init = new Int32Array(n);
  const warm = new Uint8Array(n);
  fg.paths.forEach((p, i) => {
    const key = warmKey.get(p) ?? `d:${dirs[i]}`;
    if (!labelIds.has(key)) labelIds.set(key, labelIds.size);
    init[i] = labelIds.get(key) as number;
    warm[i] = key.startsWith("p:") ? 1 : 0;
  });
  const sig = Float64Array.from(fg.paths, (p) => sigTokens(files.get(p) as StageFile));
  const blobOf = (p: RepoPath) => files.get(p)?.blob ?? "";
  const carried = carryOver({
    fg,
    prevLeaves: seeded ? seedPrev.filter((m) => m.leaf) : prevLeaves.filter((m) => m.alive),
    base: input.prev.base,
    blobOf,
    force: input.force === true,
    tuning,
    seeded,
  });
  const raw = carried
    ? {
        ...undirected(fg, nodeScope(fg, files)),
        leaves: carried,
        oversize: carried.map((l) => l.length === 1 && (fg.size[l[0] as number] as number) > tuning.leafLocHard),
        gamma: input.prev.gamma ?? 1,
      }
    : clusterLeaves({
        fg,
        files,
        order,
        init,
        warm,
        sigTokens: sig,
        tuning,
        fresh: warmKey.size === 0,
        ...(input.prev.gamma !== undefined ? { gammaHint: input.prev.gamma } : {}),
      });
  const mergedLeaves = applyMergeInto(raw.leaves, fg, input.overrides, notices);
  const clustered = {
    ...raw,
    leaves: mergedLeaves,
    oversize: mergedLeaves.map((l) => l.length === 1 && (fg.size[l[0] as number] as number) > tuning.leafLocHard),
  };
  const base = carried && input.prev.base ? new Map(input.prev.base) : new Map(fg.paths.map((p) => [p, blobOf(p)]));

  // leaf communities
  const leafPaths = clustered.leaves.map((l) => l.map((i) => fg.paths[i] as RepoPath).sort(byPath));
  const subtreeLoc = subtreeLocOf(fg);
  const leafComms: Community[] = communitiesOf(leafPaths, true, rankOf, locOf, subtreeLoc);

  // identities (shared id / slug spaces across levels)
  const prevAll = seeded ? seedPrev : input.prev.modules;
  const ctx: IdentityContext = {
    loc: locOf,
    exists: (p) => files.has(p),
    xxh3: input.xxh3,
    now: input.now,
    takenIds: new Set(prevAll.map((m) => m.id)),
    takenSlugs: new Set(prevAll.map((m) => m.slug)),
    ...(input.overrides ? { overrides: input.overrides } : {}),
    notices,
  };
  const leafIds = assignIdentities(
    leafComms,
    prevAll.filter((m) => m.leaf && !expired(m, input.now)),
    ctx,
  );

  // leaf-level weights (directed, dependency edges only)
  const leafOfNode = new Int32Array(n).fill(-1);
  clustered.leaves.forEach((l, li) => {
    for (const v of l) leafOfNode[v] = li;
  });
  const L = clustered.leaves.length;
  const leafW = new Map<number, number>();
  fg.out.forEach((m, i) => {
    const a = leafOfNode[i] as number;
    for (const [j, e] of m) {
      const b = leafOfNode[j] as number;
      if (a !== b) leafW.set(a * L + b, (leafW.get(a * L + b) ?? 0) + edgeWeight(e));
    }
  });
  const leafAdj: number[][] = Array.from({ length: L }, () => []);
  const leafEdgesIdx: [number, number, number][] = [];
  for (const [k, w] of [...leafW].sort((x, y) => x[0] - y[0])) {
    if (w < P.moduleEdgeMin) continue;
    const a = Math.floor(k / L);
    const b = k % L;
    leafAdj[a]?.push(b);
    leafEdgesIdx.push([a, b, w]);
  }

  // ranks
  const leafRankRaw = leafPaths.map((ps) => ps.reduce((s, p) => s + rankOf(p), 0));
  const maxLeaf = Math.max(0, ...leafRankRaw);
  const leafRank = leafRankRaw.map((r) => (maxLeaf > 0 ? round2(r / maxLeaf) : 0));

  // topo (bottom-up; ties rank desc, slug asc)
  const leafCmp = (a: number, b: number) =>
    (leafRank[b] as number) - (leafRank[a] as number) || byPath((leafIds.ids[a] as Identity).slug, (leafIds.ids[b] as Identity).slug);
  const topo = bottomUpOrder(L, leafAdj, leafCmp);
  const leafTopo = new Int32Array(L);
  topo.order.forEach((li, t) => {
    leafTopo[li] = t;
  });

  // parents (≤ 2 extra levels)
  const parents = buildParents(input, leafComms, leafEdgesIdx, rankOf, locOf, subtreeLoc, ctx, prevAll, order, clustered.leaves, tuning);

  // tests → leaves
  const moduleOf = new Map<RepoPath, ModuleId>();
  leafPaths.forEach((ps, li) => {
    for (const p of ps) moduleOf.set(p, (leafIds.ids[li] as Identity).id);
  });
  const testsOf = attachTests(input, moduleOf, leafIds.ids, leafPaths, locOf);

  // assemble details
  const factsByPath = new Map<RepoPath, Fact[]>();
  input.facts.facts.forEach((f, i) => {
    if (input.facts.scopes[i] === "test" && f.kind !== "test") return;
    const list = factsByPath.get(f.path);
    if (list) list.push(f);
    else factsByPath.set(f.path, [f]);
  });
  const idOfLeaf = (li: number) => (leafIds.ids[li] as Identity).id;
  const outIds = (li: number) => leafEdgesIdx.filter(([a]) => a === li).map(([, b]) => idOfLeaf(b));
  const inIds = (li: number) => leafEdgesIdx.filter(([, b]) => b === li).map(([a]) => idOfLeaf(a));
  const details: ModuleDetail[] = [];
  const parentOfLeaf = parents.parentOfLeaf;
  leafPaths.forEach((paths, li) => {
    const id = leafIds.ids[li] as Identity;
    const c = leafComms[li] as Community;
    const tests = (testsOf.get(id.id) ?? []).sort(byPath);
    const memberFiles = paths.map((p) => files.get(p) as StageFile);
    const testFiles = tests.map((p) => files.get(p) as StageFile).filter(Boolean);
    const mfacts = [...paths, ...tests].flatMap((p) => factsByPath.get(p) ?? []);
    const dg = moduleDigests(input.xxh3, memberFiles, testFiles, mfacts, outIds(li), inIds(li));
    const parent = parentOfLeaf.get(li);
    details.push({
      id: id.id,
      slug: id.slug,
      name: id.name,
      ...(parent !== undefined ? { parent } : {}),
      children: [],
      paths,
      loc: paths.reduce((s, p) => s + locOf(p), 0),
      rank: leafRank[li] as number,
      membersDigest: dg.membersDigest,
      ifaceDigest: dg.ifaceDigest,
      crossCutting: crossCutting(paths, locOf).cross,
      topoOrder: leafTopo[li] as number,
      alive: true,
      depth: 1,
      dominantDir: c.dominantDir,
      anchor: id.anchor,
      bodyDigest: dg.bodyDigest,
      factsDigest: dg.factsDigest,
      testsDigest: dg.testsDigest,
      tests,
      ...(id.splitFrom ? { splitFrom: id.splitFrom } : {}),
      oversizeFile: clustered.oversize[li] === true,
      reps: repsOf(paths, rankOf),
      bornAt: id.bornAt,
    });
  });
  details.push(...parentDetails(parents, details, input.xxh3, factsByPath, files, locOf, rankOf));
  assignDepthAndParentTopo(details, L);

  // tombstones: unmatched previous modules + earlier tombstones within the retention window
  const matched = new Set([...leafIds.ids, ...parents.ids].map((x) => x.from).filter((x): x is ModuleId => x !== null));
  const tombstones: TombstoneDetail[] = [];
  if (!seeded)
    for (const m of input.prev.modules) {
      if (matched.has(m.id) || expired(m, input.now)) continue;
      tombstones.push(tombstoneOf(m, input.now));
    }

  const leafEdges: ModuleEdge[] = leafEdgesIdx.map(([a, b, w]) => ({ from: idOfLeaf(a), to: idOfLeaf(b), weight: round2(w) }));
  const cycles = topo.sccs
    .filter((c) => c.length >= 2)
    .map((c) => c.map(idOfLeaf).sort(byPath))
    .sort((a, b) => byPath(a[0] as string, b[0] as string));
  const leafLabels = Int32Array.from(leafOfNode);
  const dirLabels = new Int32Array(n);
  const dirIds = new Map<string, number>();
  fg.paths.forEach((p, i) => {
    const d = dirOf(p);
    if (!dirIds.has(d)) dirIds.set(d, dirIds.size);
    dirLabels[i] = dirIds.get(d) as number;
  });
  const info: StructureInfo = {
    indexDigest: input.indexDigest,
    gamma: clustered.gamma,
    modularity: q(modularity(clustered.dep, leafLabels)),
    dirModularity: q(modularity(clustered.dep, dirLabels)),
    leaves: L,
    parents: details.length - L,
    cycles,
    clustered: carried === null,
    at: input.now,
  };
  details.sort((a, b) => a.topoOrder - b.topoOrder);
  return { modules: details, tombstones, moduleOf, fileRank, graph: fg, leafEdges, info, notices, base };
}

/**
 * Repo settings `modules[<prefix>].mergeInto` (spec §6.6): every graph file under the prefix joins the leaf holding
 * the `mergeInto` path. Applied to the clustering result (the next warm start then keeps the group together) instead
 * of contracting the files before Louvain; the user's grouping wins over the size rule. Longer prefixes apply last.
 */
export function applyMergeInto(leaves: readonly number[][], fg: FileGraph, overrides: RepoSettings["modules"] | undefined, notices: string[]): number[][] {
  const rules = Object.entries(overrides ?? {})
    .filter(([, v]) => typeof v?.mergeInto === "string")
    .map(([prefix, v]) => ({ prefix: prefix.replace(/\/+$/, "").replace(/^\.$/, ""), into: v.mergeInto as RepoPath }))
    .sort((a, b) => a.prefix.length - b.prefix.length || byPath(a.prefix, b.prefix));
  if (rules.length === 0) return leaves.map((l) => [...l]);
  const leafOf = new Int32Array(fg.paths.length).fill(-1);
  leaves.forEach((l, li) => {
    for (const v of l) leafOf[v] = li;
  });
  for (const r of rules) {
    const target = fg.index.get(r.into);
    if (target === undefined) {
      notices.push(`notice.module.mergeInto.missing ${JSON.stringify(r.into).slice(0, 120)}`);
      continue;
    }
    const to = leafOf[target] as number;
    fg.paths.forEach((p, i) => {
      if (r.prefix === "" || p === r.prefix || p.startsWith(`${r.prefix}/`)) leafOf[i] = to;
    });
  }
  const groups = new Map<number, number[]>();
  for (let v = 0; v < fg.paths.length; v++) {
    const l = leafOf[v] as number;
    if (l < 0) continue;
    const g = groups.get(l);
    if (g) g.push(v);
    else groups.set(l, [v]);
  }
  return [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** `Indexer.moduleSeeds()` (CR idx-1): one seed per alive module, reps path-sorted, sorted by id. */
export function moduleSeedsOf(r: StructureResult): ModuleSeed[] {
  return r.modules
    .map((m) => ({ id: m.id, slug: m.slug, name: m.name, ...(m.parent !== undefined ? { parent: m.parent } : {}), reps: [...m.reps].sort(byPath) }))
    .sort((a, b) => byPath(a.id, b.id));
}

function expired(m: PrevModule, now: Iso8601): boolean {
  if (m.alive || m.deadAt === undefined) return false;
  return Date.parse(now) - Date.parse(m.deadAt) > STRUCTURE_PARAMS.tombstoneDays * 86_400_000;
}

function tombstoneOf(m: PrevModule, now: Iso8601): TombstoneDetail {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    ...(m.parent !== undefined ? { parent: m.parent } : {}),
    children: [],
    paths: [],
    loc: 0,
    rank: 0,
    membersDigest: "",
    ifaceDigest: "",
    crossCutting: false,
    topoOrder: -1,
    alive: false,
    depth: 0,
    dominantDir: "",
    anchor: m.anchor,
    bodyDigest: "",
    factsDigest: "",
    testsDigest: "",
    tests: [],
    ...(m.splitFrom ? { splitFrom: m.splitFrom } : {}),
    oversizeFile: false,
    reps: [...(m.reps.length > 0 ? m.reps : m.members.slice(0, STRUCTURE_PARAMS.seedReps))].sort(byPath),
    bornAt: m.bornAt,
    deadAt: m.deadAt ?? now,
    leaf: m.leaf,
  };
}

/**
 * Seeds → previous-state rows (leaf = no other seed names it as parent). Seeds come from a committed
 * `doc.index.json` (untrusted): malformed or duplicate ids are dropped with a notice — an id is printed verbatim into
 * the repo pack and is the primary key of `idx_modules`. Slugs are re-validated when matched (identity.ts).
 */
function seedModules(seeds: readonly ModuleSeed[], now: Iso8601, notices: string[]): PrevModule[] {
  const valid: ModuleSeed[] = [];
  const ids = new Set<string>();
  for (const s of seeds) {
    if (!isId("module", s.id) || ids.has(s.id) || typeof s.slug !== "string" || !Array.isArray(s.reps)) {
      notices.push(`notice.seed.dropped ${JSON.stringify(String((s as { id?: unknown }).id)).slice(0, 80)}`);
      continue;
    }
    ids.add(s.id);
    const reps = s.reps.filter((p): p is RepoPath => typeof p === "string").slice(0, STRUCTURE_PARAMS.seedReps);
    valid.push({ ...s, name: typeof s.name === "string" ? s.name.slice(0, 200) : s.slug, reps });
  }
  const parents = new Set(valid.map((s) => s.parent).filter((x): x is ModuleId => isId("module", x)));
  return valid
    .sort((a, b) => byPath(a.id, b.id))
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      ...(isId("module", s.parent) ? { parent: s.parent } : {}),
      leaf: !parents.has(s.id),
      alive: true,
      members: [],
      reps: [...s.reps],
      anchor: s.reps[0] ?? "",
      bornAt: now,
      seed: true,
    }));
}

/** Top-32 members by PageRank, stored path-sorted (CR idx-1). */
function repsOf(paths: readonly RepoPath[], rankOf: (p: RepoPath) => number): RepoPath[] {
  return [...paths]
    .sort((a, b) => rankOf(b) - rankOf(a) || byPath(a, b))
    .slice(0, STRUCTURE_PARAMS.seedReps)
    .sort(byPath);
}

/** LOC of every directory's subtree over the graph files (`.` = the root). */
function subtreeLocOf(fg: FileGraph): (dir: string) => number {
  const acc = new Map<string, number>();
  fg.paths.forEach((p, i) => {
    for (let d = dirOf(p); ; d = dirOf(d)) {
      acc.set(d, (acc.get(d) ?? 0) + (fg.size[i] as number));
      if (d === "") break;
    }
  });
  return (dir) => acc.get(dir === "." ? "" : dir) ?? 0;
}

/** Communities of one level: anchor (PageRank max, path asc), dominant dir, provisional name and slug base. */
function communitiesOf(
  sets: readonly (readonly RepoPath[])[],
  leaf: boolean,
  rankOf: (p: RepoPath) => number,
  locOf: (p: RepoPath) => number,
  subtreeLoc: (dir: string) => number,
): Community[] {
  const base = sets.map((paths) => ({
    paths,
    anchor: [...paths].sort((a, b) => rankOf(b) - rankOf(a) || byPath(a, b))[0] ?? "",
    dominantDir: dominantDir(paths, locOf),
  }));
  const names = moduleNames(base, locOf, subtreeLoc);
  return base.map((b, i) => ({
    members: b.paths,
    anchor: b.anchor,
    dominantDir: b.dominantDir,
    name: names[i]?.name ?? b.dominantDir,
    ...(names[i]?.slugBase ? { slugBase: names[i]?.slugBase } : {}),
    leaf,
  }));
}

/** Test files join their subject's leaf, else the import majority, else a module of the same directory (spec §5.4). */
export function attachTests(
  input: Pick<StructureInput, "facts" | "resolved">,
  moduleOf: Map<RepoPath, ModuleId>,
  ids: readonly { id: ModuleId }[],
  leafPaths: readonly RepoPath[][],
  locOf: (p: RepoPath) => number,
): Map<ModuleId, RepoPath[]> {
  const out = new Map<ModuleId, RepoPath[]>();
  const add = (m: ModuleId, p: RepoPath) => {
    moduleOf.set(p, m);
    const l = out.get(m);
    if (l) l.push(p);
    else out.set(m, [p]);
  };
  const dirModule = new Map<string, { id: ModuleId; loc: number }>();
  leafPaths.forEach((ps, li) => {
    for (const p of ps) {
      const d = dirOf(p);
      const cur = dirModule.get(d);
      const id = (ids[li] as { id: ModuleId }).id;
      if (!cur || locOf(p) > cur.loc) dirModule.set(d, { id, loc: locOf(p) });
    }
  });
  for (const t of input.facts.tests) {
    if (moduleOf.has(t.test)) continue; // inline Rust tests live in a member file
    const subject = t.subjects.map((s) => moduleOf.get(s)).find((x) => x !== undefined);
    if (subject) {
      add(subject, t.test);
      continue;
    }
    const votes = new Map<ModuleId, number>();
    for (const imp of input.resolved.imports.get(t.test) ?? [])
      for (const to of imp.to) {
        const m = moduleOf.get(to);
        if (m) votes.set(m, (votes.get(m) ?? 0) + 1);
      }
    const voted = [...votes].sort((a, b) => b[1] - a[1] || byPath(a[0], b[0]))[0]?.[0];
    if (voted) {
      add(voted, t.test);
      continue;
    }
    for (let d = dirOf(t.test); ; d = dirOf(d)) {
      const m = dirModule.get(d);
      if (m) {
        add(m.id, t.test);
        break;
      }
      if (d === "") break;
    }
  }
  return out;
}

interface ParentNode {
  id: Identity;
  comm: Community;
  paths: RepoPath[];
  rankRaw: number;
  level: number;
}

interface Parents {
  ids: Identity[];
  nodes: ParentNode[];
  parentOfLeaf: Map<number, ModuleId>;
  parentOfParent: Map<ModuleId, ModuleId>;
}

/**
 * Parent levels over the leaves (spec §6.3-6): the directory tree first (`hierarchy.ts directoryTree`), the leaf
 * graph when the tree does not separate the leaves. Identities are matched once for all levels (LOC-weighted members).
 */
function buildParents(
  input: StructureInput,
  leafComms: readonly Community[],
  leafEdges: readonly [number, number, number][],
  rankOf: (p: RepoPath) => number,
  locOf: (p: RepoPath) => number,
  subtreeLoc: (dir: string) => number,
  ctx: IdentityContext,
  prevAll: readonly PrevModule[],
  order: Int32Array,
  leaves: readonly number[][],
  P: Tuning,
): Parents {
  const out: Parents = { ids: [], nodes: [], parentOfLeaf: new Map(), parentOfParent: new Map() };
  let tree: TreeParent[] = directoryTree(
    leafComms.map((c) => c.dominantDir),
    P,
  );
  if (tree.length === 0 && leafComms.length > P.fanoutTarget) tree = graphParents(leafComms, leafEdges, locOf, order, leaves, P);
  if (tree.length === 0) return out;
  const leafMembers = (t: TreeParent): number[] => [...t.leaves, ...t.parents.flatMap((p) => leafMembers(tree[p] as TreeParent))];
  const members = tree.map((t) =>
    leafMembers(t)
      .flatMap((li) => (leafComms[li] as Community).members)
      .sort(byPath),
  );
  // a directory parent is named after its directory; a graph parent like a module of its own
  const named = communitiesOf(members, false, rankOf, locOf, subtreeLoc);
  const comms = tree.map((t, i): Community => {
    const c = named[i] as Community;
    return t.dir === "" ? c : { ...c, name: t.dir, slugBase: slugify(t.dir, c.anchor) };
  });
  const prevParents = prevAll.filter((m) => !m.leaf && !expired(m, input.now));
  const assigned = assignIdentities(comms, prevParents, ctx);
  out.ids.push(...assigned.ids);
  tree.forEach((t, i) => {
    const id = (assigned.ids[i] as Identity).id;
    for (const li of t.leaves) out.parentOfLeaf.set(li, id);
    for (const pi of t.parents) out.parentOfParent.set((assigned.ids[pi] as Identity).id, id);
    out.nodes.push({
      id: assigned.ids[i] as Identity,
      comm: comms[i] as Community,
      paths: members[i] as RepoPath[],
      rankRaw: (members[i] as RepoPath[]).reduce((acc, p) => acc + rankOf(p), 0),
      level: t.level,
    });
  });
  return out;
}

/** One level of graph parents (Louvain over the leaf graph, warm start = depth-1 directory), as tree parents. */
function graphParents(
  leafComms: readonly Community[],
  leafEdges: readonly [number, number, number][],
  locOf: (p: RepoPath) => number,
  order: Int32Array,
  leaves: readonly number[][],
  P: Tuning,
): TreeParent[] {
  const N = leafComms.length;
  const d1Ids = new Map<string, number>();
  const init = Int32Array.from(leafComms, (c) => {
    const d = c.dominantDir.split("/")[0] as string;
    if (!d1Ids.has(d)) d1Ids.set(d, d1Ids.size);
    return d1Ids.get(d) as number;
  });
  const und = new Map<number, number>();
  for (const [a, b, w] of leafEdges) if (a !== b) und.set(a < b ? a * N + b : b * N + a, (und.get(a < b ? a * N + b : b * N + a) ?? 0) + w);
  const firstOrder = (li: number) => Math.min(...(leaves[li] as number[]).map((v) => order[v] as number));
  const groups = groupLevel(
    {
      edges: [...und].sort((x, y) => x[0] - y[0]).map(([k, w]) => [Math.floor(k / N), k % N, w] as const),
      size: Float64Array.from(leafComms, (c) => c.members.reduce((acc, p) => acc + Math.max(1, locOf(p)), 0)),
      init,
      order: Int32Array.from(leafComms, (_, li) => firstOrder(li)),
    },
    P,
  );
  return groups.map((g) => ({ dir: "", leaves: g, parents: [], level: 1 }));
}

/** ModuleDetail rows of the parents (children, ranks per level, digests). */
function parentDetails(
  parents: Parents,
  leafDetails: readonly ModuleDetail[],
  xxh3: (s: string) => Xxh3,
  facts: ReadonlyMap<RepoPath, Fact[]>,
  files: ReadonlyMap<RepoPath, StageFile>,
  locOf: (p: RepoPath) => number,
  rankOf: (p: RepoPath) => number,
): ModuleDetail[] {
  const maxByLevel = new Map<number, number>();
  for (const n of parents.nodes) maxByLevel.set(n.level, Math.max(maxByLevel.get(n.level) ?? 0, n.rankRaw));
  return parents.nodes.map((n) => {
    const id = n.id.id;
    const childLeaves = leafDetails.filter((_, li) => parents.parentOfLeaf.get(li) === id).map((d) => d.id);
    const childParents = [...parents.parentOfParent].filter(([, p]) => p === id).map(([c]) => c);
    const memberSet = new Set(n.paths);
    const tests = leafDetails
      .filter((d) => memberSet.has(d.paths[0] as string))
      .flatMap((d) => d.tests)
      .sort(byPath);
    const dg = moduleDigests(
      xxh3,
      n.paths.map((p) => files.get(p) as StageFile),
      tests.map((t) => files.get(t) as StageFile).filter(Boolean),
      [...n.paths, ...tests].flatMap((p) => facts.get(p) ?? []),
      [],
      [],
    );
    const parent = parents.parentOfParent.get(id);
    const max = maxByLevel.get(n.level) ?? 0;
    return {
      id,
      slug: n.id.slug,
      name: n.id.name,
      ...(parent !== undefined ? { parent } : {}),
      children: [...childLeaves, ...childParents].sort(byPath),
      paths: [],
      loc: n.paths.reduce((acc, p) => acc + locOf(p), 0),
      rank: max > 0 ? round2(n.rankRaw / max) : 0,
      membersDigest: dg.membersDigest,
      ifaceDigest: dg.ifaceDigest,
      crossCutting: crossCutting(n.paths, locOf).cross,
      topoOrder: 0,
      alive: true,
      depth: 1,
      dominantDir: n.comm.dominantDir,
      anchor: n.id.anchor,
      bodyDigest: dg.bodyDigest,
      factsDigest: dg.factsDigest,
      testsDigest: dg.testsDigest,
      tests,
      ...(n.id.splitFrom ? { splitFrom: n.id.splitFrom } : {}),
      oversizeFile: false,
      reps: repsOf(n.paths, rankOf),
      bornAt: n.id.bornAt,
    };
  });
}

/** depth = 1 for top-level modules, +1 per ancestor; parents get topo slots after the leaves (by smallest leaf topo). */
function assignDepthAndParentTopo(details: ModuleDetail[], nLeaves: number): void {
  const byId = new Map(details.map((d) => [d.id, d]));
  const depthOf = (d: ModuleDetail, hops = 0): number => {
    const p = d.parent === undefined ? undefined : byId.get(d.parent);
    return p && hops < 8 ? 1 + depthOf(p, hops + 1) : 1;
  };
  for (const d of details) d.depth = depthOf(d);
  const minLeafTopo = new Map<string, number>();
  for (const d of details.slice(0, nLeaves))
    for (let p = d.parent === undefined ? undefined : byId.get(d.parent); p; p = p.parent === undefined ? undefined : byId.get(p.parent))
      minLeafTopo.set(p.id, Math.min(minLeafTopo.get(p.id) ?? Number.MAX_SAFE_INTEGER, d.topoOrder));
  const parents = details.slice(nLeaves);
  parents.sort((a, b) => b.depth - a.depth || (minLeafTopo.get(a.id) ?? 0) - (minLeafTopo.get(b.id) ?? 0) || byPath(a.slug, b.slug));
  parents.forEach((d, i) => {
    d.topoOrder = nLeaves + i;
  });
}
