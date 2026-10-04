// Large-file outline (remaining backlog «4,800 行級のコンポーネントの中身»): a file over 1,500 lines — m3e's
// `app/Editor.tsx` is one 4,400-line component — told a reader nothing about where to look; the symbol outline listed
// one function. From the symbols and the text alone (0 tokens): runs of top-level declarations (types, constants,
// functions, one receiver's methods, handler families) and, inside a symbol of 400+ lines, the regions of its body —
// state hooks, effects, derived values, handlers, helpers, the rendered JSX — each with its line range.
import type { LineNo, SourceLang, SymbolEntry } from "@mitori/core";
import type { FileRegion } from "@mitori/doc";

/** Files longer than this get a region outline (code view, module chapter). */
export const REGION_MIN_LINES = 1500;
/** Symbols longer than this have their body outlined too. */
export const BODY_MIN_LINES = 400;
/** At most this many regions per file (adjacent same-kind runs merge first). */
const MAX_REGIONS = 24;
const NAMES = 6;

const TYPE_KINDS = new Set(["interface", "type", "struct", "enum", "trait"]);
const CONST_KINDS = new Set(["const", "var"]);
const FN_KINDS = new Set(["function", "method", "constructor", "class", "impl"]);
const HANDLER_NAME = /^(handle|on)[A-Z_]/;

type Run = FileRegion & { exported: number; big?: boolean };

/** The kind of a top-level declaration's run. */
function classOf(s: SymbolEntry): { kind: FileRegion["kind"]; host?: string } | null {
  if (TYPE_KINDS.has(s.kind)) return { kind: "types" };
  if (CONST_KINDS.has(s.kind)) return { kind: "constants" };
  if (!FN_KINDS.has(s.kind)) return null;
  // Go methods / Rust impl items carry their receiver in the qualname (`Server.handleX`)
  const dot = s.qualname.lastIndexOf(".");
  if (s.kind === "method" && dot > 0) return { kind: HANDLER_NAME.test(s.name) ? "handlers" : "methods", host: s.qualname.slice(0, dot) };
  if (HANDLER_NAME.test(s.name)) return { kind: "handlers" };
  return { kind: "functions" };
}

/** Top-level runs: consecutive declarations of one kind (and receiver) form one region. */
function topRuns(syms: readonly SymbolEntry[]): Run[] {
  // a Go method names its receiver as parent but is declared at the top level, outside the type's lines
  const byKey = new Map(syms.map((s) => [s.key, s]));
  const outside = (s: SymbolEntry) => {
    if (!s.parent) return true;
    const p = byKey.get(s.parent);
    return p === undefined || s.start > p.end || s.end < p.start;
  };
  const top = syms.filter((s) => s.kind !== "field" && s.kind !== "test" && outside(s)).sort((a, b) => a.start - b.start || b.end - a.end);
  const runs: Run[] = [];
  for (const s of top) {
    const c = classOf(s);
    if (!c) continue;
    const last = runs[runs.length - 1];
    // a big declaration is a region of its own (its body is outlined below it)
    const big = s.end - s.start + 1 >= BODY_MIN_LINES;
    if (last && !big && last.depth === 0 && last.kind === c.kind && last.host === c.host && !last.big) {
      last.end = Math.max(last.end, s.end) as LineNo;
      last.count = (last.count ?? 1) + 1;
      if (s.exported) last.exported++;
      last.names.push(s.name);
      continue;
    }
    runs.push({
      kind: big ? "symbol" : c.kind,
      start: s.start as LineNo,
      end: s.end as LineNo,
      count: 1,
      names: [s.name],
      depth: 0,
      exported: s.exported ? 1 : 0,
      ...(c.host ? { host: c.host } : {}),
      ...(big ? { host: s.name, big: true, symbolKind: s.kind } : {}),
    });
  }
  return runs;
}

