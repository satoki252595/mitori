// Code targets of a Fix on a doc anchor (`POST /ws/:ws/jobs/targets`, CR ux-F1): which code would the AI change for a
// comment on a design-doc sentence — asked BEFORE the estimate, so the user never needs to know file names.
//
//   cited       the cites of the anchored claim (else of the block's claims): exactly the ranges the router turns into
//               the write scope (loop spec §3.2), so the Composer shows them as 「対象コード」 and the estimate agrees.
//   candidates  never in the scope by themselves — the user confirms one (it is then sent as `ContextAdjust.add`):
//                 1. `ref`    code references written in the selected row / item of the block (static facts tables:
//                             `internal/config/config.go:36`, `server.go#Server.listBooks`);
//                 2. `symbol` symbols the selection or the request names exactly (`Fetch`, `Client.fetchOnce`);
//                 3. `search` full-text hits (facts, symbols) of the same terms (`TSUNDOKU_API_TOKEN` → the env fact).
//
// Deterministic and token-free: same index + doc + input ⇒ same answer. Pure over the ports (no I/O of its own).
import type { Anchor, Cite, CodeTarget, CodeTargets, ExcludeReason, FileEntry, Glob, LineNo, RepoPath, SearchHit, SymbolEntry } from "@mitori/core";
import { parseRepoPath } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { pathMatcher } from "../router/deny.ts";
import { anchorRanges, mergeRanges } from "../router/ranges.ts";

/** Ports. */
export interface TargetDeps {
  doc: Pick<DocStore, "block" | "blockText" | "claims">;
  indexer: Pick<Indexer, "file" | "enclosingSymbol" | "symbols" | "symbol" | "findSymbols" | "search">;
  /** Deny globs of the workspace (`EffectiveSettings.denyGlobs`). */
  deny: readonly Glob[];
}

export interface TargetInput {
  /** The captured anchor (claim bound by the anchor engine). */
  anchor: Anchor;
  /** Selection offsets in the block text (ANCHOR_TEXT_RULES); `[0, len)` = the whole block. */
  selStart?: number;
  selEnd?: number;
  /** The request typed so far. */
  text?: string;
  /** Candidates wanted. */
  limit?: number;
}

export const TARGET_LIMITS = {
  /** Default / maximum number of candidates. */
  candidates: 4,
  candidatesMax: 8,
  /** A `path:line` reference widens to its enclosing symbol up to this size, else ± `lineContext`. */
  symbolMaxLines: 80,
  lineContext: 6,
  /** A bare file reference becomes the whole file only up to this size. */
  wholeFileMaxLines: 300,
  /** Terms taken from the selection + request, and hits per term. */
  terms: 6,
  hitsPerTerm: 4,
  /** Request text considered (characters). */
  textChars: 600,
  /** A selection up to this long is taken as a name to look up (longer is prose). */
  selectionNameChars: 80,
} as const;

/** Files a Fix can never write (router UNWRITABLE, loop spec §3.3). */
const UNWRITABLE: ReadonlySet<ExcludeReason> = new Set(["binary", "secret", "deny_glob", "special", "oversize", "minified", "data_large", "gitignored"]);

/** English words and keywords that are never worth a symbol lookup. */
const STOP = new Set(
  "the and for with this that from into when then than what which where while have has had are was were will would should could can not but use uses used make makes made add adds set sets get gets new old all any each one two why how its our your their also only just like more most less some such very fix change code file line func return var const type struct true false nil null none todo".split(
    " ",
  ),
);

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
const CJK_RUN = /[\p{Script=Han}\p{Script=Katakana}ー]{3,}/gu;
/** A code span / link target that names a repository path, optionally with `:a[-b]` or `#Qual.name`. */
const REF = /^(?<path>[A-Za-z0-9_.\-/]+?)(?::(?<a>\d+)(?:[-–](?<b>\d+))?|#(?<sym>[A-Za-z_][\w.]*))?$/;

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const labelOf = (path: RepoPath, start: LineNo, end: LineNo) => `${basename(path)}:${start}${end !== start ? `-${end}` : ""}`;
const overlaps = (a: { path: RepoPath; start: LineNo; end: LineNo }, b: { path: RepoPath; start: LineNo; end: LineNo }) =>
  a.path === b.path && a.start <= b.end && b.start <= a.end;

/** Markdown line → the plain text a reader sees (code marks, table pipes, link targets and emphasis removed). */
export function mdPlain(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]|~~/g, "")
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Code spans and link targets of one Markdown line, in order. */
export function refsOf(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/`([^`\n]+)`|\]\(([^)\s]+)\)/g)) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    // `path#L10-L20` (GitHub-style link) ⇒ `path:10-20`
    const gh = /^(.+?)#L(\d+)(?:-L(\d+))?$/.exec(raw);
    out.push(gh ? `${gh[1]}:${gh[2]}${gh[3] ? `-${gh[3]}` : ""}` : raw);
  }
  return out;
}

