import type { FileEntry, LineNo, RepoPath, SymbolEntry, SymbolKind } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import { BUNDLE_LIMITS } from "../contract.ts";
import { readableFile } from "../router/scope.ts";

/** What REL needs from the index. */
export type RelIndexer = Pick<Indexer, "symbols" | "imports" | "dependents" | "file" | "currentText">;

/** One related symbol (a REL block). */
export interface RelEntry {
  /** Chip key `related:<path>:<line>`. */
  key: string;
  path: RepoPath;
  line: LineNo;
  /** Qualified name of the related symbol. */
  sym: string;
  /** `calledby`: the anchor's symbol calls it; `calls`: it calls the anchor's symbol. */
  relation: { kind: "calls" | "calledby"; name: string };
  /** One-line signature. */
  signature: string;
  /** Sort weight (higher first). */
  weight: number;
}

/** An anchored range with its enclosing symbol and the text of the anchored lines. */
export interface RelAnchor {
  path: RepoPath;
  start: LineNo;
  end: LineNo;
  sym: SymbolEntry | null;
  text: string;
}

const CALLABLE: ReadonlySet<SymbolKind> = new Set(["function", "method", "constructor", "class", "struct", "interface", "trait", "type", "enum", "macro"]);
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/gu;
const MAX_FILE_LINES = 5000;
const MAX_READS = 6;
const CROSS_FILE_DEPENDENTS = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** At most this many contained symbols stand for an anchor that spans several. */
const CONTAINED_MAX = 3;

/**
 * The symbols an anchored range stands for: the enclosing symbol, or — when the range spans several definitions —
 * the largest (≤ 3) callable symbols it contains. `textOf` reads anchored lines already loaded for CODE.
 */
export function relAnchorsOf(
  ix: Pick<Indexer, "symbols">,
  path: RepoPath,
  a: { start: LineNo; end: LineNo },
  enclosing: SymbolEntry | null,
  textOf: (start: LineNo, end: LineNo) => string,
): RelAnchor[] {
  if (enclosing) return [{ path, start: a.start, end: a.end, sym: enclosing, text: textOf(a.start, a.end) }];
  return ix
    .symbols(path)
    .filter((t) => CALLABLE.has(t.kind) && t.start >= a.start && t.end <= a.end)
    .sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start)
    .slice(0, CONTAINED_MAX)
    .map((t) => ({ path, start: t.start, end: t.end, sym: t, text: textOf(t.start, t.end) }));
}

/**
 * REL candidates from the index (spec §4.3). CR-PENDING(WP-08a): the indexer exposes no symbol-level call edges, so
 * this derives them: callees = defined or imported symbols named in the anchored text; callers = symbols (same
 * file, and the top dependents' files) whose body mentions the anchor's symbol. Weight = occurrences (+ file edge
 * weight for callers). Entries already visible in `shown` are skipped. At most `relMax`.
 */
export async function findRelated(
  ix: RelIndexer,
  anchors: readonly RelAnchor[],
  opts: { denied(path: RepoPath): boolean; shown(path: RepoPath, line: LineNo): boolean },
): Promise<RelEntry[]> {
  const found = new Map<string, RelEntry>();
  const lineCache = new Map<RepoPath, string[] | null>();
  let reads = 0;
  const linesOf = async (path: RepoPath): Promise<string[] | null> => {
    if (lineCache.has(path)) return lineCache.get(path) ?? null;
    const f: FileEntry | null = ix.file(path);
    let lines: string[] | null = null;
    if (readableFile(f) && (f as FileEntry).lines <= MAX_FILE_LINES && reads < MAX_READS && !opts.denied(path)) {
      reads++;
      // Only counted, never put into the bundle: the raw text is enough (no secret scan of whole files per build).
      lines = (await ix.currentText(path))?.split("\n") ?? null;
    }
    lineCache.set(path, lines);
    return lines;
  };
  const add = (e: Omit<RelEntry, "key" | "signature">, sym: SymbolEntry) => {
    if (opts.denied(e.path) || opts.shown(e.path, e.line)) return;
    const key = `related:${e.path}:${e.line}`;
    const prev = found.get(key);
    if (prev) prev.weight = Math.max(prev.weight, e.weight);
    else found.set(key, { ...e, key, signature: sym.signature });
  };

  for (const a of anchors) {
    const s = a.sym;
    if (!s) continue;
    const idents = new Map<string, number>();
    for (const m of a.text.matchAll(IDENT)) idents.set(m[0], (idents.get(m[0]) ?? 0) + 1);

    const contains = (t: SymbolEntry) => t.start <= s.start && t.end >= s.end;
    const own = ix.symbols(a.path).filter((t) => t.key !== s.key && !contains(t) && CALLABLE.has(t.kind));

    // callees: defined in the same file …
    for (const t of own) {
      const n = idents.get(t.name);
      if (n) add({ path: t.path, line: t.start, sym: t.qualname, relation: { kind: "calledby", name: s.qualname }, weight: n + 0.5 }, t);
    }
    // … or imported from another file
    for (const imp of ix.imports(a.path)) {
      for (const target of imp.to.slice(0, 3)) {
        for (const t of ix.symbols(target)) {
          if (!t.exported || !CALLABLE.has(t.kind) || (imp.names.length > 0 && !imp.names.includes(t.name))) continue;
          const n = idents.get(t.name);
          if (n) add({ path: t.path, line: t.start, sym: t.qualname, relation: { kind: "calledby", name: s.qualname }, weight: n }, t);
        }
      }
    }

    // callers: same file …
    const word = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(s.name)}(?![A-Za-z0-9_])`, "gu");
    const mentions = (lines: string[], t: SymbolEntry): number => {
      const body = lines.slice(t.start - 1, t.end).join("\n");
      return body.match(word)?.length ?? 0;
    };
    const mine = await linesOf(a.path);
    if (mine) {
      for (const t of own) {
        const n = mentions(mine, t);
        if (n) add({ path: t.path, line: t.start, sym: t.qualname, relation: { kind: "calls", name: s.qualname }, weight: n }, t);
      }
    }
    // … and in the files that depend on this one
    const deps = [...ix.dependents(a.path)].sort((x, y) => y.weight - x.weight).slice(0, CROSS_FILE_DEPENDENTS);
    for (const d of deps) {
      const lines = await linesOf(d.path);
      if (!lines) continue;
      for (const t of ix.symbols(d.path)) {
        if (!CALLABLE.has(t.kind)) continue;
        const n = mentions(lines, t);
        if (n) add({ path: t.path, line: t.start, sym: t.qualname, relation: { kind: "calls", name: s.qualname }, weight: n + d.weight }, t);
      }
    }
  }
  return [...found.values()]
    .sort((x, y) => y.weight - x.weight || (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line))
    .slice(0, BUNDLE_LIMITS.relMax);
}
