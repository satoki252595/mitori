/**
 * gen requests I3 / I4 (spec §7.8): cheap per-module statistics and ranked main-scope flow seeds. With warmed source,
 * a flow follows calls / JSX into imported repo callables, including files of the same module (≤ 6 file hops).
 * Sparse boot entries retain branches into the core modules; server entry files also offer their actual callbacks.
 * Without source the compatibility path uses file / module graph edges, which alone do not prove execution.
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

const CALLABLE = new Set(["function", "method", "constructor", "class"]);
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
  bare: Set<string>;
  qualified: Map<string, Set<string>>;
  /** Source lines of calls / JSX renders, for narrow caller excerpts. */
  sites: Map<string, number[]>;
}

/** Calls in a range of source lines (string contents and line comments blanked first). */
function collectCalls(lines: readonly string[], from: number, to: number, into: HandlerCalls, partial = false, declarations?: ReadonlySet<string>): void {
  const add = (name: string, line: number) => {
    into.names.add(name);
    const at = into.sites.get(name) ?? [];
    if (!at.includes(line)) at.push(line);
    into.sites.set(name, at);
  };
  for (let i = Math.max(1, from); i <= Math.min(lines.length, to); i++) {
    const l = (lines[i - 1] as string).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`/g, '""').replace(/\/\/.*$|#.*$/, "");
    for (const m of l.matchAll(/(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2] as string;
      if (NOT_CALLS.has(name) || declarations?.has(`${i}:${name}`)) continue;
      add(name, i);
      const q = m[1];
      if (q === undefined) into.bare.add(name);
      else {
        const set = into.qualified.get(q);
        if (set) set.add(name);
        else into.qualified.set(q, new Set([name]));
      }
    }
    // React components are called by JSX, including an imported dynamic component.
    for (const m of l.matchAll(/<([A-Z][\w$]*)\b(?=[\s/>])[^<>]*\/?>/g)) {
      add(m[1] as string, i);
      into.bare.add(m[1] as string);
    }
    if (partial)
      for (const m of l.matchAll(/\bpartial\(\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*,/g)) {
        const name = m[2] as string;
        add(name, i);
        const q = m[1] as string;
        const ns = into.qualified.get(q) ?? new Set<string>();
        ns.add(name);
        into.qualified.set(q, ns);
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
  const calls: HandlerCalls = { names: new Set(), bare: new Set(), qualified: new Map(), sites: new Map() };
  const partial = f.imports.some((i) => i.spec === "functools" && i.names.includes("partial"));
  const declarations = new Set(f.symbols.map((s) => `${s.start}:${s.name}`));
  const body = sym.kind === "class" ? f.symbols.find((s) => s.parent === sym.key && (s.kind === "constructor" || s.name === "__init__")) : sym;
  if (!body) return calls;
  collectCalls(lines, body.bodyStart ?? body.start, body.end, calls, partial, declarations);
  const helpers = f.symbols
    .filter(
      (s) =>
        s.key !== handler &&
        CALLABLE.has(s.kind) &&
        (calls.bare.has(s.name) || (s.parent === body.parent && (calls.qualified.get("self")?.has(s.name) || calls.qualified.get("this")?.has(s.name)))),
    )
    .slice(0, 6);
  for (const h of helpers) collectCalls(lines, h.bodyStart ?? h.start, Math.min(h.end, (h.bodyStart ?? h.start) + 400), calls, partial, declarations);
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
  /** The file its calls reach most (null: none, or no text). */
  file: RepoPath | null;
  /** Distinct callables reached per file. */
  targets: Map<RepoPath, number>;
}

/**
 * Where a handler's own calls go (gen #4c). A call through an import alias lands only in that import's files (one
 * through a stdlib / external alias — `http.Error(` — lands nowhere); a method or bare call lands in the imported
 * repo files imported by this file (common method names excepted). Go also permits calls into the same package
 * without imports. A name edge into an unrelated file is not call evidence. `file` is the most-reached target.
 */
export function handlerReach(
  handler: SymbolKey,
  start: ModuleId,
  st: StructureResult,
  src: FlowSources,
  linesOf?: (p: RepoPath) => readonly string[] | null,
  sameModule = false,
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
    return p !== path && m !== undefined && (sameModule || m !== start) && walkable(p, src.files, langFamily(src.files.get(path)?.lang ?? ""));
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
  // A self/this method is resolved through its same-file helper body, not an unrelated imported namesake.
  const loose = new Set(
    [...calls.names].filter(
      (n) =>
        !COMMON_METHODS.has(n) &&
        (!viaAlias.has(n) || calls.bare.has(n)) &&
        (calls.bare.has(n) || [...calls.qualified].some(([q, ns]) => q !== "self" && q !== "this" && !aliases.has(q) && ns.has(n))),
    ),
  );
  const pool = new Set<RepoPath>();
  for (const { to } of aliases.values()) for (const p of to) pool.add(p);
  if (src.files.get(path)?.lang === "go" && from !== undefined)
    for (const j of (g.out[from] ?? new Map()).keys()) {
      const p = g.paths[j] as RepoPath;
      if (p.slice(0, p.lastIndexOf("/")) === path.slice(0, path.lastIndexOf("/"))) pool.add(p);
    }
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
  // a product site's legal / icon pages are not what the app does (text-to-cad's docs app: privacy, terms, icon)
  if (
    /(^|\/)(privacy|privacy-policy|terms|terms-of-service|terms-of-use|tos|legal|cookies?|cookie-policy|imprint|icons?|apple-icon|opengraph-image|twitter-image|sitemap|manifest)(\/|$)/.test(
      p,
    )
  )
    return true;
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
  const helpers = (symbols: readonly Sym[]) => {
    if (!text) return;
    for (const s of symbols) {
      const calls = handlerCalls(s.key, files, text);
      for (const h of (files.get(s.path)?.symbols ?? [])
        .filter(
          (h) =>
            h.key !== s.key &&
            CALLABLE.has(h.kind) &&
            (calls?.bare.has(h.name) || (h.parent === s.parent && (calls?.qualified.get("self")?.has(h.name) || calls?.qualified.get("this")?.has(h.name)))),
        )
        .sort((a, b) => {
          const at = calls?.sites.get(a.name)?.[0] ?? Infinity;
          const bt = calls?.sites.get(b.name)?.[0] ?? Infinity;
          const direct = (n: number) => (n >= s.start && n <= s.end ? 1 : 0);
          return direct(bt) - direct(at) || at - bt;
        })
        .slice(0, 6))
        push(h);
    }
  };
  const first = files.get(seed.files[0] ?? seed.path);
  if (seed.handler) push(files.get(seed.handler.slice(0, seed.handler.indexOf("#")))?.symbols.find((s) => s.key === seed.handler));
  else if (seed.path === first?.path)
    // no handler: the callable around the defining line (`main`, the command table's function)
    push(
      first.symbols.filter((s) => CALLABLE.has(s.kind) && s.start <= seed.line && seed.line <= s.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0],
    );
  let previous = [...out];
  helpers(previous);
  for (let j = 1; j < seed.files.length; j++) {
    const from = files.get(seed.files[j - 1] as RepoPath);
    const to = files.get(seed.files[j] as RepoPath);
    if (!from || !to) continue;
    const fileCalls = () => new Set(from.refs.filter((r) => r.kind === "call" || r.kind === "new" || r.kind === "jsx" || r.kind === "qual").map((r) => r.name));
    const called = text && previous.length > 0 ? new Set(previous.flatMap((s) => [...(handlerCalls(s.key, files, text)?.names ?? [])])) : fileCalls();
    const next = [...to.symbols]
      .filter((s) => CALLABLE.has(s.kind) && called.has(s.name))
      .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
      .slice(0, 6);
    // Keep a callee's same-file validation / dispatch helpers beside it, before the next sibling body.
    for (const s of next) {
      push(s);
      if (s.kind === "function") helpers([s]);
    }
    helpers(next.filter((s) => s.kind !== "function")); // explicitly called class methods precede class-wide helpers
    previous = next;
  }
  return out;
}

/** Lines of a doc seed shown before anything else (its head names the command / skill). */
const DOC_HEAD_LINES = 40;
/** Headings that introduce a procedure (a command / skill doc's fixed steps live under one of these). */
const DOC_PROCEDURE_RE =
  /手順|使い方|やり方|procedure|steps?|how[\s-]?to|usage|guide|tutorial|getting[\s-]?started|walkthrough|workflow|クイックスタート|はじめに/i;
/** A numbered step (`1. …`, `2) …`). */
const DOC_STEP_RE = /^\s*\d+[.)]\s+\S/;
/** A Markdown heading (`## …`). */
const DOC_HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
/** Script extensions a doc may point at (bundled helpers of a command / skill). */
const DOC_SCRIPT_EXTS: ReadonlySet<string> = new Set(["py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "go", "rs", "rb", "sh", "bash"]);
/** A doc seed quotes at most this many bundled script files, this many entry functions each. */
const DOC_SCRIPT_FILES = 2;
const DOC_SCRIPT_FUNCS = 3;
const DOC_CALLABLE: ReadonlySet<string> = new Set(["function", "method", "constructor"]);

function docDirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Collapse `.` / `..` segments of a `/`-joined repo path (never escapes above the root). */
function normalizeRepoPath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Bundled scripts a doc mentions, in mention order (a command / skill doc names the helper it runs: `bun run
 * cli/run.py …`, backticked or bare). Each mention resolves doc-dir-relative first, then repo-root-relative, so a
 * root-relative mention from a nested doc still resolves; `tools/` scripts count like any other scope. At most
 * {@link DOC_SCRIPT_FILES} existing files.
 */
export function docScriptRefs(doc: RepoPath, text: string, exists: (p: RepoPath) => boolean): RepoPath[] {
  const dir = docDirOf(doc);
  const out: RepoPath[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    const n = normalizeRepoPath(p);
    if (n === "" || n === doc || seen.has(n)) return;
    seen.add(n);
    if (exists(n as RepoPath)) out.push(n as RepoPath);
  };
  for (const raw of text.split(/\s+/)) {
    const t = raw
      .replace(/^['"`([{<]+/, "")
      .replace(/['"`)\]}>.,;:!?…—–-]+$/, "")
      .replace(/^\.\//, "");
    if (!t.includes("/") || t.includes("://") || t.startsWith("/")) continue;
    const base = t.slice(t.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    if (dot < 0 || !DOC_SCRIPT_EXTS.has(base.slice(dot + 1).toLowerCase())) continue;
    if (dir !== "") push(`${dir}/${t}`);
    push(t);
  }
  return out.slice(0, DOC_SCRIPT_FILES);
}

/**
 * Bodies of a doc seed (a command / skill doc: no modules, `class === "docs"`): the doc itself as line-ranged slices —
 * head, procedure sections (a procedure heading or numbered steps), the rest — then the entry functions (`main`
 * first) of the bundled scripts it mentions. Packed through `packSlices`, so budget, numbering and secret scanning
 * follow the existing rules; code seeds never reach here.
 */
function docFlowBodies(seed: FlowSeed, files: ReadonlyMap<RepoPath, StageFile>, budgetTokens: number, io: SliceIo): CodeSlice[] {
  const path = seed.files[0] ?? seed.path;
  const text = io.text(path);
  if (text === null) return [];
  const lines = text.split("\n");
  const n = lines.length;
  const blob = files.get(path)?.blob ?? "";
  const ranges: { path: RepoPath; blob: string; start: number; end: number }[] = [];
  const covered = new Array<boolean>(n + 1).fill(false);
  // push the uncovered runs of [start, end], then mark the whole range covered (a later section never repeats lines)
  const cover = (start: number, end: number) => {
    const s = Math.max(1, start);
    const e = Math.min(n, end);
    let run: number | null = null;
    for (let l = s; l <= e; l++) {
      if (!covered[l]) run = run ?? l;
      else if (run !== null) {
        ranges.push({ path, blob, start: run, end: l - 1 });
        run = null;
      }
    }
    if (run !== null) ranges.push({ path, blob, start: run, end: e });
    for (let l = s; l <= e; l++) covered[l] = true;
  };
  if (n > 0) cover(1, Math.min(DOC_HEAD_LINES, n));
  const headings: { line: number; level: number; text: string }[] = [];
  lines.forEach((l, i) => {
    const m = DOC_HEADING_RE.exec(l);
    if (m) headings.push({ line: i + 1, level: (m[1] as string).length, text: m[2] as string });
  });
  const proc: [number, number][] = [];
  headings.forEach((h, i) => {
    let end = n;
    for (let j = i + 1; j < headings.length; j++) {
      const next = headings[j] as { line: number; level: number };
      if (next.level <= h.level) {
        end = next.line - 1;
        break;
      }
    }
    const steps = lines.slice(h.line, end).filter((l) => DOC_STEP_RE.test(l)).length;
    if (DOC_PROCEDURE_RE.test(h.text) || steps >= 2) proc.push([h.line, end]);
  });
  // numbered steps with no heading (a bare run of two or more)
  let run: number | null = null;
  for (let l = 1; l <= n + 1; l++) {
    if (l <= n && DOC_STEP_RE.test(lines[l - 1] as string)) run = run ?? l;
    else {
      if (run !== null && l - run >= 2) proc.push([run, l - 1]);
      run = null;
    }
  }
  for (const [s, e] of proc.sort((a, b) => a[0] - b[0])) cover(s, e);
  if (n > 0) cover(1, n);
  for (const p of docScriptRefs(path, text, (q) => files.has(q))) {
    const f = files.get(p);
    if (!f) continue;
    const syms = f.symbols.filter((s) => DOC_CALLABLE.has(s.kind));
    const mains = syms.filter((s) => s.name === "main");
    const rest = syms.filter((s) => s.name !== "main").sort((a, b) => a.start - b.start);
    for (const s of [...mains, ...rest].slice(0, DOC_SCRIPT_FUNCS)) ranges.push({ path: p, blob: s.blob, start: s.start, end: s.end });
  }
  return packSlices(ranges, budgetTokens, io);
}

/**
 * `flowBodies(seed, budget)` (gen I4, spec §7.8): the flow's bodies packed in order with the hot-body slice rules
 * (§7.3): numbered `start..end`, bodies over 200 lines keep their first 80 lines + `⋮`, a slice that does not fit is
 * skipped and 3 skips in a row stop, adjacent / overlapping slices of a file are merged.
 */
export function flowBodies(seed: FlowSeed, files: ReadonlyMap<RepoPath, StageFile>, budgetTokens: number, io: SliceIo): CodeSlice[] {
  // [CR wp32c-1] a doc seed quotes its own lines, not code bodies; code seeds (even module-less synthetic ones)
  // keep the old path.
  const first = seed.files[0] ?? seed.path;
  if (seed.modules.length === 0 && files.get(first)?.class === "docs") return docFlowBodies(seed, files, budgetTokens, io);
  const targets = flowTargets(seed, files, io.text);
  const ranges: { path: RepoPath; blob: string; start: number; end: number }[] = [];
  for (const s of targets) {
    const head = { path: s.path, blob: s.blob, start: s.start, end: s.end };
    ranges.push(head);
    const calls = handlerCalls(s.key, files, io.text);
    // A calling body keeps its declaration and the bounded lines where the selected callee is actually used.
    // Long components still use the existing 80-line head; short wrappers / guards remain whole.
    const headLines = s.end - s.start + 1 > 200 ? 80 : 24;
    let shown = 0;
    for (const next of targets) {
      if (next.key === s.key) continue;
      const sites = calls?.sites.get(next.name) ?? [];
      for (const line of s.kind === "function" ? sites : sites.slice(0, 1)) {
        if (line < s.start + headLines || line > s.end || shown >= 6) continue;
        ranges.push({ path: s.path, blob: s.blob, start: Math.max(s.start, line - 3), end: Math.min(s.end, line + 3) });
        shown++;
      }
    }
    if (shown > 0 || targets.some((t) => t.key !== s.key && t.path === s.path && t.start >= s.start + headLines && t.end <= s.end))
      head.end = s.start + headLines - 1; // do not merge deep callers / selected class methods back into a folded whole body
  }
  // A selected class already contains its short methods. Charge displayed lines once before the packer's skip
  // limit can discard a later real callee. A folded body covers only its displayed 80-line head.
  const unique = ranges.filter(
    (r, i) =>
      !ranges
        .slice(0, i)
        .some(
          (p) =>
            p.path === r.path &&
            p.blob === r.blob &&
            p.start <= r.start &&
            (p.end - p.start + 1 > 200 ? p.start + 79 : p.end) >= (r.end - r.start + 1 > 200 ? r.start + 79 : r.end),
        ),
  );
  return packSlices(unique, budgetTokens, io);
}

/** What `flowSeeds` may read beyond the structure: the S1 files (symbols, scopes), current texts, resolved imports. */
export interface FlowSources {
  files: ReadonlyMap<RepoPath, StageFile>;
  /** Current text of a file (null when not at hand: the handler then ranks by its file and walks by file edges). */
  text(path: RepoPath): string | null;
  /** Resolved imports of a file (an alias-qualified call lands in its import's files only). */
  imports?(path: RepoPath): readonly ResolvedImport[];
}

/** Source-confirmed call paths, including files inside one module. Import edges alone are not calls. */
function sourceWalks(first: RepoPath, handler: SymbolKey, st: StructureResult, src: FlowSources): { modules: ModuleId[]; files: RepoPath[] }[] {
  const start = st.moduleOf.get(first);
  if (start === undefined) return [];
  const queue = [{ files: [first], symbols: [handler] }];
  const found = new Map<RepoPath, { files: RepoPath[]; symbols: SymbolKey[] }>([[first, queue[0] as (typeof queue)[number]]]);
  for (let i = 0; i < queue.length && found.size < 64; i++) {
    const cur = queue[i] as (typeof queue)[number];
    if (cur.files.length > MAX_HOPS) continue;
    const from = cur.files[cur.files.length - 1] as RepoPath;
    const targets = new Set<RepoPath>();
    const names = new Set<string>();
    for (const key of cur.symbols) {
      for (const p of handlerReach(key, st.moduleOf.get(from) ?? start, st, src, undefined, true).targets.keys()) targets.add(p);
      for (const n of handlerCalls(key, src.files, src.text)?.names ?? []) names.add(n);
    }
    const next = [...targets]
      .filter((p) => !found.has(p))
      .map((p) => ({ p, symbols: (src.files.get(p)?.symbols ?? []).filter((s) => CALLABLE.has(s.kind) && names.has(s.name)) }))
      .sort((a, b) => b.symbols.reduce((n, s) => n + s.end - s.start, 0) - a.symbols.reduce((n, s) => n + s.end - s.start, 0) || byStr(a.p, b.p));
    for (const { p, symbols } of next) {
      if (found.size >= 64 || symbols.length === 0) continue;
      const item = { files: [...cur.files, p], symbols: symbols.map((s) => s.key) };
      found.set(p, item);
      queue.push(item);
    }
  }
  const moduleRank = (p: RepoPath) => (st.moduleOf.get(p) === start ? 0 : (st.modules.find((m) => m.id === st.moduleOf.get(p))?.rank ?? 0));
  return [...found.values()]
    .sort((a, b) => {
      const ap = a.files.at(-1) as RepoPath;
      const bp = b.files.at(-1) as RepoPath;
      const sameModule = st.moduleOf.get(ap) === start && st.moduleOf.get(bp) === start;
      return (
        moduleRank(bp) - moduleRank(ap) ||
        (sameModule ? b.files.length - a.files.length : 0) ||
        (src.files.get(bp)?.loc ?? 0) - (src.files.get(ap)?.loc ?? 0) ||
        byStr(a.files.join(">"), b.files.join(">"))
      );
    })
    .map(({ files }) => ({ files, modules: [...new Set(files.flatMap((p) => st.moduleOf.get(p) ?? []))] }));
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
/**
 * Entries of a project's own website, docs or demos come after the product's (rea: all 8 seeds were the landing
 * page's calculator / dino animations; text-to-cad: its docs app's privacy, terms and icon pages). They still seed
 * a repository that has nothing else.
 */
const ASIDE_PATH_RE =
  /(^|\/)(website|site|docs?|documentation|examples?|demos?|showcase|landing|marketing|tests?|__tests__|spec|e2e|fixtures?|evals?|bench(es)?)\//;
const aside = (file: string) => (ASIDE_PATH_RE.test(file) ? 1 : 0);
// A skill's own entry (a SKILL.md directly under a skills/ directory); reference pages beside it are not entries.
const isSkillEntry = (path: string) => /(^|\/)skills\/[^/]+\/SKILL\.md$/i.test(path);

/** Agent-instruction directories (core `AGENT_DOC_DIRS`, mirrored: this file imports types only). */
const AGENT_SKILL_DIRS: ReadonlySet<string> = new Set([".claude", ".codex", ".agents", ".cursor"]);

/**
 * Skill directory prefix (`<dirs>/<agent>/skills/<name>`) of skill-bundled code, else null. A bare `skills/`
 * tree outside the agent-instruction directories (context-mode's root `skills/`) is not one.
 */
function skillCodeDir(path: string): string | null {
  const segs = path.split("/");
  for (let i = 0; i + 3 < segs.length; i++) {
    if (AGENT_SKILL_DIRS.has(segs[i] as string) && segs[i + 1] === "skills") return segs.slice(0, i + 3).join("/");
  }
  return null;
}

/**
 * [WP32b] the reference doc naming the flows: the root README, else the root CLAUDE.md / AGENTS.md. Found through
 * `existing_doc` facts; the body comes from the warmed texts (`FlowSources.text`), capped at the first 64 KiB.
 */
export function flowRefPath(facts: FactsResult): RepoPath | null {
  const docs = facts.facts.filter((f) => f.kind === "existing_doc");
  const roots = docs.filter((d) => !d.path.includes("/") && /^readme(\.|$)/i.test(d.path)).sort((a, b) => byStr(a.path, b.path));
  const first = roots[0];
  if (first) return first.path;
  for (const base of ["CLAUDE.md", "AGENTS.md"]) {
    const hit = docs.find((d) => d.path === base);
    if (hit) return hit.path;
  }
  return null;
}

/** Non-overlapping occurrences of `needle` in `hay` (both already cased alike; empty needle never occurs). */
function countMentions(hay: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let at = 0;
  for (;;) {
    const i = hay.indexOf(needle, at);
    if (i < 0) return n;
    n++;
    at = i + needle.length;
  }
}

/** A per-tool vendored copy (`configs/<tool>/…`); the canonical skill / command lives outside it. */
const vendoredDoc = (path: string) => (/(^|\/)configs\//.test(path) ? 1 : 0);

/**
 * Seeds one cli / entry file may contribute: a small helper binary (its main, its command table, same-file
 * callables) must not fill the seeds by itself — a main plus its command table plus one same-file callable stay
 * legitimate. Routes of one router file are unaffected (gen #4c: each handler of one router file is a flow of its
 * own).
 */
const PER_FILE_SEEDS = 3;

export function flowSeeds(st: StructureResult, facts: FactsResult, limit = 8, src?: FlowSources): FlowSeed[] {
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  type Cand = {
    kind: FlowSeed["kind"];
    label: string;
    path: RepoPath;
    line: number;
    file: RepoPath;
    handler?: SymbolKey;
    /** Instruction-doc seed (no module, single-file walk). */
    doc?: boolean;
    order: number;
    tier: number;
    /** Skill-bundled code directory (`skillCodeDir`), else null. */
    skill: string | null;
    /** 1 for a website / docs / demo / test-area file: after every product candidate, routes included. */
    aside: number;
    /** [WP32b] root README mentions of an instruction-doc label (0 for product code). */
    mentions: number;
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
      const skill = skillCodeDir(file);
      cands.push({
        kind: "route",
        label: `${r.method} ${r.pattern}`,
        path: r.path,
        line: r.line,
        file,
        ...(r.handler ? { handler: r.handler } : {}),
        order: 0,
        // [WP32f] skill-bundled code seeds at the skill tier, behind every product candidate
        tier: skill !== null ? 2 : infraRoute(r) ? 1 : 0,
        skill,
        aside: aside(file),
        mentions: 0,
        score: 0,
        weight: 0,
        size: r.handler ? bodyOf(r.handler) : 0,
        reach: src && r.handler && start !== undefined ? handlerReach(r.handler, start, st, src, linesOf) : null,
      });
    } else if (f.kind === "cli") {
      // [WP32f] skill-bundled code seeds at the skill tier, behind every product candidate
      const cliSkill = skillCodeDir(f.path);
      cands.push({
        kind: "cli",
        label: f.command,
        path: f.path,
        line: f.line,
        file: f.path,
        order: 1,
        tier: cliSkill !== null ? 2 : 0,
        skill: cliSkill,
        aside: aside(f.path),
        mentions: 0,
        score: 0,
        weight: 0,
        size: 0,
        reach: null,
      });
    } else if (f.kind === "entry") {
      const file = f.entry === "main" && st.moduleOf.has(f.label) ? f.label : f.path;
      // [WP32f] skill-bundled code seeds at the skill tier, behind every product candidate
      const entrySkill = skillCodeDir(file);
      const symbols = src?.files.get(file)?.symbols ?? [];
      const handler =
        symbols.find((s) => s.name === "main" && CALLABLE.has(s.kind)) ?? symbols.find((s) => CALLABLE.has(s.kind) && s.start <= f.line && f.line <= s.end);
      cands.push({
        kind: "entry",
        label: f.label,
        path: f.path,
        line: f.line,
        file,
        ...(handler ? { handler: handler.key } : {}),
        order: 2,
        // `go run gen.go` style generators are labelled by their file: after the program's own mains
        tier: entrySkill !== null ? 2 : f.entry === "main" && /\.[A-Za-z0-9]+$/.test(f.label) ? 1 : 0,
        skill: entrySkill,
        aside: aside(file),
        mentions: 0,
        score: 0,
        weight: 0,
        size: 0,
        reach: null,
      });
      // A server main registers callbacks but does not execute the product's operation itself. Keep the actual
      // callables of its entry file as candidates too; their names/locations are evidence, not inferred HTTP routes.
      // [WP32f] a manifest-redirected file (entry.node@1's bin/main target: a CLI dispatcher, not a server main)
      // never expands: its small helpers (an argument-rejecting guard) used to crowd out the product and command
      // seeds. Entries defined in their own file keep the expansion.
      if (src && f.detector !== "entry.node@1")
        for (const s of symbols) {
          if (!CALLABLE.has(s.kind) || s.kind === "class" || s.key === handler?.key || s.qualname.split(".").some((n) => n.startsWith("_"))) continue;
          const start = st.moduleOf.get(file);
          if (start === undefined) continue;
          const reach = handlerReach(s.key, start, st, src, linesOf, true);
          if (reach.targets.size === 0) continue;
          cands.push({
            kind: "entry",
            label: s.qualname,
            path: file,
            line: s.start,
            file,
            handler: s.key,
            order: 2,
            // a callable of a generator / site entry file stays behind the program's own entries
            tier: entrySkill !== null ? 2 : f.entry === "main" && /\.[A-Za-z0-9]+$/.test(f.label) ? 1 : 0,
            skill: entrySkill,
            aside: aside(file),
            mentions: 0,
            score: 0,
            weight: 0,
            size: s.end - s.start + 1,
            reach,
          });
        }
    } else if (f.kind === "existing_doc" && (f.role === "command" || f.role === "agent" || isSkillEntry(f.path))) {
      // [CR wp30-2] user-invoked instruction docs seed flows like entries: slash commands first, then skill
      // entries (SKILL.md only; reference pages beside them enter through doc excerpts, not seeds), then agents.
      // Tier 1+ keeps every product entry ahead of them; single-file walk (no handler).
      const base = f.path.slice(f.path.lastIndexOf("/") + 1).replace(/\.[A-Za-z0-9]+$/, "");
      // A skill is known by its directory (SKILL.md's first line is usually frontmatter, not a heading).
      const skill = f.path.slice(0, f.path.lastIndexOf("/")).split("/").pop() ?? base;
      cands.push({
        kind: "entry",
        label: f.role === "command" ? `/${base}` : isSkillEntry(f.path) ? skill : f.title,
        path: f.path,
        line: f.line,
        file: f.path,
        doc: true,
        order: 2,
        tier: f.role === "command" ? 1 : 2,
        skill: null,
        aside: aside(f.path),
        mentions: 0,
        score: 0,
        weight: 0,
        size: 0,
        reach: null,
      });
    }
  });
  // [WP32b] one seed per instruction-doc label: repos copy a skill per tool (`configs/<tool>/skills/<name>`).
  // The canonical copy wins (off `configs/`), then the shorter path, then path order. Product seeds are untouched.
  {
    const best = new Map<string, Cand>();
    for (const c of cands) {
      if (!c.doc) continue;
      const prev = best.get(c.label);
      if (prev === undefined) best.set(c.label, c);
      else {
        const rank = vendoredDoc(c.path) - vendoredDoc(prev.path) || c.path.length - prev.path.length || byStr(c.path, prev.path);
        if (rank < 0) best.set(c.label, c);
      }
    }
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i] as Cand;
      if (c.doc && best.get(c.label) !== c) cands.splice(i, 1);
    }
  }
  // [WP32f] a skill's bundled code stays one seed: its SKILL.md doc seed already carries the bundled CLI in its
  // BODIES, so code candidates of that skill drop out; without one, a single code entry (entry, else cli, else
  // route) remains. Outside the agent-instruction `skills/` trees nothing is capped.
  {
    const docSkills = new Set<string>();
    for (const c of cands) if (c.doc === true && c.file.endsWith("/SKILL.md")) docSkills.add(c.file.slice(0, -"/SKILL.md".length));
    const rankSkill = (c: Cand) => (c.kind === "entry" ? 0 : c.kind === "cli" ? 1 : 2);
    const kept = new Map<string, Cand>();
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i] as Cand;
      if (c.skill === null) continue;
      if (docSkills.has(c.skill)) {
        cands.splice(i, 1);
        continue;
      }
      const prev = kept.get(c.skill);
      if (prev === undefined) kept.set(c.skill, c);
      else if ((rankSkill(c) - rankSkill(prev) || byStr(c.path, prev.path) || c.line - prev.line) < 0) {
        kept.set(c.skill, c);
        cands.splice(cands.indexOf(prev), 1);
      } else cands.splice(i, 1);
    }
  }
  // [WP32b] same-tier instruction docs rank by reference-doc mentions (`/scrape`, the skill name), ties by path.
  {
    const ref = flowRefPath(facts);
    const raw = ref === null ? undefined : src?.text(ref);
    const body = raw === undefined || raw === null ? undefined : raw.slice(0, 65_536).toLowerCase();
    if (body !== undefined) for (const c of cands) if (c.doc) c.mentions = countMentions(body, c.label.toLowerCase());
  }
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
  // CLI surface per binary (first command word): the product's own command dwarfs a helper's few subcommands
  const progOf = (c: { label: string }) => c.label.split(" ", 1)[0] ?? "";
  const progSize = new Map<string, number>();
  for (const c of cands) if (c.kind === "cli") progSize.set(progOf(c), (progSize.get(progOf(c)) ?? 0) + 1);
  cands.sort((a, b) => {
    const base = a.aside - b.aside || a.order - b.order || a.tier - b.tier;
    if (base !== 0) return base;
    // [WP32b] instruction docs of one tier follow the reference doc, ties by path; product code is untouched.
    if (a.doc && b.doc) return b.mentions - a.mentions || byStr(a.path, b.path);
    // the product's command comes before a helper binary's: it offers the interface a newcomer meets, and file
    // PageRank already ranks its implementation above a helper's
    if (a.kind === "cli") {
      const r = (progSize.get(progOf(b)) ?? 0) - (progSize.get(progOf(a)) ?? 0);
      if (r !== 0) return r;
    }
    return (
      b.score - a.score ||
      b.weight - a.weight ||
      b.size - a.size ||
      rank(b.file) - rank(a.file) ||
      byStr(a.path, b.path) ||
      a.line - b.line ||
      byStr(a.label, b.label)
    );
  });
  // with any product candidate, website / docs / demo / test ones are not offered at all: the prompt picks the flows
  // to write among the seeds, and kept them when they filled the remaining slots (text-to-cad, 2026-10-12)
  if (cands.some((c) => c.aside === 0)) cands.splice(0, cands.length, ...cands.filter((c) => c.aside === 0));
  const walked: { c: Cand; modules: ModuleId[]; files: RepoPath[] }[] = [];
  const seen = new Set<string>();
  const perFile = new Map<RepoPath, number>();
  const takenProg = new Set<string>();
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
      if (start === undefined) {
        // [CR wp30-2] instruction docs belong to no module: a single-file seed (no walk), or nothing.
        if (c.doc !== true) continue;
        const key = `${c.kind}\u0000${c.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        walked.push({ c, modules: [], files: [c.file] });
        n++;
        continue;
      }
      const first = st.graph.index.has(c.file) ? c.file : (st.modules.find((m) => m.id === start)?.paths[0] ?? c.file);
      const { modules, files } = src
        ? ((c.handler ? sourceWalks(first, c.handler, st, src)[0] : undefined) ?? { modules: [start], files: [first] })
        : flowWalk(first, start, st, undefined, c.reach?.file ?? undefined);
      // never the module walk: a handler is a flow of its own (its body and callees differ); without a handler the
      // file walk decides (with text the handlers of one router file walk where their own calls go)
      const key = c.handler && src ? `${c.kind}\u0000${c.handler}` : `${c.kind}\u0000${src ? files.join(",") : modules.join(",")}`;
      if (seen.has(key)) continue;
      if (c.kind !== "route" && (perFile.get(c.file) ?? 0) >= PER_FILE_SEEDS) continue;
      // one binary's command takes one seed: a helper's subcommands must not crowd out the product's command
      if (c.kind === "cli" && takenProg.has(progOf(c))) continue;
      seen.add(key);
      if (c.kind !== "route") perFile.set(c.file, (perFile.get(c.file) ?? 0) + 1);
      if (c.kind === "cli") takenProg.add(progOf(c));
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
  // One boot route must not suppress its real internal branches. Supplement sparse entry sets only; the same
  // source-confirmed paths supply gen, the static change guides and text warming (no import-only graph fallback).
  if (src && walked.length < limit) {
    const sparse = walked.length < Math.min(3, limit);
    const cap = sparse ? Math.min(3, limit) : limit;
    const covered = new Set(walked.flatMap((w) => w.modules));
    for (const { c } of [...walked]) {
      if (!c.handler || (!sparse && c.kind !== "entry")) continue;
      for (const path of sourceWalks(c.file, c.handler, st, src)) {
        if (walked.length >= cap) break;
        if (path.files.length < 2 || walked.some((w) => w.files.join(">") === path.files.join(">"))) continue;
        const end = path.files.at(-1) as RepoPath;
        const module = st.moduleOf.get(end);
        if (module === undefined) continue;
        if (sparse && covered.has(module)) continue;
        covered.add(module);
        walked.push({ c: { ...c, label: `${c.label} → ${end}` }, ...path });
      }
    }
  }
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