/**
 * The Markdown lines the selection lies on: the k-th line containing the selected text, where k counts the earlier
 * occurrences of that text in the block text (the same text twice in a table resolves to the right row). A whole-block
 * selection is every line. When the text spans lines, the lines sharing its longest word.
 */
export function selectedLines(md: string, blockText: string, selStart: number, selEnd: number): string[] {
  const lines = md.split("\n");
  const exact = blockText.slice(selStart, selEnd).trim();
  if (exact === "" || (selStart <= 0 && selEnd >= blockText.length)) return lines;
  let k = 0;
  for (let at = blockText.indexOf(exact); at >= 0 && at < selStart; at = blockText.indexOf(exact, at + exact.length)) k++;
  const hits: number[] = [];
  lines.forEach((l, i) => {
    const plain = mdPlain(l);
    for (let at = plain.indexOf(exact); at >= 0; at = plain.indexOf(exact, at + exact.length)) hits.push(i);
  });
  if (hits.length > 0) return [lines[hits[Math.min(k, hits.length - 1)] as number] as string];
  const word = [...exact.split(/\s+/)].sort((a, b) => b.length - a.length)[0] ?? "";
  if (word.length < 3) return [];
  return lines.filter((l) => mdPlain(l).includes(word));
}

/** Identifier and CJK terms of the selection, then of the request (deduplicated, stop words dropped). */
export function termsOf(selection: string, text: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (t.length < 3 || STOP.has(t.toLowerCase()) || /^\d/.test(t) || out.includes(t)) return;
    out.push(t);
  };
  for (const src of [selection, text.slice(0, TARGET_LIMITS.textChars)]) {
    for (const m of src.matchAll(IDENT)) add(m[0]);
    for (const m of src.matchAll(CJK_RUN)) {
      add(m[0]);
      if (m[0].length > 3) add(m[0].slice(0, 3));
    }
  }
  return out.slice(0, TARGET_LIMITS.terms);
}