/** A statement of a function body: what it declares. */
function statementKind(line: string): { kind: FileRegion["kind"]; name?: string; hook?: string } | null {
  const l = line.trim();
  let m = /^(?:const|let|var)\s+(?:\[\s*([A-Za-z_$][\w$]*)[^\]]*\]|([A-Za-z_$][\w$]*))\s*(?::[^=]+)?=\s*(?:React\.)?(use[A-Z]\w*)\s*[<(]/.exec(l);
  if (m) {
    const hook = m[3] as string;
    const name = (m[1] ?? m[2]) as string;
    if (hook === "useCallback") return { kind: HANDLER_NAME.test(name) ? "handlers" : "helpers", name, hook };
    if (hook === "useMemo") return { kind: "derived", name, hook };
    if (hook === "useEffect" || hook === "useLayoutEffect") return { kind: "effects", name, hook };
    return { kind: "state", name, hook };
  }
  m = /^(?:React\.)?(useEffect|useLayoutEffect|useInsertionEffect)\s*\(/.exec(l);
  if (m) return { kind: "effects", hook: m[1] as string };
  m = /^(?:React\.)?(use[A-Z]\w*)\s*\(/.exec(l);
  if (m) return { kind: "state", hook: m[1] as string };
  m =
    /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/.exec(l) ??
    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(l);
  if (m) {
    const name = m[1] as string;
    return { kind: HANDLER_NAME.test(name) ? "handlers" : "helpers", name };
  }
  if (/^return\s*\(?\s*(<|$)/.test(l)) return { kind: "render" };
  return null;
}

/**
 * Regions of a big symbol's body: its top-level statements (those at the body's own indentation) by what they
 * declare. A statement that declares nothing continues the region before it; the rendered JSX runs to the end.
 */
function bodyRegions(lines: readonly string[], s: Pick<SymbolEntry, "start" | "end" | "name">): Run[] {
  let indent = -1;
  for (let i = s.start; i < s.end && i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trim() === "" || /^\s*(\/\/|\*|\/\*)/.test(l)) continue;
    indent = l.length - l.trimStart().length;
    break;
  }
  if (indent <= 0) return [];
  const out: Run[] = [];
  for (let i = s.start; i < s.end && i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trim() === "" || l.length - l.trimStart().length !== indent) continue;
    const st = statementKind(l);
    const lineNo = (i + 1) as LineNo;
    const last = out[out.length - 1];
    if (last) last.end = (lineNo - 1) as LineNo;
    if (!st) continue;
    if (last && last.kind === st.kind) {
      last.count = (last.count ?? 1) + 1;
      if (st.name) last.names.push(st.name);
      if (st.hook) last.hooks = { ...last.hooks, [st.hook]: (last.hooks?.[st.hook] ?? 0) + 1 };
      continue;
    }
    if (last?.kind === "render") break; // the JSX block is the body's tail
    out.push({
      kind: st.kind,
      start: lineNo,
      end: lineNo,
      count: 1,
      names: st.name ? [st.name] : [],
      depth: 1,
      host: s.name,
      exported: 0,
      ...(st.hook ? { hooks: { [st.hook]: 1 } } : {}),
    });
  }
  const tail = out[out.length - 1];
  if (tail) tail.end = Math.max(tail.start, s.end - 1) as LineNo;
  // one-statement interruptions merge into the region before them (a stray helper between two handler runs)
  const merged: Run[] = [];
  for (const r of out) {
    const prev = merged[merged.length - 1];
    if (prev && (r.count ?? 1) === 1 && r.end - r.start < 3 && r.kind !== "render" && prev.kind !== "render") {
      prev.end = r.end;
      continue;
    }
    merged.push(r);
  }
  return merged;
}

/**
 * Regions of a big declaration from its member symbols (a class's methods and fields, a Rust impl's functions — any
 * language): consecutive members of one kind form a region (fields → `state`, `handle*` / `on*` → `handlers`).
 */
function memberRegions(syms: readonly SymbolEntry[], owner: Pick<Run, "start" | "end" | "host">): Run[] {
  const kids = syms
    .filter((s) => s.parent?.endsWith(`#${owner.host}`) && s.start >= owner.start && s.end <= owner.end)
    .sort((a, b) => a.start - b.start);
  const out: Run[] = [];
  for (const s of kids) {
    const kind: FileRegion["kind"] = s.kind === "field" ? "state" : HANDLER_NAME.test(s.name) ? "handlers" : FN_KINDS.has(s.kind) ? "methods" : "constants";
    const last = out[out.length - 1];
    if (last && last.kind === kind) {
      last.end = Math.max(last.end, s.end) as LineNo;
      last.count = (last.count ?? 1) + 1;
      last.names.push(s.name);
      continue;
    }
    out.push({
      kind,
      start: s.start as LineNo,
      end: s.end as LineNo,
      count: 1,
      names: [s.name],
      depth: 1,
      exported: 0,
      ...(owner.host ? { host: owner.host } : {}),
    });
  }
  return out;
}

/**
 * Coarsen to at most `max` regions: repeatedly merge the adjacent pair with the smallest line span (a `symbol`
 * region is never merged); the merged region is the larger one's kind — the reader sees what most of the lines are.
 */
function coarsen(runs: Run[], max: number): Run[] {
  const out = [...runs];
  while (out.length > max) {
    let best = -1;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i] as Run;
      const b = out[i + 1] as Run;
      if (a.big || b.big || a.kind === "render" || b.kind === "render") continue;
      const size = a.end - a.start + (b.end - b.start) + (a.kind === b.kind ? 0 : 1);
      if (size < bestSize) {
        best = i;
        bestSize = size;
      }
    }
    if (best < 0) break;
    const a = out[best] as Run;
    const b = out[best + 1] as Run;
    const main = b.end - b.start > a.end - a.start ? b : a;
    const other = main === a ? b : a;
    const hooks: Record<string, number> = { ...a.hooks };
    for (const [k, v] of Object.entries(b.hooks ?? {})) hooks[k] = (hooks[k] ?? 0) + v;
    const { host: _h, hooks: _k, ...rest } = main;
    out.splice(best, 2, {
      ...rest,
      start: a.start,
      end: b.end,
      count: (a.count ?? 1) + (b.count ?? 1),
      names: [...main.names, ...other.names],
      exported: a.exported + b.exported,
      ...(main.host !== undefined && (a.host === b.host || main.depth === 1) ? { host: main.host } : {}),
      ...(Object.keys(hooks).length > 0 ? { hooks } : {}),
    });
  }
  return out;
}

