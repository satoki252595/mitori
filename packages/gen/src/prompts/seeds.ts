/**
 * Flow seeds of a run (gen.flows SEEDS, its planning and its skip rule). The index's own seeds come from entry facts
 * (routes, CLI commands, `main`); a frontend app or a library often has none (m3e-canvas: a Next.js app whose only entry
 * fact is `package.json` `start`, so §3 stayed "not generated" for a newcomer [real run 2026-10-04]). Then seeds are
 * derived from the file graph: start files are the non-test files of the root leaf modules (no incoming edge from
 * another leaf; else the most "outgoing" one) that nothing imports, most outgoing first, each seeded at its main
 * exported callable; the walk follows the strongest import / call edge to a file not visited yet (≤ 5 hops), like the
 * index's own walk, so `flowBodies` finds the called symbols hop by hop. `modules` lists the modules of the walked files
 * in order. Deterministic: a function of the index only, so plans and cache keys stay stable.
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
  const edgeSeen = new Set<string>();
  const fileOut = new Map<string, { to: string; w: number }[]>();
  const fileIn = new Map<string, number>();
  const fileOutW = new Map<string, number>();
  for (const fg of [ix.graph("file"), ...roots.map((m) => ix.graph("file", m.id))]) {
    for (const n of fg.nodes) {
      const p = n.path ?? n.id;
      rank.set(p, n.rank);
      if (n.module) moduleOf.set(p, n.module);
    }
    for (const e of fg.edges) {
      const key = `${e.from}\u0000${e.to}`;
      if (e.from === e.to || edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      fileOut.set(e.from, [...(fileOut.get(e.from) ?? []), { to: e.to, w: e.weight }]);
      fileIn.set(e.to, (fileIn.get(e.to) ?? 0) + 1);
      fileOutW.set(e.from, (fileOutW.get(e.from) ?? 0) + e.weight);
    }
  }
  const rankOf = (p: string) => rank.get(p) ?? 0;

  // start files: never imported first, then the most outgoing; one seed per start file
  const starts = roots
    .flatMap((m) => m.paths.filter((p) => !TEST_PATH_RE.test(p)))
    .map((p) => ({ p, handler: mainCallable(ix.symbols(p)) }))
    .filter((x): x is { p: RepoPath; handler: SymbolEntry } => x.handler !== undefined && (fileOutW.get(x.p) ?? 0) > 0)
    .sort(
      (a, b) =>
        Number((fileIn.get(a.p) ?? 0) > 0) - Number((fileIn.get(b.p) ?? 0) > 0) ||
        (fileOutW.get(b.p) ?? 0) - (fileOutW.get(a.p) ?? 0) ||
        rankOf(b.p) - rankOf(a.p) ||
        byStr(a.p, b.p),
    );

  const seeds: FlowSeed[] = [];
  for (const { p, handler } of starts) {
    if (seeds.length >= limit) break;
    const files: RepoPath[] = [p];
    const seen = new Set<string>([p]);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const cur = files[files.length - 1] as RepoPath;
      const next = (fileOut.get(cur) ?? [])
        .filter((x) => !seen.has(x.to) && !TEST_PATH_RE.test(x.to) && moduleOf.has(x.to))
        .sort((a, b) => b.w - a.w || rankOf(b.to) - rankOf(a.to) || byStr(a.to, b.to))[0];
      if (!next) break;
      files.push(next.to as RepoPath);
      seen.add(next.to);
    }
    const modules: ModuleId[] = [];
    for (const f of files) {
      const m = moduleOf.get(f);
      if (m && modules[modules.length - 1] !== m) modules.push(m);
    }
    if (modules.length === 0) continue;
    seeds.push({ k: seeds.length + 1, kind: "entry", label: `${handler.qualname} (${p})`, path: p, line: handler.start, handler: handler.key, modules, files });
  }
  return seeds;
}

/** The file's main exported callable: the longest top-level exported function, method or class. */
function mainCallable(symbols: readonly SymbolEntry[]): SymbolEntry | undefined {
  return symbols.filter((s) => s.exported && CALLABLE.has(s.kind) && !s.parent).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0];
}
