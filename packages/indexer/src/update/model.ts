// In-memory index model: one FileRec per path (S0 state) and one Parsed per content key (S1 output, shared by every
// path with the same blob × extractor), plus the conversions to the public shapes.
import type {
  ExcludeReason,
  ExtractorVersion,
  FileClass,
  FileEntry,
  GitOid,
  LineNo,
  ModuleId,
  RepoPath,
  SourceLang,
  SymbolEntry,
  SymbolKey,
} from "@mitori/core";
import type { FactCandidate, FileDetail, FileScope, GrammarId, ImportRecord, InventoryRuleId, RefRecord, SymbolDetail } from "../contract.ts";
import type { LinguistAttrs } from "../inventory/classify.ts";
import { firstParagraph } from "../parse/text.ts";
import type { SkeletonBodies } from "../skeleton/render.ts";

/** S0 state of one path. */
export interface FileRec {
  path: RepoPath;
  /** On-disk spelling (differs from `path` for NFD names). */
  raw: string;
  /** Blob of the worktree content ("" when never hashed: excluded untracked files). */
  blob: GitOid;
  /** Blob in the git index (tracked files), "" otherwise. */
  indexBlob: GitOid;
  mode: string;
  size: number;
  mtimeNs: bigint;
  ino: bigint;
  racy: boolean;
  tracked: boolean;
  dirty: boolean;
  lang: SourceLang;
  grammar: GrammarId | null;
  dialect: string | null;
  class: FileClass;
  excluded?: ExcludeReason;
  scope: FileScope;
  rule: InventoryRuleId;
  attrs: LinguistAttrs;
  /** R03 include matched (content rules skipped). */
  include: boolean;
  /** Cache key of the S1 output (`<extractor>[/lite]` / `text@…`), when parsed. */
  key?: string;
  extractor?: ExtractorVersion;
  note?: FileDetail["note"];
  lines: number;
  loc: number;
  chars: number;
  cjk: number;
  tokensEst: number;
  /** Scan generation that last saw the path. */
  seen: number;
}

/** A stored symbol (path-independent: the parent is an ordinal). */
export type StoredSymbol = Omit<SymbolDetail, "path" | "blob" | "key" | "parent"> & { parentOrd?: number };

/** S1 output of one content key. */
export interface Parsed {
  blob: GitOid;
  key: string;
  extractor: ExtractorVersion | null;
  lang: SourceLang;
  grammar: GrammarId | null;
  /** Content rule class when R11–R13 excluded the file. */
  contentClass?: "binary" | "minified" | "generated";
  contentRule?: InventoryRuleId;
  bytes: number;
  lines: number;
  loc: number;
  cjk: number;
  chars: number;
  errors: number;
  note?: "parse_timeout" | "parse_error" | "degraded";
  symbols: StoredSymbol[];
  imports: ImportRecord[];
  refs: RefRecord[];
  tests: { name: string; line: LineNo }[];
  facts: FactCandidate[];
  headings?: { level: number; line: LineNo; text: string }[];
  rationale: { start: LineNo; end: LineNo }[];
  /** Skeleton bodies; `null` once persisted and evicted (read back from `idx_skeleton`). */
  skeleton?: SkeletonBodies | null;
  /** Not yet written to SQLite. */
  dirtyDb: boolean;
}

export const contentKey = (blob: GitOid, key: string): string => `${blob}\0${key}`;

/** Public FileEntry of a record. */
export function toFileEntry(r: FileRec, module?: string): FileEntry {
  const e: FileEntry = { path: r.path, blob: r.blob, size: r.size, lang: r.lang, class: r.class, lines: r.lines, loc: r.loc, tokensEst: r.tokensEst };
  if (r.excluded !== undefined) e.excluded = r.excluded;
  if (module !== undefined) e.module = module as ModuleId;
  return e;
}

/** FileDetail of a record. */
export function toFileDetail(r: FileRec, module?: string): FileDetail {
  const d: FileDetail = { ...toFileEntry(r, module), scope: r.scope, grammar: r.grammar, dialect: r.dialect, rule: r.rule, tracked: r.tracked, dirty: r.dirty };
  if (r.excluded !== undefined) d.excludedExt = r.excluded;
  if (r.note !== undefined) d.note = r.note;
  if (r.extractor !== undefined) d.extractor = r.extractor;
  return d;
}

const LITERALISH = /["'`=]/;

/** Symbols of a path bound to its blob (`redact` = secret scanner for signature literals and the doc, or identity). */
export function bindSymbols(
  path: RepoPath,
  blob: GitOid,
  syms: readonly StoredSymbol[],
  redact: (s: string) => string,
): { entries: SymbolEntry[]; details: SymbolDetail[] } {
  const keyOf = (q: string): SymbolKey => `${path}#${q}`;
  const entries: SymbolEntry[] = [];
  const details: SymbolDetail[] = [];
  for (const s of syms) {
    const { parentOrd, doc, ...rest } = s;
    const parentQ = parentOrd === undefined ? undefined : syms[parentOrd]?.qualname;
    const base: SymbolEntry = {
      key: keyOf(s.qualname),
      path,
      blob,
      kind: s.kind,
      name: s.name,
      qualname: s.qualname,
      start: s.start,
      end: s.end,
      // Literals in a signature (parameter defaults) can carry secrets; only those are worth a scan.
      signature: LITERALISH.test(s.signature) ? redact(s.signature) : s.signature,
      sigHash: s.sigHash,
      bodyHash: s.bodyHash,
      exported: s.exported,
    };
    if (parentQ !== undefined) base.parent = keyOf(parentQ);
    const entry: SymbolEntry = { ...base };
    if (doc !== undefined && doc !== "") entry.doc = redact(firstParagraph(doc));
    const detail: SymbolDetail = { ...rest, ...base };
    if (doc !== undefined && doc !== "") detail.doc = redact(doc);
    entries.push(entry);
    details.push(detail);
  }
  return { entries, details };
}

/** Worker symbol (parent `<path>#<qualname>`) → stored symbol (parent ordinal). */
export function storeSymbols(path: RepoPath, syms: readonly Omit<SymbolDetail, "path" | "blob" | "key">[]): StoredSymbol[] {
  const byQual = new Map<string, number>();
  for (const s of syms) byQual.set(s.qualname, s.ord);
  const prefix = `${path}#`;
  return syms.map((s) => {
    const { parent, ...rest } = s;
    const out: StoredSymbol = rest;
    if (parent !== undefined) {
      const q = parent.startsWith(prefix) ? parent.slice(prefix.length) : parent.slice(parent.indexOf("#") + 1);
      const ord = byQual.get(q);
      if (ord !== undefined) out.parentOrd = ord;
    }
    return out;
  });
}
