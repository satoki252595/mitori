// NC-10 §7 「主要な型」 (newcomer audit: §7 had DB schemas only, a TS / Go repo showed 「検出されませんでした」): the
// exported data types a reader meets everywhere, from the index alone (0 tokens). A type is in when it is a data
// shape (struct / interface / class with fields, enum, type alias another key type holds); it ranks by how many files
// use it (the index's references through the imports — not the importers of its file, which gave every type of one
// file the same count and buried m3e's `Kind` under small aliases) and how many key types hold it in a field.
// Relations come from the field declarations (`Comments []Comment`, `items: Item[]`, `owner: User | null`; a callback
// field holds nothing), so the table and the drawing say what holds what.
import type { LineNo, ModuleId, RepoPath, SymbolEntry } from "@mitori/core";
import type { StaticKeyType } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";

const DATA_KINDS = new Set(["struct", "interface", "class", "type", "enum", "trait"]);
/** Types the table shows (the drawing keeps the ones with a relation). */
export const KEY_TYPES_MAX = 12;
/** Field types beyond these are not followed (a 300-field config struct says little per field). */
const FIELDS_SCANNED = 80;
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|e2e|testdata|fixtures?)\/|[._-](test|spec)\.[A-Za-z0-9]+$|_test\.go$/;

export type TypesIndexer = Pick<Indexer, "files" | "symbols" | "imports" | "moduleOf"> & Partial<Pick<Indexer, "symbolUsers">>;

interface Cand {
  sym: SymbolEntry;
  fields: SymbolEntry[];
  /** Files that use the type (the index's references), else the importers of its file. */
  fanIn: number;
}

/**
 * Distinct importing files of every file, in one pass over the resolved imports (`dependents(p)` per file is a scan
 * of the whole graph: N² on a 7k-file repo). A Go package import counts for each file of the package.
 */
export function importFanIn(ix: Pick<Indexer, "files" | "imports">): Map<RepoPath, number> {
  const by = new Map<RepoPath, Set<RepoPath>>();
  for (const f of ix.files()) {
    if (f.excluded !== undefined || f.class !== "source") continue;
    for (const imp of ix.imports(f.path))
      for (const to of imp.to) {
        if (to === f.path) continue;
        let s = by.get(to);
        if (!s) {
          s = new Set();
          by.set(to, s);
        }
        s.add(f.path);
      }
  }
  return new Map([...by].map(([p, s]) => [p, s.size]));
}

/** The key data types of the repo with their field relations (§7, NC-10). */
export function keyTypes(
  ix: TypesIndexer,
  max = KEY_TYPES_MAX,
  fanInOf: ReadonlyMap<RepoPath, number> = ix.symbolUsers ? new Map() : importFanIn(ix),
): StaticKeyType[] {
  const files = ix.files().filter((f) => f.class === "source" && f.excluded === undefined && !TEST_PATH.test(f.path) && !f.path.endsWith(".d.ts"));
  const cands: Cand[] = [];
  for (const f of files) {
    const syms = ix.symbols(f.path);
    const fieldsOf = new Map<string, SymbolEntry[]>();
    for (const s of syms) if (s.kind === "field" && s.parent) fieldsOf.set(s.parent, [...(fieldsOf.get(s.parent) ?? []), s]);
    for (const s of syms) {
      if (s.parent || !s.exported || !DATA_KINDS.has(s.kind)) continue;
      const fields = fieldsOf.get(s.key) ?? [];
      // a class with no fields is a service, not data; an alias with no fields counts only when another type holds it
      if (s.kind === "class" && fields.length < 2) continue;
      cands.push({ sym: s, fields, fanIn: fanInOf.get(f.path) ?? 0 });
    }
  }
  if (cands.length === 0) return [];
  // the files that use each type, when the index can say (one pass over its references)
  const users = ix.symbolUsers?.(cands.map((c) => c.sym.key));
  if (users) for (const c of cands) c.fanIn = users.get(c.sym.key) ?? 0;
  // name → candidates (same file, then same directory, then unique in the repo)
  const byName = new Map<string, Cand[]>();
  for (const c of cands) byName.set(c.sym.name, [...(byName.get(c.sym.name) ?? []), c]);
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const resolve = (name: string, from: Cand): Cand | null => {
    const list = byName.get(name);
    if (!list || list.length === 0) return null;
    return (
      list.find((c) => c.sym.path === from.sym.path) ??
      list.find((c) => dirOf(c.sym.path) === dirOf(from.sym.path)) ??
      (list.length === 1 ? (list[0] as Cand) : null)
    );
  };
  const refs = new Map<Cand, { to: Cand; field: string }[]>();
  const heldBy = new Map<Cand, number>();
  for (const c of cands) {
    const out: { to: Cand; field: string }[] = [];
    const seen = new Set<Cand>();
    for (const f of c.fields.slice(0, FIELDS_SCANNED)) {
      const type = fieldType(f);
      // a callback field (`onChange: (els: Element[]) => void`, `Hook func(*Session)`) holds none of its parameters
      if (/=>|^\(?\s*func\s*\(/.test(type)) continue;
      for (const m of type.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
        const to = resolve(m[0], c);
        if (!to || to === c || seen.has(to)) continue;
        seen.add(to);
        out.push({ to, field: f.name });
        heldBy.set(to, (heldBy.get(to) ?? 0) + 1);
      }
    }
    refs.set(c, out);
  }
  // used across the repo, held by other key types, and big aggregates (crit's 40-field `Session`) over small aliases
  const score = (c: Cand) => c.fanIn + 3 * (heldBy.get(c) ?? 0) + Math.min(c.fields.length, 30) * 0.3;
  const eligible = cands.filter((c) => c.fields.length > 0 || c.sym.kind === "enum" || (heldBy.get(c) ?? 0) > 0);
  const ranked = [...eligible].sort((a, b) => score(b) - score(a) || (a.sym.path < b.sym.path ? -1 : a.sym.path > b.sym.path ? 1 : a.sym.start - b.sym.start));
  const top = ranked.filter((c) => score(c) > 0).slice(0, max);
  const shown = new Set(top);
  return top.map((c) => {
    const module = ix.moduleOf(c.sym.path);
    return {
      name: c.sym.name,
      kind: c.sym.kind,
      path: c.sym.path,
      line: c.sym.start as LineNo,
      end: c.sym.end as LineNo,
      ...(module ? { module: module as ModuleId } : {}),
      fields: c.fields.length,
      refs: (refs.get(c) ?? []).filter((r) => shown.has(r.to)).map((r) => ({ name: r.to.sym.name, field: r.field })),
      usedBy: c.fanIn,
    };
  });
}

/** The type part of a field declaration (`Comments []Comment \`json:"c"\`` → `[]Comment`, `items?: Item[];` → `Item[]`). */
export function fieldType(f: Pick<SymbolEntry, "name" | "signature">): string {
  const sig = f.signature.replace(/`[^`]*`/g, "").replace(/\/\/.*$|#.*$/, "");
  const at = sig.indexOf(f.name);
  const rest = at >= 0 ? sig.slice(at + f.name.length) : sig;
  // TS / Python / Rust `name: Type`, Go `Name Type`, default values dropped
  return rest
    .replace(/^\s*[?!]?\s*:?/, "")
    .replace(/\s*=(?!>).*$/, "")
    .trim();
}
