/**
 * gen requests I3 / I4 (spec §7.8): cheap per-module statistics and flow seeds — entry points (main-scope routes, then
 * CLI commands, then entries; handler file rank desc) with the BFS path over the effective module graph (hop ≤ 6,
 * neighbours by edge weight desc then slug) down to the deepest reachable bottom module.
 */
import type { FactKind, ModuleId, RepoPath, RouteFact, SymbolKey } from "@mitori/core";
import type { FlowSeed, ModuleStats } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import type { StageFile } from "../resolve/files.ts";
import type { StructureResult } from "../structure/stage.ts";

const MAX_HOPS = 6;
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function moduleStats(id: ModuleId, st: StructureResult, facts: FactsResult, files: ReadonlyMap<RepoPath, StageFile>): ModuleStats | null {
  const m = st.modules.find((x) => x.id === id);
  if (!m) return null;
  const leaves = m.paths.length > 0 ? [m] : st.modules.filter((x) => x.paths.length > 0 && isUnder(x.id, id, st));
  const paths = leaves.flatMap((x) => x.paths);
  const member = new Set(paths);
  const tests = new Set(leaves.flatMap((x) => x.tests));
  let symbols = 0;
  let exported = 0;
  for (const p of paths)
    for (const s of files.get(p)?.symbols ?? []) {
      symbols++;
      if (s.exported) exported++;
    }
  const perKind: Partial<Record<FactKind, number>> = {};
  let cases = 0;
  facts.facts.forEach((f, i) => {
    if (f.kind === "test" && tests.has(f.path)) cases++;
    if (!member.has(f.path) || f.scope === "example" || facts.scopes[i] === "test") return;
    perKind[f.kind] = (perKind[f.kind] ?? 0) + 1;
  });
  const leafIds = new Set(leaves.map((x) => x.id));
  const sum = (pick: (e: StructureResult["leafEdges"][number]) => ModuleId | null) => {
    const acc = new Map<ModuleId, number>();
    for (const e of st.leafEdges) {
      const other = pick(e);
      if (other !== null && !leafIds.has(other)) acc.set(other, (acc.get(other) ?? 0) + e.weight);
    }
    return [...acc].map(([module, w]) => ({ module, weight: Math.round(w * 100) / 100 })).sort((a, b) => b.weight - a.weight || byStr(a.module, b.module));
  };
  return {
    module: id,
    files: paths.length,
    loc: m.loc,
    symbols,
    exportedSymbols: exported,
    tests: cases,
    testFiles: tests.size,
    facts: perKind,
    depsOut: sum((e) => (leafIds.has(e.from) ? e.to : null)),
    depsIn: sum((e) => (leafIds.has(e.to) ? e.from : null)),
  };
}

function isUnder(leaf: ModuleId, ancestor: ModuleId, st: StructureResult): boolean {
  const byId = new Map(st.modules.map((m) => [m.id, m]));
  for (let m = byId.get(leaf), hops = 0; m && hops < 8; m = m.parent ? byId.get(m.parent) : undefined, hops++) if (m.parent === ancestor) return true;
  return false;
}

