// Code targets of a Fix on a doc anchor (`POST /ws/:ws/jobs/targets`, CR ux-F1): which code would the AI change for a
// comment on a design-doc sentence — asked BEFORE the estimate, so the user never needs to know file names.
//
//   cited       the cites of the anchored claim (else of the block's claims): exactly the ranges the router turns into
//               the write scope (loop spec §3.2), so the Composer shows them as 「対象コード」 and the estimate agrees.
//   candidates  never in the scope by themselves — the user confirms one (it is then sent as `ContextAdjust.add`):
//                 1. `ref`    code references written in the selected row / item / sentence of the block (static facts
//                             tables: `internal/config/config.go:36`, `server.go#Server.listBooks`; generated prose:
//                             the symbols it puts in backticks, `Server.handlePicker`, `sess.PickerContext()`);
//                 2. `symbol` symbols the selection or the request names exactly (`Fetch`, `Client.fetchOnce`);
//                 3. `search` full-text hits (facts, symbols) of the same terms (`TSUNDOKU_API_TOKEN` → the env fact);
//                 4. `near`   the cites of the nearest blocks of the same section (a diagram caption, a section intro or
//                             an inferred sentence sits next to the sentences that cite its code) — so a Japanese-only
//                             request on an uncited sentence of a generated doc still has its code offered.
//
// Deterministic and token-free: same index + doc + input ⇒ same answer. Pure over the ports (no I/O of its own).
import type { Anchor, Cite, CodeTarget, CodeTargets, ExcludeReason, FileEntry, Glob, LineNo, RepoPath, SearchHit, SymbolEntry } from "@mitori/core";
import { parseRepoPath } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { pathMatcher } from "../router/deny.ts";
import { anchorRanges, mergeRanges, touchingClaims } from "../router/ranges.ts";

/** Ports. */
export interface TargetDeps {
  doc: Pick<DocStore, "block" | "blockText" | "claims" | "section">;
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
  /** Code spans of the selected lines looked up as symbol names. */
  spanNames: 8,
  /** Blocks on each side whose cites are offered as `near` candidates. */
  nearBlocks: 3,
} as const;

/** Files a Fix can never write (router UNWRITABLE, loop spec §3.3). */
const UNWRITABLE: ReadonlySet<ExcludeReason> = new Set(["binary", "secret", "deny_glob", "special", "oversize", "minified", "data_large", "gitignored"]);

/** English words and keywords that are never worth a symbol lookup. */
const STOP = new Set(
  "the and for with this that from into when then than what which where while have has had are was were will would should could can not but use uses used make makes made add adds set sets get gets new old all any each one two why how its our your their also only just like more most less some such very fix change code file line func return var const type struct true false nil null none todo".split(
    " ",
  ),
);

/** Conventional test files (any language) when the index has no class for them. */
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\/|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/;

