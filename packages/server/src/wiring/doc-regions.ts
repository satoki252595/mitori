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
/**
 * A field initialised with a function, from its declaration's first line: an arrow or `function`, possibly wrapped
 * (`= withBatchedUpdates(async () => {`, `= throttleRAF((e) => {`), or a bound method (`= this.x.bind(this)`).
 */
const FN_VALUE =
  /=\s*(?:[\w$.]+\s*(?:<[^>]*>)?\(\s*)?(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|=\s*(?:[\w$.]+\(\s*)?(?:async\s+)?function\b|=\s*(?:this\.)?[\w$.]+\.bind\(/;

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

/** The top-level declarations of a file, in source order (a Go method is top level though its receiver is its parent). */
function topLevel(syms: readonly SymbolEntry[]): SymbolEntry[] {
  // a Go method names its receiver as parent but is declared at the top level, outside the type's lines
  const byKey = new Map(syms.map((s) => [s.key, s]));
  const outside = (s: SymbolEntry) => {
    if (!s.parent) return true;
    const p = byKey.get(s.parent);
    return p === undefined || s.start > p.end || s.end < p.start;
  };
  return syms.filter((s) => s.kind !== "field" && s.kind !== "test" && outside(s)).sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Top-level runs: consecutive declarations of one kind (and receiver) form one region. */
function topRuns(top: readonly SymbolEntry[]): Run[] {
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
function memberRegions(syms: readonly SymbolEntry[], owner: Pick<Run, "start" | "end" | "host">, lines: readonly string[] = [], merge = true): Run[] {
  const kids = syms
    .filter((s) => (s.parent?.endsWith(`#${owner.host}`) || s.parent?.endsWith(`.${owner.host}`)) && s.start >= owner.start && s.end <= owner.end)
    .sort((a, b) => a.start - b.start);
  const out: Run[] = [];
  for (const s of kids) {
    // a field holding a function (`private onPointerUp = (e) => {…}` — excalidraw's App) is a method, not state; the
    // signature stops before the initializer, its first lines do not (parameters may wrap)
    const head = s.kind === "field" ? lines.slice(s.start - 1, Math.min(s.end, s.start + 3)).join(" ") : "";
    const fnField = s.kind === "field" && (FN_VALUE.test(s.signature) || FN_VALUE.test(head));
    const kind: FileRegion["kind"] =
      s.kind === "field" && !fnField ? "state" : HANDLER_NAME.test(s.name) ? "handlers" : FN_KINDS.has(s.kind) || fnField ? "methods" : "constants";
    const last = out[out.length - 1];
    if (merge && last && last.kind === kind) {
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
    const { host: _h, hooks: _k, title: _t, mix: _m, ...rest } = main;
    const title = [a.title, b.title].filter((t): t is string => t !== undefined).join("・");
    const mix: NonNullable<FileRegion["mix"]> = { ...a.mix };
    for (const [k, v] of Object.entries(b.mix ?? {}) as [FileRegion["kind"], number][]) mix[k] = (mix[k] ?? 0) + v;
    out.splice(best, 2, {
      ...rest,
      ...(title !== "" ? { title } : {}),
      ...(Object.keys(mix).length > 0 ? { mix } : {}),
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
/** Section headers kept per scope (crit's 11,000-line `web/app.js` keeps its 72; beyond, the smallest neighbours merge). */
const MAX_SECTIONS = 80;
/** Section headers are used when there are at least this many in a scope, at most this many lines apart on average. */
const MIN_SECTIONS = 3;
const SECTION_SPAN = 600;

/* ------------------------------------------------------------------ the authors' own section headers */

/** A section header the author wrote: its title and where (1-based line, indentation). */
export interface Banner {
  line: number;
  indent: number;
  title: string;
}

const RULE = "[=\\-─━*#~]";
/** `// ===== Title =====`, `/* ---------- title ---------- *\/`, `{/* ---- title ---- *\/}`, `# ==== Title ====`. */
const INLINE = new RegExp(`^(\\s*)(?:\\{\\s*)?(?:\\/\\/+|\\/\\*+|#+|--)\\s*${RULE}{2,}\\s+(.+?)\\s+${RULE}{2,}\\s*(?:\\*+\\/\\s*\\}?)?\\s*$`);
/** `// ----- Title` (a rule, then the title, nothing after). */
const LEADING = new RegExp(`^(\\s*)(?:\\/\\/+|#+)\\s*${RULE}{3,}\\s+([^=\\-─━*#~].*?)\\s*$`);
/** `// #region Title`, `#region Title`, `// MARK: - Title`, `#pragma mark - Title`. */
const MARK = /^(\s*)(?:\/\/\s*#?region\b[:\s]*|#region\b\s*|\/\/\s*MARK:\s*-?\s*|#pragma\s+mark\s+-?\s*)(.+?)\s*$/;
/** A comment line that is only a rule (`// -----------`, `/* ======== *\/`, ` * ********`). */
const RULE_LINE = new RegExp(`^\\s*(?:\\/\\/+|#+|\\/\\*+|\\*)\\s*${RULE}{8,}\\s*(?:\\*+\\/)?\\s*$`);
/** A one-line comment's text. */
const COMMENT_TEXT = /^\s*(?:\/\/+|#+|\*)\s*(.*?)\s*$/;
const indentOf = (l: string) => l.length - l.trimStart().length;
/** A title is words (a letter of any script), not code or another rule. */
const titleOk = (t: string) =>
  t.length > 0 && t.length <= 60 && /\p{L}/u.test(t) && !/[;{}]$/.test(t) && !/^(?:eslint|prettier|@ts-|biome|noqa|type:)/i.test(t);

/**
 * Section headers in `lines` (0-based `from` ≤ i < `to`): one-line banners, `#region` / `MARK:` markers, and boxed
 * ones (a rule line, one comment line of title, a rule line — excalidraw's `bucketFill.ts`).
 */
export function findBanners(lines: readonly string[], from = 0, to = lines.length): Banner[] {
  const out: Banner[] = [];
  for (let i = Math.max(0, from); i < Math.min(lines.length, to); i++) {
    const l = lines[i] as string;
    if (l.length > 200 || !/^\s*(?:\{\s*)?(?:\/\/|\/\*|#|--|\*)/.test(l)) continue;
    const m = INLINE.exec(l) ?? MARK.exec(l) ?? LEADING.exec(l);
    if (m) {
      const title = (m[2] as string).replace(/\s*\*+\/\s*\}?$/, "").trim();
      if (titleOk(title)) out.push({ line: i + 1, indent: (m[1] as string).length, title });
      continue;
    }
    if (RULE_LINE.test(l) && i + 2 < to && RULE_LINE.test(lines[i + 2] as string) && !RULE_LINE.test(lines[i + 1] as string)) {
      const title = COMMENT_TEXT.exec(lines[i + 1] as string)?.[1] ?? "";
      if (titleOk(title)) out.push({ line: i + 1, indent: indentOf(l), title });
      i += 2;
    }
  }
  return out;
}

/** The outermost headers of a scope when they structure it (≥ 3, sections ≤ 600 lines on average), else null. */
function denseBanners(bs: readonly Banner[], start: number, end: number): Banner[] | null {
  if (bs.length < MIN_SECTIONS) return null;
  const indent = Math.min(...bs.map((b) => b.indent));
  const top = bs.filter((b) => b.indent === indent);
  if (top.length < MIN_SECTIONS || (end - start + 1) / top.length > SECTION_SPAN) return null;
  return top;
}

/** The most frequent kind (ties: the first seen), and how many there were in all. */
function dominant(kinds: readonly FileRegion["kind"][]): FileRegion["kind"] | null {
  const n = new Map<FileRegion["kind"], number>();
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1);
  let best: FileRegion["kind"] | null = null;
  for (const [k, c] of n) if (best === null || c > (n.get(best) as number)) best = k;
  return best;
}

/**
 * One region per section, `[header, next header)`: titled by the author, kind = what most of its contents are
 * (`contents(start, end)` lists them), `section` when nothing in it is recognized.
 */
function sectionRuns(
  bs: readonly Banner[],
  end: number,
  depth: 0 | 1,
  contents: (start: number, end: number) => { kinds: FileRegion["kind"][]; names: string[]; exported?: number; hooks?: Record<string, number> },
  host?: string,
): Run[] {
  return bs.map((b, i) => {
    const stop = i + 1 < bs.length ? (bs[i + 1] as Banner).line - 1 : end;
    const c = contents(b.line, stop);
    const mix: NonNullable<FileRegion["mix"]> = {};
    for (const k of c.kinds) mix[k] = (mix[k] ?? 0) + 1;
    return {
      kind: dominant(c.kinds) ?? "section",
      title: b.title,
      ...(c.kinds.length > 0 ? { mix } : {}),
      start: b.line as LineNo,
      end: stop as LineNo,
      count: c.kinds.length,
      names: c.names,
      depth,
      exported: c.exported ?? 0,
      ...(host !== undefined ? { host } : {}),
      ...(c.hooks && Object.keys(c.hooks).length > 0 ? { hooks: c.hooks } : {}),
    };
  });
}

/** Statements of a JS function body in `[start, end]` at the body's indentation: their kinds, names, hooks. */
function statementsIn(lines: readonly string[], indent: number, start: number, end: number) {
  const kinds: FileRegion["kind"][] = [];
  const names: string[] = [];
  const hooks: Record<string, number> = {};
  for (let i = start - 1; i < end && i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trim() === "" || indentOf(l) !== indent) continue;
    const st = statementKind(l);
    if (!st) continue;
    kinds.push(st.kind);
    if (st.name) names.push(st.name);
    if (st.hook) hooks[st.hook] = (hooks[st.hook] ?? 0) + 1;
  }
  return { kinds, names, hooks };
}

/** The indentation of a body's first statement (0 when it has none). */
function bodyIndent(lines: readonly string[], s: Pick<SymbolEntry, "start" | "end">): number {
  for (let i = s.start; i < s.end && i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trim() === "" || /^\s*(\/\/|\*|\/\*|#)/.test(l)) continue;
    return indentOf(l);
  }
  return 0;
}

/**
 * A long Go / Python / other function's body by the comments that lead its blocks (a comment at the body's
 * indentation after a blank line, before code): ≥ 3 of them, else nothing (no guess about unnamed code).
 */
function commentBlocks(lines: readonly string[], s: Pick<SymbolEntry, "start" | "end" | "name">): Run[] {
  const indent = bodyIndent(lines, s);
  if (indent <= 0) return [];
  const leads: Banner[] = [];
  for (let i = s.start; i < s.end - 1 && i < lines.length; i++) {
    const l = lines[i] as string;
    if (indentOf(l) !== indent || !/^\s*(\/\/|#)(?!#)/.test(l)) continue;
    const prev = lines[i - 1] as string;
    if (prev.trim() !== "" && i !== s.start) continue;
    let j = i;
    while (j + 1 < s.end && /^\s*(\/\/|#)/.test(lines[j + 1] as string)) j++;
    const next = lines[j + 1] ?? "";
    if (next.trim() === "" || indentOf(next) !== indent) continue;
    const title = (COMMENT_TEXT.exec(l)?.[1] ?? "").replace(/[.:。]$/, "");
    if (titleOk(title)) leads.push({ line: i + 1, indent, title: title.length > 48 ? `${title.slice(0, 47)}…` : title });
    i = j;
  }
  const dense = denseBanners(leads, s.start, s.end);
  return dense ? sectionRuns(dense, s.end, 1, () => ({ kinds: [], names: [] }), s.name) : [];
}

/**
 * Inside a big symbol: the author's section headers when they structure its body (m3e's `Editor`: 「document」,
 * 「history」, 「pointer: parts」 …), each summarised by what it holds; else, for a JS function its statements (hooks,
 * effects, handlers, JSX), for a class / impl its members, for any other function the comments leading its blocks.
 */
function bodyOutline(lines: readonly string[], symbols: readonly SymbolEntry[], s: SymbolEntry, js: boolean): Run[] {
  const fn = js && (s.kind === "function" || s.kind === "const" || s.kind === "method");
  const indent = bodyIndent(lines, s);
  const sections = denseBanners(
    findBanners(lines, s.start, s.end - 1).filter((b) => b.indent >= indent),
    s.start,
    s.end,
  );
  if (sections) {
    const kids = memberRuns(symbols, s, lines);
    const head = sections[0] as Banner;
    const contents = fn
      ? (a: number, b: number) => statementsIn(lines, indent, a, b)
      : (a: number, b: number) => {
          const inside = kids.filter((k) => k.start >= a && k.start <= b);
          return { kinds: inside.map((k) => k.kind), names: inside.flatMap((k) => k.names) };
        };
    const runs = sectionRuns(sections, s.end - 1, 1, contents, s.name);
    // the statements before the first header (a component's first hooks) are a region of their own
    if (head.line - 1 > s.start + 2) {
      const c = contents(s.start + 1, head.line - 1);
      const k = dominant(c.kinds);
      if (k)
        runs.unshift({
          kind: k,
          start: (s.start + 1) as LineNo,
          end: (head.line - 1) as LineNo,
          count: c.kinds.length,
          names: c.names,
          depth: 1,
          host: s.name,
          exported: 0,
        });
    }
    return runs;
  }
  if (fn) return bodyRegions(lines, { start: s.start, end: s.end, name: s.name });
  const members = memberRegions(symbols, { start: s.start as LineNo, end: s.end as LineNo, host: s.name }, lines);
  return members.length > 0 ? members : commentBlocks(lines, s);
}

/** A class / impl's members as one run each (kind, range, name) — the contents of its sections. */
function memberRuns(symbols: readonly SymbolEntry[], s: SymbolEntry, lines: readonly string[]): Run[] {
  return memberRegions(symbols, { start: s.start as LineNo, end: s.end as LineNo, host: s.name }, lines, false);
}

/** The region outline of a file (empty below {@link REGION_MIN_LINES} lines, or without symbols). */
export function fileRegions(text: string, symbols: readonly SymbolEntry[], lang: SourceLang, minLines = REGION_MIN_LINES): FileRegion[] {
  const lines = text.split("\n");
  if (lines.length < minLines || symbols.length === 0) return [];
  const js = lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx";
  const top = topLevel(symbols);
  const bigs = top.filter((s) => s.end - s.start + 1 >= BODY_MIN_LINES && classOf(s) !== null);
  const out: Run[] = [];
  const pushBody = (s: SymbolEntry) => {
    const body = bodyOutline(lines, symbols, s, js);
    // the author's sections are kept (up to 80); unnamed runs coarsen to one per ~300 lines, 12–24
    const cap = Math.min(MAX_BODY_REGIONS * 2, Math.max(MAX_BODY_REGIONS, Math.round((s.end - s.start) / 300)));
    out.push(...coarsen(body, body.some((r) => r.title !== undefined) ? MAX_SECTIONS : cap));
  };
  // the author's own sections, when the file has them (crit's `web/app.js`: 72 「===== Comment Form =====」 headers
  // over 11,000 lines of functions that a symbol run calls 「関数（152）」)
  const outside = findBanners(lines).filter((b) => !bigs.some((s) => b.line > s.start && b.line < s.end));
  const sections = denseBanners(outside, 1, lines.length);
  if (sections) {
    const first = (sections[0] as Banner).line;
    const head = coarsen(topRuns(top.filter((s) => s.start < first)), 6);
    const runs = coarsen(
      sectionRuns(sections, lines.length, 0, (a, b) => {
        const inside = top.filter((s) => s.start >= a && s.start <= b);
        const kinds = inside.map((s) => classOf(s)?.kind).filter((k): k is FileRegion["kind"] => k !== undefined);
        return { kinds, names: inside.map((s) => s.name), exported: inside.filter((s) => s.exported).length };
      }),
      MAX_SECTIONS,
    );
    for (const r of [...head, ...runs]) {
      out.push(r);
      // a big declaration inside a section: its body after the section (a head run is the declaration itself)
      for (const s of bigs)
        if (s.start >= r.start && s.start <= r.end) {
          // inside a section, the declaration is named before its body (the body regions belong to it)
          if (!r.big) out.push(...topRuns([s]));
          pushBody(s);
        }
    }
  } else
    for (const r of coarsen(topRuns(top), MAX_REGIONS)) {
      out.push(r);
      const s = r.big ? bigs.find((x) => x.start === r.start) : undefined;
      if (s) pushBody(s);
    }
  return out.map(({ exported, big: _big, ...r }) => ({
    ...r,
    names: [...new Set(r.names)].slice(0, NAMES),
    ...(r.depth === 0 && exported > 0 ? { exported } : {}),
  }));
}
