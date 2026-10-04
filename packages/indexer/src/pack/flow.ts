/**
 * gen requests I3 / I4 (spec §7.8): cheap per-module statistics and flow seeds — entry points (main-scope routes, then
 * CLI commands, then entries; handler file rank desc) with the path they take over the effective module graph: from
 * the handler's file, each hop follows that file's strongest dependency (calls first) into a module the current one
 * has an effective edge to (hop ≤ 6); where no file edge continues, the BFS over the module graph (neighbours by edge
 * weight desc then slug) runs down to the deepest reachable bottom module. Two handlers of one module therefore get
 * different seeds when their code goes different ways.
 */
import type { CodeSlice, FactKind, ModuleId, RepoPath, RouteFact, SecretScanner, SymbolKey } from "@mitori/core";
import type { FlowSeed, ModuleStats, ResolvedImport } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import { GENERIC_NAMES } from "../resolve/builtins.ts";
import type { StageFile } from "../resolve/files.ts";
import type { StructureResult } from "../structure/stage.ts";
import { packSlices } from "./module-context.ts";

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
function flowPath(start: ModuleId, st: StructureResult, avoid: ReadonlySet<ModuleId>, hops: number, ok: (m: ModuleId) => boolean = () => true): ModuleId[] {
  const slug = new Map(st.modules.map((m) => [m.id, m.slug]));
  const out = new Map<ModuleId, { to: ModuleId; w: number }[]>();
  for (const e of st.leafEdges) if (ok(e.to)) out.set(e.from, [...(out.get(e.from) ?? []), { to: e.to, w: e.weight }]);
  for (const list of out.values()) list.sort((a, b) => b.w - a.w || byStr(slug.get(a.to) ?? "", slug.get(b.to) ?? ""));
  const parent = new Map<ModuleId, ModuleId | null>([[start, null]]);
  const dist = new Map<ModuleId, number>([[start, 0]]);
  const queue = [start];
  let best = start;
  let bestScore = -1;
  while (queue.length > 0) {
    const v = queue.shift() as ModuleId;
    const d = dist.get(v) as number;
    const next = (out.get(v) ?? []).filter((x) => !avoid.has(x.to));
    const score = d * 2 + (next.length === 0 ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
    if (d >= hops) continue;
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

/**
 * One file per module along the path: an import / call target of the previous file when possible, else the
 * rank-max member — walkable files only; the path ends at a module without one.
 */
function flowFiles(first: RepoPath, path: readonly ModuleId[], st: StructureResult, stage?: ReadonlyMap<RepoPath, StageFile>, family?: string): RepoPath[] {
  const g = st.graph;
  const files: RepoPath[] = [first];
  for (const id of path.slice(1)) {
    const m = st.modules.find((x) => x.id === id);
    if (!m) break;
    const prev = g.index.get(files[files.length - 1] as RepoPath);
    const members = m.paths.filter((p) => walkable(p, stage, family));
    const targets = prev === undefined ? [] : [...(g.out[prev] ?? new Map()).keys()].map((j) => g.paths[j] as RepoPath).filter((p) => members.includes(p));
    const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
    const callsFirst = (p: RepoPath) => (prev !== undefined && g.calls.has(prev * g.paths.length + (g.index.get(p) as number)) ? 1 : 0);
    const pick =
      [...targets].sort((a, b) => callsFirst(b) - callsFirst(a) || rank(b) - rank(a) || byStr(a, b))[0] ??
      [...members].sort((a, b) => rank(b) - rank(a) || byStr(a, b))[0];
    if (!pick) break;
    files.push(pick);
  }
  return files;
}

/**
 * Files a flow may step into (gen #4b): a file the walk can call — main scope (never a tooling script, an example
 * or a test reached by a name edge: crit's `web/embed.go > scripts/bench-compare.py`) with at least one callable (an
 * embed / asset / constants file has none; it is data, not a step of the flow).
 */
export function walkable(path: RepoPath, files: ReadonlyMap<RepoPath, StageFile> | undefined, family?: string): boolean {
  if (files === undefined) return true;
  const f = files.get(path);
  return f !== undefined && f.scope === "main" && (family === undefined || langFamily(f.lang) === family) && f.symbols.some((s) => CALLABLE.has(s.kind));
}

/** Languages that call each other directly (a Go server serves its JS; it does not call it). */
export function langFamily(lang: string): string {
  return lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx" ? "js" : lang;
}

/**
 * The path a handler takes: from its file, each hop follows the current file's strongest dependency (calls first,
 * then weight, file rank, path) into a not yet visited module the current module has an effective edge to; where no
 * file edge continues, the module-graph BFS finishes the path. `firstHop` (the file the handler's own calls go to)
 * replaces the file-level choice of the first hop, so two handlers of one router file walk where their code goes.
 */
function flowWalk(
  first: RepoPath,
  start: ModuleId,
  st: StructureResult,
  files?: ReadonlyMap<RepoPath, StageFile>,
  firstHop?: RepoPath,
): { modules: ModuleId[]; files: RepoPath[] } {
  const g = st.graph;
  const effective = new Set(st.leafEdges.map((e) => `${e.from}>${e.to}`));
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  const modules: ModuleId[] = [start];
  const path: RepoPath[] = [first];
  const startLang = files?.get(first)?.lang;
  const family = startLang === undefined ? undefined : langFamily(startLang);
  const visited = new Set<ModuleId>(modules);
  const hopModule = firstHop === undefined ? undefined : st.moduleOf.get(firstHop);
  if (firstHop !== undefined && hopModule !== undefined && !visited.has(hopModule) && effective.has(`${start}>${hopModule}`)) {
    modules.push(hopModule);
    path.push(firstHop);
    visited.add(hopModule);
  }
  for (let hop = modules.length - 1; hop < MAX_HOPS; hop++) {
    const cur = g.index.get(path[path.length - 1] as RepoPath);
    const at = modules[modules.length - 1] as ModuleId;
    if (cur === undefined) break;
    let pick: { file: RepoPath; module: ModuleId; call: number; w: number } | null = null;
    for (const [j, e] of g.out[cur] ?? new Map()) {
      const file = g.paths[j] as RepoPath;
      const module = st.moduleOf.get(file);
      if (module === undefined || visited.has(module) || !effective.has(`${at}>${module}`) || !walkable(file, files, family)) continue;
      const cand = { file, module, call: g.calls.has(cur * g.paths.length + j) ? 1 : 0, w: e.import + e.ref };
      if (
        pick === null ||
        cand.call > pick.call ||
        (cand.call === pick.call &&
          (cand.w > pick.w + 1e-12 ||
            (Math.abs(cand.w - pick.w) <= 1e-12 && (rank(file) > rank(pick.file) || (rank(file) === rank(pick.file) && file < pick.file)))))
      )
        pick = cand;
    }
    if (pick === null) {
      // no file edge goes on: the module graph does (the deepest reachable bottom module, files by the same rule)
      const ok = (m: ModuleId) => files === undefined || (st.modules.find((x) => x.id === m)?.paths.some((p) => walkable(p, files, family)) ?? false);
      const rest = flowPath(at, st, visited, MAX_HOPS - hop, ok).slice(1);
      const more = flowFiles(path[path.length - 1] as RepoPath, [at, ...rest], st, files, family).slice(1);
      modules.push(...rest.slice(0, more.length));
      path.push(...more);
      break;
    }
    modules.push(pick.module);
    path.push(pick.file);
    visited.add(pick.module);
  }
  return { modules, files: path };
}

const CALLABLE = new Set(["function", "method", "constructor"]);
/** Words followed by `(` that are no call of a repo symbol. */
const NOT_CALLS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "func",
  "function",
  "def",
  "fn",
  "await",
  "typeof",
  "new",
  "make",
  "len",
  "append",
  "cap",
  "panic",
  "print",
  "println",
  "super",
  "elif",
  "with",
  "match",
  "select",
  "go",
  "defer",
]);

/**
 * Method names too common to say where a call goes (`x.Lock()`, `w.Error()`): matched only through an import
 * alias (`session.Load(`), never by name alone.
 */
const COMMON_METHODS = new Set([
  ...GENERIC_NAMES,
  "Lock",
  "Unlock",
  "RLock",
  "RUnlock",
  "Load",
  "Store",
  "Notify",
  "Wait",
  "Done",
  "Add",
  "Kind",
  "Name",
  "Value",
  "Get",
  "Set",
]);

/** A handler's calls: every called name, and the names called through a qualifier (`session.New(` → session: New). */
export interface HandlerCalls {
  names: Set<string>;
  qualified: Map<string, Set<string>>;
}

/** Calls in a range of source lines (string contents and line comments blanked first). */
function collectCalls(lines: readonly string[], from: number, to: number, into: HandlerCalls): void {
  for (let i = Math.max(1, from); i <= Math.min(lines.length, to); i++) {
    const l = (lines[i - 1] as string).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`/g, '""').replace(/\/\/.*$|#.*$/, "");
    for (const m of l.matchAll(/(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2] as string;
      if (NOT_CALLS.has(name)) continue;
      into.names.add(name);
      const q = m[1];
      if (q !== undefined) {
        const set = into.qualified.get(q);
        if (set) set.add(name);
        else into.qualified.set(q, new Set([name]));
      }
    }
  }
}

/**
 * What a handler calls (gen #4c): the calls in its body and in the bodies of the same-file helpers it calls (one
 * level, ≤ 6 helpers, ≤ 400 lines each) — `handleX` → `s.addComment` (same file) → `session.AddComment`. Null
 * without the handler's text (the file-level walk then decides alone).
 */
export function handlerCalls(
  handler: SymbolKey,
  files: ReadonlyMap<RepoPath, StageFile>,
  text: (p: RepoPath) => string | null,
  linesOf: (p: RepoPath) => readonly string[] | null = (p) => text(p)?.split("\n") ?? null,
): HandlerCalls | null {
  const path = handler.slice(0, handler.indexOf("#"));
  const f = files.get(path);
  const sym = f?.symbols.find((s) => s.key === handler);
  const lines = f && sym ? linesOf(path) : null;
  if (!f || !sym || lines === null) return null;
  const calls: HandlerCalls = { names: new Set(), qualified: new Map() };
  collectCalls(lines, sym.bodyStart ?? sym.start, sym.end, calls);
  const helpers = f.symbols.filter((s) => s.key !== handler && CALLABLE.has(s.kind) && calls.names.has(s.name)).slice(0, 6);
  for (const h of helpers) collectCalls(lines, h.bodyStart ?? h.start, Math.min(h.end, (h.bodyStart ?? h.start) + 400), calls);
  calls.names.delete(sym.name);
  return calls;
}

/** The import binding a qualifier names (Go: package name; JS / Python: the imported name), with its repo files. */
function importAliases(imps: readonly ResolvedImport[]): Map<string, { to: readonly RepoPath[] }> {
  const out = new Map<string, { to: readonly RepoPath[] }>();
  for (const imp of imps) {
    const segs = imp.spec.split("/");
    let last = segs[segs.length - 1] ?? imp.spec;
    if (/^v\d+$/.test(last) && segs.length > 1) last = segs[segs.length - 2] as string;
    const aliases =
      imp.names.length > 0
        ? imp.names
        : [
            last
              .replace(/^go-/, "")
              .replace(/[.-]go$/, "")
              .split(".")
              .pop() ?? last,
          ];
    for (const a of aliases) if (!out.has(a)) out.set(a, { to: imp.to });
  }
  return out;
}

/** Where a handler's calls land: per file of another module, the callables it calls there. */
export interface HandlerReach {
  /** The file of another module its calls reach most (null: none, or no text). */
  file: RepoPath | null;
  /** Distinct callables reached per file. */
  targets: Map<RepoPath, number>;
}

/**
 * Where a handler's own calls go (gen #4c). A call through an import alias lands only in that import's files (one
 * through a stdlib / external alias — `http.Error(` — lands nowhere); a method or bare call lands in the imported
 * files and the file's graph neighbours that define it (common method names excepted). Only files of other modules
 * the walk may step into count. `file` = the most-reached one (calls edge, rank, path break ties).
 */
export function handlerReach(
  handler: SymbolKey,
  start: ModuleId,
  st: StructureResult,
  src: FlowSources,
  linesOf?: (p: RepoPath) => readonly string[] | null,
): HandlerReach {
  const none: HandlerReach = { file: null, targets: new Map() };
  const path = handler.slice(0, handler.indexOf("#"));
  const calls = handlerCalls(handler, src.files, src.text, linesOf);
  if (calls === null) return none;
  const g = st.graph;
  const from = g.index.get(path);
  const aliases = importAliases(src.imports?.(path) ?? []);
  const ok = (p: RepoPath) => {
    const m = st.moduleOf.get(p);
    return m !== undefined && m !== start && walkable(p, src.files);
  };
  const defines = (p: RepoPath, names: ReadonlySet<string>) =>
    new Set((src.files.get(p)?.symbols ?? []).filter((s) => CALLABLE.has(s.kind) && names.has(s.name)).map((s) => s.name));
  const hits = new Map<RepoPath, Set<string>>();
  const add = (p: RepoPath, ns: Iterable<string>) => {
    const set = hits.get(p) ?? new Set<string>();
    for (const n of ns) set.add(n);
    if (set.size > 0) hits.set(p, set);
  };
  const viaAlias = new Set<string>();
  for (const [q, ns] of calls.qualified) {
    const imp = aliases.get(q);
    if (!imp) continue;
    for (const n of ns) viaAlias.add(n);
    for (const p of imp.to) if (ok(p)) add(p, defines(p, ns));
  }
  // method / bare calls: by name, in the imported files and the graph neighbours
  const loose = new Set([...calls.names].filter((n) => !COMMON_METHODS.has(n) && !viaAlias.has(n)));
  const pool = new Set<RepoPath>();
  for (const { to } of aliases.values()) for (const p of to) pool.add(p);
  if (from !== undefined) for (const j of (g.out[from] ?? new Map()).keys()) pool.add(g.paths[j] as RepoPath);
  for (const p of pool) if (ok(p)) add(p, defines(p, loose));
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  const call = (p: RepoPath) => (from !== undefined && g.calls.has(from * g.paths.length + (g.index.get(p) ?? -1)) ? 1 : 0);
  let best: RepoPath | null = null;
  for (const [p, set] of hits) {
    const b = best === null ? null : (hits.get(best) as Set<string>);
    if (
      best === null ||
      set.size > (b as Set<string>).size ||
      (set.size === (b as Set<string>).size &&
        (call(p) > call(best) || (call(p) === call(best) && (rank(p) > rank(best) || (rank(p) === rank(best) && p < best)))))
    )
      best = p;
  }
  return { file: best, targets: new Map([...hits].map(([p, s]) => [p, s.size])) };
}

/**
 * Routes a newcomer does not need as a flow (gen #4c: "rank health / version / static routes last"): health and
 * version probes, metrics / debug endpoints, static assets and pages served by an asset factory.
 */
export function infraRoute(r: Pick<RouteFact, "pattern" | "handler">): boolean {
  const p = r.pattern.toLowerCase();
  if (/(^|\/)(health|healthz|livez|readyz|ready|ping|version|metrics|status|favicon\.ico|robots\.txt|debug|pprof)(\/|$)/.test(p)) return true;
  if (/(^|\/)(static|assets|public|dist)(\/|$)|\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|html?|txt|json)$/.test(p)) return true;
  if (r.handler === undefined) return true;
  const name =
    r.handler
      .slice(r.handler.lastIndexOf("#") + 1)
      .split(".")
      .pop() ?? "";
  return /^(serve|handle)?(Static|Assets?|Embedded|Health|Version|Ping|Metrics|Favicon|Robots)/.test(name) || /^serve[A-Z]/.test(name);
}

/** Text access for `flowBodies` (the facade's current texts; secret scan when `security.secretScan`). */
export interface SliceIo {
  text(path: RepoPath): string | null;
  /** `estimateTokens(text, "code", tokenizer)`. */
  estimate(text: string): number;
  secrets?: SecretScanner;
}

type Sym = StageFile["symbols"][number];

/**
 * Bodies along a flow: the handler, then per hop the symbols of the next file called from the previous one — on
 * the first hop, the ones the handler itself calls when its text is at hand (not everything its router file calls).
 */
function flowTargets(seed: FlowSeed, files: ReadonlyMap<RepoPath, StageFile>, text?: (p: RepoPath) => string | null): Sym[] {
  const out: Sym[] = [];
  const seen = new Set<string>();
  const push = (s: Sym | undefined) => {
    if (s && !seen.has(s.key)) {
      seen.add(s.key);
      out.push(s);
    }
  };
  const first = files.get(seed.files[0] ?? seed.path);
  if (seed.handler) push(files.get(seed.handler.slice(0, seed.handler.indexOf("#")))?.symbols.find((s) => s.key === seed.handler));
  else if (seed.path === first?.path)
    // no handler: the callable around the defining line (`main`, the command table's function)
    push(
      first.symbols.filter((s) => CALLABLE.has(s.kind) && s.start <= seed.line && seed.line <= s.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0],
    );
  const own = seed.handler && text ? (handlerCalls(seed.handler, files, text)?.names ?? null) : null;
  for (let j = 1; j < seed.files.length; j++) {
    const from = files.get(seed.files[j - 1] as RepoPath);
    const to = files.get(seed.files[j] as RepoPath);
    if (!from || !to) continue;
    const fileCalls = () => new Set(from.refs.filter((r) => r.kind === "call" || r.kind === "new" || r.kind === "jsx" || r.kind === "qual").map((r) => r.name));
    const byHandler = j === 1 && own !== null && to.symbols.some((s) => CALLABLE.has(s.kind) && own.has(s.name));
    const called = byHandler ? (own as Set<string>) : fileCalls();
    for (const s of [...to.symbols].sort((a, b) => a.start - b.start)) if (CALLABLE.has(s.kind) && called.has(s.name)) push(s);
  }
  return out;
}

/**
 * `flowBodies(seed, budget)` (gen I4, spec §7.8): the flow's bodies packed in order with the hot-body slice rules
 * (§7.3): numbered `start..end`, bodies over 200 lines keep their first 80 lines + `⋮`, a slice that does not fit is
 * skipped and 3 skips in a row stop, adjacent / overlapping slices of a file are merged.
 */
export function flowBodies(seed: FlowSeed, files: ReadonlyMap<RepoPath, StageFile>, budgetTokens: number, io: SliceIo): CodeSlice[] {
  return packSlices(
    flowTargets(seed, files, io.text).map((x) => ({ path: x.path, blob: x.blob, start: x.start, end: x.end })),
    budgetTokens,
    io,
  );
}

/** What `flowSeeds` may read beyond the structure: the S1 files (symbols, scopes), current texts, resolved imports. */
export interface FlowSources {
  files: ReadonlyMap<RepoPath, StageFile>;
  /** Current text of a file (null when not at hand: the handler then ranks by its file and walks by file edges). */
  text(path: RepoPath): string | null;
  /** Resolved imports of a file (an alias-qualified call lands in its import's files only). */
  imports?(path: RepoPath): readonly ResolvedImport[];
}

/** Share of the seeds routes may take while CLI commands / entries exist (a server's CLI is a flow of its own). */
const ROUTE_SHARE = 0.75;

/**
 * Entry points (main scope) with their module flow, ranked (spec §7.8 I4). Routes come first — central ones first
 * (gen #4c): a handler scores the mean popularity of the callables of other modules it reaches (popularity of a file =
 * how many route handlers call into it: the code the app's endpoints share is its core — crit's session, not its QR
 * code), then their total, then its size; health, version, static and asset routes come last. Then CLI commands, then entries (a build-ignored generator
 * main last). With `src`, a handler's walk starts where its own calls go; routes are taken one per first-hop module
 * first (the top seeds cover different parts of the app), then by score; a route is dropped only when its handler
 * is already a seed (`/x` and `/x/` on one handler) — never for sharing the module walk. Without a handler, a seed
 * whose file walk repeats an earlier one's is dropped. Routes take at most ¾ of the seeds while CLI commands or
 * entries exist.
 */
export function flowSeeds(st: StructureResult, facts: FactsResult, limit = 8, src?: FlowSources): FlowSeed[] {
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  type Cand = {
    kind: FlowSeed["kind"];
    label: string;
    path: RepoPath;
    line: number;
    file: RepoPath;
    handler?: SymbolKey;
    order: number;
    tier: number;
    score: number;
    weight: number;
    size: number;
    reach: HandlerReach | null;
  };
  const cands: Cand[] = [];
  // a router file holds dozens of handlers (crit's server.go: 61): its lines are split once per call, not per route
  const lineCache = new Map<RepoPath, readonly string[] | null>();
  const linesOf = (p: RepoPath): readonly string[] | null => {
    let l = lineCache.get(p);
    if (l === undefined) {
      l = src?.text(p)?.split("\n") ?? null;
      lineCache.set(p, l);
    }
    return l;
  };
  const bodyOf = (key: SymbolKey) => {
    const s = src?.files.get(key.slice(0, key.indexOf("#")))?.symbols.find((x) => x.key === key);
    return s ? s.end - s.start + 1 : 0;
  };
  facts.facts.forEach((f, i) => {
    if (f.scope === "example" || facts.scopes[i] !== "main") return;
    if (f.kind === "route") {
      const r = f as RouteFact;
      const file = r.handler ? r.handler.slice(0, r.handler.indexOf("#")) : r.path;
      const start = st.moduleOf.get(file) ?? st.moduleOf.get(r.path);
      cands.push({
        kind: "route",
        label: `${r.method} ${r.pattern}`,
        path: r.path,
        line: r.line,
        file,
        ...(r.handler ? { handler: r.handler } : {}),
        order: 0,
        tier: infraRoute(r) ? 1 : 0,
        score: 0,
        weight: 0,
        size: r.handler ? bodyOf(r.handler) : 0,
        reach: src && r.handler && start !== undefined ? handlerReach(r.handler, start, st, src, linesOf) : null,
      });
    } else if (f.kind === "cli")
      cands.push({ kind: "cli", label: f.command, path: f.path, line: f.line, file: f.path, order: 1, tier: 0, score: 0, weight: 0, size: 0, reach: null });
    else if (f.kind === "entry")
      cands.push({
        kind: "entry",
        label: f.label,
        path: f.path,
        line: f.line,
        file: f.entry === "main" && st.moduleOf.has(f.label) ? f.label : f.path,
        order: 2,
        // `go run gen.go` style generators are labelled by their file: after the program's own mains
        tier: f.entry === "main" && /\.[A-Za-z0-9]+$/.test(f.label) ? 1 : 0,
        score: 0,
        weight: 0,
        size: 0,
        reach: null,
      });
  });
  // a file many endpoints call into is the app's core; a handler scores what of it it uses
  const pop = new Map<RepoPath, number>();
  const handlers = new Set<string>();
  for (const c of cands)
    if (c.reach && c.handler && !handlers.has(c.handler)) {
      handlers.add(c.handler);
      for (const p of c.reach.targets.keys()) pop.set(p, (pop.get(p) ?? 0) + 1);
    }
  // mean popularity of what it calls (a pure core handler outranks one that also calls much else), then the total
  for (const c of cands) {
    let n = 0;
    for (const [p, k] of c.reach?.targets ?? []) {
      c.weight += k * (pop.get(p) ?? 0);
      n += k;
    }
    c.score = n > 0 ? c.weight / n : 0;
  }
  cands.sort(
    (a, b) =>
      a.order - b.order ||
      a.tier - b.tier ||
      b.score - a.score ||
      b.weight - a.weight ||
      b.size - a.size ||
      rank(b.file) - rank(a.file) ||
      byStr(a.path, b.path) ||
      a.line - b.line ||
      byStr(a.label, b.label),
  );
  const walked: { c: Cand; modules: ModuleId[]; files: RepoPath[] }[] = [];
  const seen = new Set<string>();
  const others = cands.filter((c) => c.kind !== "route").length;
  const routeCap = others > 0 ? Math.max(1, Math.ceil(limit * ROUTE_SHARE)) : limit;
  // first-hop modules already covered (the first pass takes one route per part of the app)
  const hops = new Set<ModuleId>();
  const hopModule = (c: Cand) => (c.reach?.file ? st.moduleOf.get(c.reach.file) : undefined);
  const take = (pool: Cand[], cap: number, newHopOnly = false) => {
    let n = 0;
    for (const c of pool) {
      if (n >= cap || walked.length >= limit) break;
      const hm = hopModule(c);
      if (newHopOnly && (hm === undefined || hops.has(hm))) continue;
      const start = st.moduleOf.get(c.file) ?? st.moduleOf.get(c.path);
      if (start === undefined) continue;
      const first = st.graph.index.has(c.file) ? c.file : (st.modules.find((m) => m.id === start)?.paths[0] ?? c.file);
      const { modules, files } = flowWalk(first, start, st, src?.files, c.reach?.file ?? undefined);
      // never the module walk: a handler is a flow of its own (its body and callees differ); without a handler the
      // file walk decides (with text the handlers of one router file walk where their own calls go)
      const key = c.handler && src ? `${c.kind}\u0000${c.handler}` : `${c.kind}\u0000${src ? files.join(",") : modules.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hm !== undefined) hops.add(hm);
      walked.push({ c, modules, files });
      n++;
    }
  };
  const routes = cands.filter((c) => c.kind === "route");
  if (src) take(routes, routeCap, true);
  take(routes, routeCap - walked.length);
  take(
    cands.filter((c) => c.kind !== "route"),
    limit,
  );
  if (walked.length < limit) take(routes, limit); // CLI / entries left room: more routes
  walked.sort((a, b) => cands.indexOf(a.c) - cands.indexOf(b.c));
  return walked.map(({ c, modules, files }, i) => ({
    k: i + 1,
    kind: c.kind,
    label: c.label,
    path: c.path,
    line: c.line,
    ...(c.handler ? { handler: c.handler } : {}),
    modules,
    files,
  }));
}