export function resolveCodeTargets(deps: TargetDeps, input: TargetInput): CodeTargets {
  const denied = pathMatcher(deps.deny);
  const limit = Math.max(1, Math.min(input.limit ?? TARGET_LIMITS.candidates, TARGET_LIMITS.candidatesMax));
  const usable = (path: string): FileEntry | null => {
    const p = parseRepoPath(path);
    if (!p.ok || denied(p.value)) return null;
    const f = deps.indexer.file(p.value);
    return f && !(f.excluded !== undefined && UNWRITABLE.has(f.excluded)) ? f : null;
  };
  const make = (f: FileEntry, start: LineNo, end: LineNo, source: CodeTarget["source"], match?: string): CodeTarget => {
    const s = Math.max(1, Math.min(start, f.lines));
    const e = Math.max(s, Math.min(end, f.lines));
    const sym = deps.indexer.enclosingSymbol(f.path, s, e);
    const t: CodeTarget = {
      path: f.path,
      start: s,
      end: e,
      label: labelOf(f.path, s, e),
      source,
      tokens: Math.max(1, Math.round((f.tokensEst * (e - s + 1)) / Math.max(1, f.lines))),
    };
    if (sym && sym.start <= s && sym.end >= e) t.symbol = sym.qualname;
    if (match !== undefined) t.match = match;
    return t;
  };
  /** A line widened to its enclosing symbol (small enough), else a few lines around it. */
  const aroundLine = (f: FileEntry, line: LineNo, source: CodeTarget["source"], match?: string): CodeTarget => {
    const sym = deps.indexer.enclosingSymbol(f.path, line, line);
    if (sym && sym.end - sym.start + 1 <= TARGET_LIMITS.symbolMaxLines) return make(f, sym.start, sym.end, source, match);
    return make(f, line - TARGET_LIMITS.lineContext, line + TARGET_LIMITS.lineContext, source, match);
  };
  const ofSymbol = (s: SymbolEntry, source: CodeTarget["source"], match?: string): CodeTarget | null => {
    const f = usable(s.path);
    return f ? make(f, s.start, s.end, source, match) : null;
  };

  // --- cited: the router's own ranges for this anchor (claim cites, else the block's) ---------------------------
  const cites = (block: string): Cite[] => deps.doc.claims(block as never).flatMap((c) => c.cites);
  const ranges = mergeRanges(
    anchorRanges(input.anchor, {
      citesOfBlock: cites,
      citesOfClaim: (claim) => deps.doc.claims((input.anchor.doc?.block ?? "") as never).find((c) => c.id === claim)?.cites ?? [],
    }),
  );
  const cited: CodeTarget[] = [];
  for (const r of ranges) {
    const f = usable(r.path);
    if (f) cited.push(make(f, r.start, r.end, "cite"));
  }

  // --- candidates ---------------------------------------------------------------------------------------------------
  const found: CodeTarget[] = [];
  const offer = (t: CodeTarget | null) => {
    if (!t) return;
    if (cited.some((c) => overlaps(c, t)) || found.some((c) => overlaps(c, t))) return;
    found.push(t);
  };
  const block = input.anchor.doc ? deps.doc.block(input.anchor.doc.block) : null;
  const blockText = input.anchor.doc ? (deps.doc.blockText(input.anchor.doc.block) ?? "") : "";
  const selStart = Math.max(0, Math.min(input.selStart ?? 0, blockText.length));
  const selEnd = Math.max(selStart, Math.min(input.selEnd ?? blockText.length, blockText.length));
  const selection = blockText.slice(selStart, selEnd);

  // 1. code references in the selected row / item
  if (block) {
    for (const line of selectedLines(block.md, blockText, selStart, selEnd))
      for (const raw of refsOf(line)) {
        const m = REF.exec(raw);
        const g = m?.groups;
        if (!g?.path) continue;
        const f = usable(g.path);
        if (!f) continue;
        if (g.sym) {
          const s = deps.indexer.symbols(f.path).find((x) => x.qualname === g.sym || x.name === g.sym);
          offer(s ? make(f, s.start, s.end, "ref", raw) : null);
        } else if (g.a) {
          const a = Number(g.a);
          offer(g.b ? make(f, a, Number(g.b), "ref", raw) : aroundLine(f, a, "ref", raw));
        } else if (f.lines <= TARGET_LIMITS.wholeFileMaxLines) offer(make(f, 1, f.lines, "ref", raw));
      }
  }

  // 2. symbols named exactly, 3. full-text hits — selection terms first, then the request's
  // a short selection names something (`TSUNDOKU_API_TOKEN`); a whole block / long passage is prose, not a name
  const wholeBlock = selStart === 0 && selEnd >= blockText.length;
  const named = !wholeBlock && selection.length <= TARGET_LIMITS.selectionNameChars ? selection : "";
  const terms = termsOf(named, input.text ?? "");
  for (const term of terms) {
    if (!/^[A-Za-z_]/.test(term)) continue;
    const want = term.toLowerCase();
    // `Client.Fetch`: the symbol search matches names, so ask for the last part and compare the qualname
    const query = term.includes(".") ? (term.split(".").pop() as string) : term;
    for (const s of deps.indexer.findSymbols(query, TARGET_LIMITS.hitsPerTerm))
      if (s.name.toLowerCase() === want || s.qualname.toLowerCase() === want) offer(ofSymbol(s, "symbol", term));
  }
  for (const term of terms) for (const h of deps.indexer.search(term, ["fact", "symbol"], TARGET_LIMITS.hitsPerTerm)) offer(fromHit(h, term));

  function fromHit(h: SearchHit, term: string): CodeTarget | null {
    if (h.kind === "symbol") {
      const s = deps.indexer.symbol(h.id as never);
      return s ? ofSymbol(s, "search", term) : null;
    }
    const m = /^(.*):(\d+)$/.exec(h.sub ?? "");
    if (!m) return null;
    const f = usable(m[1] as string);
    return f ? aroundLine(f, Number(m[2]), "search", term) : null;
  }

  // by evidence (the row's own reference > an exact name > a text match); inside a tier, distinct files first
  const out: CodeTarget[] = [];
  for (const tier of ["ref", "symbol", "search"] as const) {
    const of = found.filter((t) => t.source === tier);
    const first = of.filter((t, i) => of.findIndex((x) => x.path === t.path) === i);
    out.push(...first, ...of.filter((t) => !first.includes(t)));
  }
  return { cited, candidates: out.slice(0, limit) };
}
