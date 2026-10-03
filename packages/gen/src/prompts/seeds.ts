/**
 * Flow seeds of a run (gen.flows SEEDS, its planning and its skip rule). The index's own seeds come from entry facts
 * (routes, CLI commands, `main`); a frontend app or a library often has none (m3e-canvas: a Next.js app whose only entry
 * fact is `package.json` `start`, so §3 stayed "not generated" for a newcomer [real run 2026-10-04]). Then seeds are
 * derived from the file graph: start files are the non-test files of the root leaf modules (no incoming edge from
 * another leaf; else the most "outgoing" one), most outgoing first, each seeded at its main exported callable. From
 * the main start, one seed per important module (rank desc) follows the shortest file path into it; then each start's
 * strongest import / call edge walk (≤ 5 hops) fills up — like the index's own walk, so `flowBodies` finds the called
 * symbols hop by hop. `modules` lists the modules of the walked files in order. Deterministic: a function of the index
 * only, so plans and cache keys stay stable.
 */
import type { ModuleId, RepoPath, SymbolEntry } from "@mitori/core";
import type { FlowSeed, Indexer } from "@mitori/indexer";

/** Seeds per run (gen spec §5.2 SEEDS). */
export const FLOW_SEED_LIMIT = 8;
/** Derived seeds: at most this many (the prompt writes one flow per useful seed). */
export const DERIVED_SEEDS_MAX = 3;
const MAX_HOPS = 5;
const CALLABLE: ReadonlySet<string> = new Set(["function", "method", "class", "constructor"]);
const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|spec|e2e)\/|[._-](test|spec)\.[A-Za-z0-9]+$/;

type SeedIndex = Pick<Indexer, "flowSeeds" | "modules" | "graph" | "symbols">;