/** BFS path from `start` to the deepest reachable module without outgoing edges (else the farthest reached). */
function flowPath(start: ModuleId, st: StructureResult): ModuleId[] {
  const slug = new Map(st.modules.map((m) => [m.id, m.slug]));
  const out = new Map<ModuleId, { to: ModuleId; w: number }[]>();
  for (const e of st.leafEdges) out.set(e.from, [...(out.get(e.from) ?? []), { to: e.to, w: e.weight }]);
  for (const list of out.values()) list.sort((a, b) => b.w - a.w || byStr(slug.get(a.to) ?? "", slug.get(b.to) ?? ""));
  const parent = new Map<ModuleId, ModuleId | null>([[start, null]]);
  const dist = new Map<ModuleId, number>([[start, 0]]);
  const queue = [start];
  let best = start;
  let bestScore = -1;
  while (queue.length > 0) {
    const v = queue.shift() as ModuleId;
    const d = dist.get(v) as number;
    const next = out.get(v) ?? [];
    const score = d * 2 + (next.length === 0 ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
    if (d >= MAX_HOPS) continue;
    for (const { to } of next) {
      if (parent.has(to)) continue;
      parent.set(to, v);
      dist.set(to, d + 1);
      queue.push(to);
    }
  }
  const path: ModuleId[] = [];
  for (let v: ModuleId | null | undefined = best; v; v = parent.get(v)) path.unshift(v);
  return path;
}

/** One file per module along the path: an import / call target of the previous file when possible, else the rank-max member. */
function flowFiles(first: RepoPath, path: readonly ModuleId[], st: StructureResult): RepoPath[] {
  const g = st.graph;
  const files: RepoPath[] = [first];
  for (const id of path.slice(1)) {
    const m = st.modules.find((x) => x.id === id);
    if (!m) break;
    const prev = g.index.get(files[files.length - 1] as RepoPath);
    const targets = prev === undefined ? [] : [...(g.out[prev] ?? new Map()).keys()].map((j) => g.paths[j] as RepoPath).filter((p) => m.paths.includes(p));
    const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
    const callsFirst = (p: RepoPath) => (prev !== undefined && g.calls.has(prev * g.paths.length + (g.index.get(p) as number)) ? 1 : 0);
    const pick =
      [...targets].sort((a, b) => callsFirst(b) - callsFirst(a) || rank(b) - rank(a) || byStr(a, b))[0] ??
      [...m.paths].sort((a, b) => rank(b) - rank(a) || byStr(a, b))[0];
    if (!pick) break;
    files.push(pick);
  }
  return files;
}

/** Entry points (main scope) with their module flow, ranked (spec §7.8 I4). */
export function flowSeeds(st: StructureResult, facts: FactsResult, limit = 8): FlowSeed[] {
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  type Cand = { kind: FlowSeed["kind"]; label: string; path: RepoPath; line: number; file: RepoPath; handler?: SymbolKey; order: number };
  const cands: Cand[] = [];
  facts.facts.forEach((f, i) => {
    if (f.scope === "example" || facts.scopes[i] !== "main") return;
    if (f.kind === "route") {
      const r = f as RouteFact;
      const file = r.handler ? r.handler.slice(0, r.handler.indexOf("#")) : r.path;
      cands.push({
        kind: "route",
        label: `${r.method} ${r.pattern}`,
        path: r.path,
        line: r.line,
        file,
        ...(r.handler ? { handler: r.handler } : {}),
        order: 0,
      });
    } else if (f.kind === "cli") cands.push({ kind: "cli", label: f.command, path: f.path, line: f.line, file: f.path, order: 1 });
    else if (f.kind === "entry")
      cands.push({
        kind: "entry",
        label: f.label,
        path: f.path,
        line: f.line,
        file: f.entry === "main" && st.moduleOf.has(f.label) ? f.label : f.path,
        order: 2,
      });
  });
  cands.sort((a, b) => a.order - b.order || rank(b.file) - rank(a.file) || byStr(a.path, b.path) || a.line - b.line || byStr(a.label, b.label));
  const out: FlowSeed[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    if (out.length >= limit) break;
    const start = st.moduleOf.get(c.file) ?? st.moduleOf.get(c.path);
    if (start === undefined) continue;
    const modules = flowPath(start, st);
    const key = `${c.kind}\u0000${modules.join(",")}`;
    if (seen.has(key)) continue; // one seed per distinct flow keeps the list informative
    seen.add(key);
    const first = st.graph.index.has(c.file) ? c.file : (st.modules.find((m) => m.id === start)?.paths[0] ?? c.file);
    out.push({
      k: out.length + 1,
      kind: c.kind,
      label: c.label,
      path: c.path,
      line: c.line,
      ...(c.handler ? { handler: c.handler } : {}),
      modules,
      files: flowFiles(first, modules, st),
    });
  }
  return out;
}