const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
const CJK_RUN = /[\p{Script=Han}\p{Script=Katakana}ー]{3,}/gu;
const KANA_HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** A code span / link target that names a repository path, optionally with `:a[-b]` or `#Qual.name`. */
const REF = /^(?<path>[A-Za-z0-9_.\-/]+?)(?::(?<a>\d+)(?:[-–](?<b>\d+))?|#(?<sym>[A-Za-z_][\w.]*))?$/;
/** A code span that names a symbol (`Server.handlePicker`, `writeJSON`, `sess.PickerContext()`): the call parens dropped. */
const SPAN_NAME = /^(?<name>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\(\))?$/;

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

/** Whitespace dropped: the block text follows ANCHOR_TEXT_RULES (no space between CJK and Latin, `UXP-24`), the md does not. */
const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * The Markdown lines the selection lies on: the k-th line containing the selected text, where k counts the earlier
 * occurrences of that text in the block text (the same text twice in a table resolves to the right row). A whole-block
 * selection is every line. When the text spans lines, the lines sharing its longest word. Compared without whitespace
 * (「`openChanges` で」 in the md is 「openChangesで」 in the block text).
 */
export function selectedLines(md: string, blockText: string, selStart: number, selEnd: number): string[] {
  const lines = md.split("\n");
  const exact = blockText.slice(selStart, selEnd).trim();
  if (exact === "" || (selStart <= 0 && selEnd >= blockText.length)) return lines;
  let k = 0;
  for (let at = blockText.indexOf(exact); at >= 0 && at < selStart; at = blockText.indexOf(exact, at + exact.length)) k++;
  const want = squash(exact);
  const hits: number[] = [];
  lines.forEach((l, i) => {
    const plain = squash(mdPlain(l));
    for (let at = plain.indexOf(want); at >= 0; at = plain.indexOf(want, at + want.length)) hits.push(i);
  });
  if (hits.length > 0) return [lines[hits[Math.min(k, hits.length - 1)] as number] as string];
  const word = [...exact.split(/\s+/)].sort((a, b) => b.length - a.length)[0] ?? "";
  if (word.length < 3) return [];
  return lines.filter((l) => mdPlain(l).includes(word));
}

/**
 * A word that names code rather than being prose: `snake_case`, `camelCase`, `Dotted.name`, `ALL_CAPS`, `Capitalized`
 * (Go's exported names), or anything the request puts in backticks. A plain lowercase word (`repo`, `agent`, `auth`)
 * matches dozens of fields and locals of a real repository (measured on crit) — it is not looked up.
 */
export function nameLike(term: string, quoted: ReadonlySet<string> = new Set()): boolean {
  return quoted.has(term) || /[_.]|[a-z0-9][A-Z]|^[A-Z]/.test(term);
}

/** Identifier and CJK terms of the selection, then of the request (deduplicated, stop words dropped). */
export function termsOf(selection: string, text: string): string[] {
  const out: string[] = [];
  const req = text.slice(0, TARGET_LIMITS.textChars);
  const quoted = new Set([...req.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] as string).trim()));
  const add = (t: string) => {
    if (t.length < 3 || STOP.has(t.toLowerCase()) || /^\d/.test(t) || out.includes(t)) return;
    out.push(t);
  };
  // a selected code reference (`cmd/crit/main.go:21`) is resolved as a reference; its path segments are not names
  const sel = /[/\\]|:\d/.test(selection) ? "" : selection;
  for (const src of [sel, req]) {
    for (const m of src.matchAll(IDENT)) if (nameLike(m[0], quoted)) add(m[0]);
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
      claimsTouching: (block, start, end) => touchingClaims(deps.doc.blockText(block) ?? "", deps.doc.claims(block), start, end),
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

  // 1. code references in the selected row / item / sentence — the ones inside the selection first. A span that is no
  //    file but names a symbol (`Server.handlePicker`, `sess.PickerContext()`) is looked up exactly: qualname, else
  //    its last part (generated prose names methods through their receiver variable).
  if (block) {
    const refs = selectedLines(block.md, blockText, selStart, selEnd).flatMap((line) => refsOf(line));
    const inSel = (raw: string) => selection.includes(raw.replace(/\(\)$/, ""));
    const spanNames: string[] = [];
    for (const raw of [...refs.filter(inSel), ...refs.filter((r) => !inSel(r))]) {
      const g = REF.exec(raw)?.groups;
      const f = g?.path ? usable(g.path) : null;
      if (!g || !f) {
        const name = SPAN_NAME.exec(raw)?.groups?.name;
        if (name && name.length >= 3 && !STOP.has(name.toLowerCase()) && !spanNames.includes(name)) spanNames.push(name);
        continue;
      }
      if (g.sym) {
        const s = deps.indexer.symbols(f.path).find((x) => x.qualname === g.sym || x.name === g.sym);
        offer(s ? make(f, s.start, s.end, "ref", raw) : null);
      } else if (g.a) {
        const a = Number(g.a);
        offer(g.b ? make(f, a, Number(g.b), "ref", raw) : aroundLine(f, a, "ref", raw));
      } else if (f.lines <= TARGET_LIMITS.wholeFileMaxLines) offer(make(f, 1, f.lines, "ref", raw));
    }
    for (const name of spanNames.slice(0, TARGET_LIMITS.spanNames)) {
      const last = name.split(".").pop() as string;
      const hits = deps.indexer.findSymbols(last, TARGET_LIMITS.hitsPerTerm).filter((x) => x.name === last);
      const exact = hits.filter((x) => x.qualname === name || x.name === name);
      for (const x of exact.length > 0 ? exact : name.includes(".") ? hits : []) offer(ofSymbol(x, "ref", name));
    }
  }

  // 2. symbols named exactly, 3. full-text hits — selection terms first, then the request's
  // a short selection names something (`TSUNDOKU_API_TOKEN`, `Client.Fetch`); a whole block, a long passage or a
  // Japanese sentence is prose — its names are the code spans of tier 1 (「…で VCS を得て」 is not a lookup of `VCS`)
  const wholeBlock = selStart === 0 && selEnd >= blockText.length;
  const prose = wholeBlock || selection.length > TARGET_LIMITS.selectionNameChars || KANA_HAN.test(selection);
  const named = prose ? "" : selection;
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

  // 4. the cites of the nearest blocks of the same section (structure, not words: only when the tiers above are short)
  if (block && found.length < limit) {
    const blocks = deps.doc.section(block.section)?.blocks ?? [];
    const at = blocks.findIndex((b) => b.id === block.id);
    if (at >= 0)
      for (let d = 1; d <= TARGET_LIMITS.nearBlocks && found.length < limit; d++)
        for (const nb of [blocks[at - d], blocks[at + d]]) {
          if (!nb) continue;
          for (const r of mergeRanges(cites(nb.id).map((c) => ({ path: c.path, start: c.start, end: c.end })))) {
            const f = usable(r.path);
            if (f) offer(make(f, r.start, r.end, "near"));
          }
        }
  }

  // by evidence (the row's own reference > an exact name > a text match > a neighbour's cite); inside a tier, distinct
  // files first
  const out: CodeTarget[] = [];
  // tests come after the code they test (a Fix rarely means the test), unless the request is about tests
  const aboutTests = /test|テスト/i.test(input.text ?? "");
  const isTest = (t: CodeTarget) => deps.indexer.file(t.path)?.class === "test" || TEST_PATH.test(t.path);
  const distinctFirst = (of: CodeTarget[]) => {
    const first = of.filter((t, i) => of.findIndex((x) => x.path === t.path) === i);
    return [...first, ...of.filter((t) => !first.includes(t))];
  };
  for (const tier of ["ref", "symbol", "search", "near"] as const) {
    const all = found.filter((t) => t.source === tier);
    if (aboutTests) out.push(...distinctFirst(all));
    else out.push(...distinctFirst(all.filter((t) => !isTest(t))), ...distinctFirst(all.filter(isTest)));
  }
  return { cited, candidates: out.slice(0, limit) };
}