/** The run's flow seeds: the index's, or seeds derived from the file graph when the index has none. */
export function genFlowSeeds(ix: SeedIndex, limit = FLOW_SEED_LIMIT): FlowSeed[] {
  const own = ix.flowSeeds(limit);
  return own.length > 0 ? own : derivedSeeds(ix, Math.min(limit, DERIVED_SEEDS_MAX));
}

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Seeds from the file graph (see the file comment). */
export function derivedSeeds(ix: Pick<Indexer, "modules" | "graph" | "symbols">, limit: number): FlowSeed[] {
  if (limit <= 0) return [];
  const leaves = ix.modules().filter((m) => m.children.length === 0 && m.paths.some((p) => !TEST_PATH_RE.test(p)));
  if (leaves.length === 0) return [];
  const leafIds = new Set<string>(leaves.map((m) => m.id));
  const inW = new Map<string, number>();
  const outW = new Map<string, number>();
  for (const e of ix.graph("module").edges) {
    if (!leafIds.has(e.from) || !leafIds.has(e.to) || e.from === e.to) continue;
    inW.set(e.to, (inW.get(e.to) ?? 0) + e.weight);
    outW.set(e.from, (outW.get(e.from) ?? 0) + e.weight);
  }
  const score = (id: string) => (outW.get(id) ?? 0) - (inW.get(id) ?? 0);
  const order = (a: (typeof leaves)[number], b: (typeof leaves)[number]) => score(b.id) - score(a.id) || b.rank - a.rank || byStr(a.id, b.id);
  let roots = leaves.filter((m) => (inW.get(m.id) ?? 0) === 0 && (outW.get(m.id) ?? 0) > 0);
  if (roots.length === 0) roots = [...leaves].sort(order).slice(0, 1);
  roots.sort(order);

  // the file graph export keeps the 300 top-ranked files; the roots' own files (+ 1 hop) are added by focus
  const moduleOf = new Map<string, ModuleId>();
  const rank = new Map<string, number>();
  const loc = new Map<string, number>();
  const edgeSeen = new Set<string>();
  const fileOut = new Map<string, { to: string; w: number }[]>();
  const fileOutW = new Map<string, number>();
  for (const fg of [ix.graph("file"), ...roots.map((m) => ix.graph("file", m.id))]) {
    for (const n of fg.nodes) {
      const p = n.path ?? n.id;
      rank.set(p, n.rank);
      loc.set(p, n.loc);
      if (n.module) moduleOf.set(p, n.module);
    }
    for (const e of fg.edges) {
      const key = `${e.from}\u0000${e.to}`;
      if (e.from === e.to || edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      fileOut.set(e.from, [...(fileOut.get(e.from) ?? []), { to: e.to, w: e.weight }]);
      fileOutW.set(e.from, (fileOutW.get(e.from) ?? 0) + e.weight);
    }
  }
  const rankOf = (p: string) => rank.get(p) ?? 0;

  // start files: the most outgoing files of the root modules (the composition point: an app shell, a facade)
  const starts = roots
    .flatMap((m) => m.paths.filter((p) => !TEST_PATH_RE.test(p)))
    .map((p) => ({ p, handler: mainCallable(ix.symbols(p)) }))
    .filter((x): x is { p: RepoPath; handler: SymbolEntry } => x.handler !== undefined && (fileOutW.get(x.p) ?? 0) > 0)
    .sort((a, b) => (fileOutW.get(b.p) ?? 0) - (fileOutW.get(a.p) ?? 0) || rankOf(b.p) - rankOf(a.p) || byStr(a.p, b.p));
  const next = (cur: string, seen: { has(k: string): boolean }) =>
    (fileOut.get(cur) ?? [])
      .filter((x) => !seen.has(x.to) && !TEST_PATH_RE.test(x.to) && moduleOf.has(x.to))
      .sort((a, b) => b.w - a.w || rankOf(b.to) - rankOf(a.to) || byStr(a.to, b.to));

  const seeds: FlowSeed[] = [];
  const taken = new Set<string>();
  const push = (p: RepoPath, handler: SymbolEntry, files: RepoPath[]) => {
    const key = files.join(">");
    if (seeds.length >= limit || taken.has(key)) return;
    const modules: ModuleId[] = [];
    for (const f of files) {
      const m = moduleOf.get(f);
      if (m && modules[modules.length - 1] !== m) modules.push(m);
    }
    if (modules.length < 2) return;
    taken.add(key);
    const to = files[files.length - 1] as string;
    seeds.push({
      k: seeds.length + 1,
      kind: "entry",
      label: `${handler.qualname} → ${to}`,
      path: p,
      line: handler.start,
      handler: handler.key,
      modules,
      files,
    });
  };

  // 1. from the main start, a file path into the core file of each important module (rank desc; core = the largest
  //    member reachable within 5 hops): one flow per module the system is about, not only along the heaviest edge
  //    (real run 2026-10-04: m3e's flows all ended in tokens / i18n and never reached the prompt builder, the point of
  //    the app)
  const main = starts[0];
  if (main) {
    const startModule = moduleOf.get(main.p);
    const parent = reach(main.p, next);
    const targets = [...leaves].filter((m) => m.id !== startModule).sort((a, b) => b.rank - a.rank || byStr(a.id, b.id));
    for (const m of targets) {
      if (seeds.length >= limit) break;
      const core = m.paths.filter((f) => parent.has(f) && !TEST_PATH_RE.test(f)).sort((a, b) => (loc.get(b) ?? 0) - (loc.get(a) ?? 0) || byStr(a, b))[0];
      if (!core) continue;
      const path: RepoPath[] = [];
      for (let v: string | null | undefined = core; v; v = parent.get(v)) path.unshift(v as RepoPath);
      push(main.p, main.handler, path);
    }
  }
  // 2. then the strongest-edge walk of every start file
  for (const { p, handler } of starts) {
    if (seeds.length >= limit) break;
    const files: RepoPath[] = [p];
    const seen = new Set<string>([p]);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const step = next(files[files.length - 1] as string, seen)[0];
      if (!step) break;
      files.push(step.to as RepoPath);
      seen.add(step.to);
    }
    push(p, handler, files);
  }
  return seeds;
}

/**
 * BFS over the file edges from `from` (≤ MAX_HOPS; strongest edge first ⇒ deterministic): the parent of every reached
 * file, so the shortest path to any of them can be read back.
 */
function reach(from: string, next: (cur: string, seen: { has(k: string): boolean }) => { to: string }[]): Map<string, string | null> {
  const parent = new Map<string, string | null>([[from, null]]);
  let frontier = [from];
  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const level: string[] = [];
    for (const cur of frontier)
      for (const { to } of next(cur, parent)) {
        if (parent.has(to)) continue;
        parent.set(to, cur);
        level.push(to);
      }
    frontier = level;
  }
  return parent;
}

/** The file's main exported callable: the longest top-level exported function, method or class. */
function mainCallable(symbols: readonly SymbolEntry[]): SymbolEntry | undefined {
  return symbols.filter((s) => s.exported && CALLABLE.has(s.kind) && !s.parent).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0];
}