/** Body regions shown per big symbol. */
const MAX_BODY_REGIONS = 12;

/** The region outline of a file (empty below {@link REGION_MIN_LINES} lines, or without symbols). */
export function fileRegions(text: string, symbols: readonly SymbolEntry[], lang: SourceLang, minLines = REGION_MIN_LINES): FileRegion[] {
  const lines = text.split("\n");
  if (lines.length < minLines || symbols.length === 0) return [];
  const js = lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx";
  const out: Run[] = [];
  for (const r of coarsen(topRuns(symbols), MAX_REGIONS)) {
    out.push(r);
    if (!r.big) continue;
    // a JS function (a component): its statements — hooks are no symbols; a class / impl / anything else: its members
    const fn = js && (r.symbolKind === "function" || r.symbolKind === "const" || r.symbolKind === "method");
    const body = fn ? bodyRegions(lines, { start: r.start, end: r.end, name: r.host ?? r.names[0] ?? "" }) : memberRegions(symbols, r);
    out.push(...coarsen(body, MAX_BODY_REGIONS));
  }
  return out.map(({ exported, big: _big, ...r }) => ({
    ...r,
    names: [...new Set(r.names)].slice(0, NAMES),
    ...(r.depth === 0 && exported > 0 ? { exported } : {}),
  }));
}
