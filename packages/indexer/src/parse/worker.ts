// The parse Worker (indexer spec §3.3, §3.7): one read per file → blob → content rules → parse (with timeout) → tags /
// aux queries → extraction → skeleton fragments → fact candidates → `tree.delete()`. Pure: only `env` touches the
// outside world, so the same code runs in Bun Workers, node:worker_threads or in-thread (tests).
import type { ExtractorVersion, SourceLang } from "@mitori/core";
import { Edit, Language, Parser, Query, type Tree } from "web-tree-sitter";
import {
  type FactCandidate,
  type GrammarId,
  LANG_GRAMMAR,
  LITE_DISABLED_CAPTURES,
  PARSE_POOL,
  type ParseBatchRequest,
  type ParseBatchResponse,
  type ParseItemResult,
  type ParseWorkerEnv,
  type ParseWorkerHandler,
  type ParseWorkerInit,
  type SymbolDetail,
} from "../contract.ts";
import { contentRule } from "../inventory/content.ts";
import { CX_QUERIES, ERROR_QUERY, TEST_QUERIES } from "../lang/aux.ts";
import { grammarFor, langOfPath, needsShebang, shebangLang } from "../lang/detect.ts";
import { TAGS_QUERIES } from "../lang/queries.ts";
import { extractorVersion } from "../lang/versions.ts";
import { cCommentLine, hashCommentLine, renderSkeletons, type SkeletonBodies } from "../skeleton/render.ts";
import { countCjk } from "../tokens/index.ts";
import { detectorById } from "./detectors.ts";
import { type ExtractedSymbol, type Extraction, extract } from "./extract.ts";
import { docHeadings, genericCommentLines, genericSymbols } from "./generic.ts";
import type { ParseItemExt, ParseOkResult, ParseResultExt } from "./protocol.ts";
import { countLoc, decodeUtf8, lineStarts, splitLines } from "./text.ts";

// One WASM runtime per thread: Parser.init replaces module state, so every handler of a thread shares it.
let runtime: Promise<void> | null = null;
const languages = new Map<GrammarId, Promise<Language>>();

interface GrammarState {
  language: Language;
  tags: Query;
  lite: Query | null;
  tests: Query | null;
  errors: Query;
}

interface LruTree {
  tree: Tree;
  text: string;
  grammar: GrammarId;
}

/** Counters for tests and the bench (IDX-AT-14: deletes = parses). */
export interface WorkerStats {
  parses: number;
  deletes: number;
  files: number;
  bytes: number;
}

/** Handler plus test hooks. */
export interface WorkerHandlerImpl extends ParseWorkerHandler {
  stats(): WorkerStats;
}

const DOC_LIKE: ReadonlySet<string> = new Set(["md", "mdx", "markdown", "rst", "adoc", "asciidoc"]);

export async function createWorkerHandler(env: ParseWorkerEnv, init: ParseWorkerInit): Promise<WorkerHandlerImpl> {
  runtime ??= Parser.init({ wasmBinary: init.runtime });
  await runtime;
  const parser = new Parser();
  const grammars = new Map<GrammarId, GrammarState>();
  const versions = new Map<SourceLang, ExtractorVersion>();
  const lru = new Map<string, LruTree>();
  const stats: WorkerStats = { parses: 0, deletes: 0, files: 0, bytes: 0 };
  const xxh3s = (s: string) => env.xxh3(s);

  const queryText = (g: GrammarId): string => init.queries[g] ?? TAGS_QUERIES[g];
  const combined = (g: GrammarId): string => `${queryText(g)}\n${CX_QUERIES[g]}`;
  const versionOf = (lang: SourceLang): ExtractorVersion => {
    let v = versions.get(lang);
    if (v === undefined) {
      v = extractorVersion(lang, xxh3s, { ...TAGS_QUERIES, ...init.queries });
      versions.set(lang, v);
    }
    return v;
  };

  async function grammar(g: GrammarId): Promise<GrammarState | null> {
    const hit = grammars.get(g);
    if (hit) return hit;
    const bytes = init.grammars[g];
    if (bytes === undefined) return null;
    let lp = languages.get(g);
    if (lp === undefined) {
      lp = Language.load(bytes);
      languages.set(g, lp);
    }
    const language = await lp;
    const testSrc = TEST_QUERIES[g];
    const st: GrammarState = {
      language,
      tags: new Query(language, combined(g)),
      lite: null,
      tests: testSrc === undefined ? null : new Query(language, testSrc),
      errors: new Query(language, ERROR_QUERY),
    };
    grammars.set(g, st);
    return st;
  }

  function liteQuery(g: GrammarId, st: GrammarState): Query {
    if (st.lite === null) {
      const q = new Query(st.language, combined(g));
      for (const c of LITE_DISABLED_CAPTURES) if (q.captureNames.includes(c)) q.disableCapture(c);
      st.lite = q;
    }
    return st.lite;
  }

  function dropTree(t: Tree): void {
    t.delete();
    stats.deletes++;
  }

  /** Parse with the 250 ms budget; reuses an LRU tree via a single `tree.edit` when the file was parsed before. */
  function parse(path: string, g: GrammarId, st: GrammarState, text: string): Tree | null {
    parser.setLanguage(st.language);
    const prev = lru.get(path);
    let old: Tree | null = null;
    if (prev !== undefined) {
      lru.delete(path);
      if (prev.grammar === g) {
        old = prev.tree;
        old.edit(editBetween(prev.text, text));
      } else dropTree(prev.tree);
    }
    const t0 = env.now();
    const cancel = (() => env.now() - t0 > PARSE_POOL.parseTimeoutMs) as unknown as () => void;
    let tree: Tree | null = null;
    try {
      tree = parser.parse(text, old, { progressCallback: cancel });
    } finally {
      if (old !== null) dropTree(old);
    }
    if (tree !== null) stats.parses++;
    return tree;
  }

  /** Big trees of main-thread-supplied content (update / symbolsAt) stay for the next `tree.edit`; scans keep none. */
  function keepOrDrop(path: string, g: GrammarId, tree: Tree, text: string, keep: boolean): void {
    if (!keep || text.length <= PARSE_POOL.lruTreeMinBytes) {
      dropTree(tree);
      return;
    }
    lru.set(path, { tree, text, grammar: g });
    while (lru.size > PARSE_POOL.lruTrees) {
      const [k, v] = lru.entries().next().value as [string, LruTree];
      lru.delete(k);
      dropTree(v.tree);
    }
  }

  async function item(it: ParseItemExt, ms: ParseBatchResponse["ms"]): Promise<ParseResultExt> {
    let t = env.now();
    let bytes: Uint8Array;
    try {
      bytes = it.source ?? env.readFile(it.abs);
    } catch {
      return { status: "unreadable", path: it.path };
    }
    ms.read += env.now() - t;
    t = env.now();
    const blob = it.knownBlob ?? env.gitBlob(bytes, init.objectFormat);
    ms.hash += env.now() - t;
    stats.files++;
    stats.bytes += bytes.length;
    let text: string | null = null;
    const getText = (): string => {
      text ??= decodeUtf8(bytes);
      return text;
    };

    // Env templates (`.env.example`): key names only, through the detectors (CR idx-11). Nothing else leaves.
    if (it.provisionalClass === "secret") {
      const facts = runDetectors(it, getText(), undefined, []);
      return okResult(it, blob, null, 0, 0, 0, [], getText().length, it.lang, null, facts);
    }
    if (it.skipContentRules !== true) {
      const rule = contentRule(bytes, getText, it.provisionalClass);
      if (rule !== null) return { status: "excluded", path: it.path, blob, rule, lines: rule === "R11.binary_content" ? 0 : splitLines(getText()).length };
    }
    const tx = getText();
    const lines = splitLines(tx);
    const cjk = countCjk(tx);

    let lang = it.lang;
    let g: GrammarId | null = it.grammar;
    if (lang === "generic" && needsShebang(it.path) && lines.length > 0) {
      const sl = shebangLang(lines[0] as string);
      if (sl !== null) {
        lang = sl;
        g = LANG_GRAMMAR[sl];
      }
    }
    if (g === "javascript") g = grammarFor(lang, tx);

    if (it.profile === "text") {
      const ext = it.path.slice(it.path.lastIndexOf(".") + 1).toLowerCase();
      const headings = it.provisionalClass === "docs" && DOC_LIKE.has(ext) ? docHeadings(lines) : undefined;
      const loc = countLoc(lines, it.provisionalClass === "docs" ? new Set() : genericCommentLines(lines));
      const facts = runDetectors(it, tx, undefined, []);
      const r = okResult(it, blob, null, lines.length, loc, cjk, [], tx.length, lang, null, facts);
      if (headings !== undefined) r.headings = headings;
      return r;
    }

    let ex: Extraction | null = null;
    let note: "parse_timeout" | "parse_error" | undefined;
    let facts: FactCandidate[] = [];
    if (g !== null) {
      const st = await grammar(g);
      if (st !== null) {
        t = env.now();
        let tree: Tree | null = null;
        try {
          tree = parse(it.path, g, st, tx);
        } catch {
          note = "parse_error";
        }
        ms.parse += env.now() - t;
        if (tree === null) note ??= "parse_timeout";
        else {
          try {
            t = env.now();
            const isTest = it.provisionalClass === "test";
            ex = extract({
              grammar: g,
              lang,
              text: tx,
              lineStarts: lineStarts(tx),
              tree,
              tags: it.profile === "lite" ? liteQuery(g, st) : st.tags,
              testQuery: isTest ? st.tests : null,
              errorQuery: st.errors,
              lite: it.profile === "lite",
              decl: langOfPath(it.path).decl,
              isTest,
              xxh3: xxh3s,
            });
            ms.query += env.now() - t;
            t = env.now();
            facts = runDetectors(it, tx, tree, ex.imports);
            ms.extract += env.now() - t;
          } catch {
            ex = null;
            note = "parse_error";
          } finally {
            keepOrDrop(it.path, g, tree, tx, it.source !== undefined);
          }
        }
      } else g = null;
    }
    t = env.now();
    let symbols: ExtractedSymbol[];
    let commentLines: Set<number>;
    if (ex !== null) {
      symbols = ex.symbols;
      commentLines = ex.commentLines;
    } else {
      symbols = genericSymbols(lines, xxh3s);
      commentLines = genericCommentLines(lines);
    }
    // Fallbacks keep the language's extractor version (with `note`) so the blob cache does not re-parse them.
    const r = okResult(
      it,
      blob,
      versionOf(lang),
      lines.length,
      countLoc(lines, commentLines),
      cjk,
      symbols.map((s) => toContract(s, it.path, symbols)),
      tx.length,
      lang,
      ex !== null ? g : null,
      facts,
    );
    if (ex !== null) {
      r.imports = ex.imports;
      r.refs = ex.refs;
      r.tests = ex.tests;
      r.rationale = ex.rationale;
      r.errors = ex.errors;
      if (ex.headings !== undefined) r.headings = ex.headings;
      if (ex.degraded) r.note = "degraded";
    }
    if (note !== undefined) r.note = note;
    if (it.profile === "full") r.skeleton = skeletonOf(lines, symbols, ex, g);
    ms.extract += env.now() - t;
    return r;
  }

  function runDetectors(it: ParseItemExt, text: string, tree: Tree | undefined, imports: ParseOkResult["imports"]): FactCandidate[] {
    const out: FactCandidate[] = [];
    for (const id of it.detectors) {
      const d = detectorById(id);
      if (d === undefined) continue;
      try {
        const input = {
          file: { path: it.path, lang: it.lang, class: it.provisionalClass, scope: it.scope },
          text,
          imports,
          ...(tree === undefined ? {} : { tree }),
        };
        out.push(...d.extract(input));
      } catch {
        // A failing detector never fails the file.
      }
    }
    return out;
  }

  return {
    async handle(req: ParseBatchRequest): Promise<ParseBatchResponse> {
      const ms = { read: 0, hash: 0, parse: 0, query: 0, extract: 0 };
      const items: ParseItemResult[] = [];
      for (const it of req.items) items.push((await item(it as ParseItemExt, ms)) as ParseItemResult);
      return { id: req.id, items, ms };
    },
    dispose() {
      for (const v of lru.values()) dropTree(v.tree);
      lru.clear();
      for (const st of grammars.values()) {
        st.tags.delete();
        st.lite?.delete();
        st.tests?.delete();
        st.errors.delete();
      }
      grammars.clear();
      parser.delete();
    },
    stats: () => ({ ...stats }),
  };
}

function okResult(
  it: ParseItemExt,
  blob: string,
  extractor: ExtractorVersion | null,
  lines: number,
  loc: number,
  cjk: number,
  symbols: Omit<SymbolDetail, "path" | "blob" | "key">[],
  chars: number,
  lang: SourceLang,
  grammar: GrammarId | null,
  facts: FactCandidate[],
): ParseOkResult {
  return {
    status: "ok",
    path: it.path,
    blob,
    extractor,
    lines,
    loc,
    cjk,
    symbols,
    imports: [],
    refs: [],
    tests: [],
    facts,
    rationale: [],
    errors: 0,
    chars,
    lang,
    grammar,
  };
}

/** Contract symbol (parent as `<path>#<qualname>`; the main thread rebinds it for other paths of the same blob). */
function toContract(s: ExtractedSymbol, path: string, all: readonly ExtractedSymbol[]): Omit<SymbolDetail, "path" | "blob" | "key"> {
  const { headerEnd: _h, parentOrd, ...rest } = s;
  const out: Omit<SymbolDetail, "path" | "blob" | "key"> = rest;
  if (parentOrd !== undefined) {
    const p = all[parentOrd];
    if (p !== undefined) out.parent = `${path}#${p.qualname}`;
  }
  return out;
}

function skeletonOf(lines: string[], symbols: readonly ExtractedSymbol[], ex: Extraction | null, g: GrammarId | null): SkeletonBodies {
  const input: Parameters<typeof renderSkeletons>[0] = {
    lines,
    symbols,
    docAfterHeader: g === "python",
    commentLine: g === "python" ? hashCommentLine : g === null ? (l: string) => cCommentLine(l) || hashCommentLine(l) : cCommentLine,
  };
  if (ex?.packageLine !== undefined) input.packageLine = ex.packageLine;
  if (ex?.moduleDoc !== undefined) input.moduleDoc = ex.moduleDoc;
  return renderSkeletons(input);
}

/** One `tree.edit` from the common prefix / suffix of the old and new text (spec §3.7). */
export function editBetween(a: string, b: string): Edit {
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  const point = (t: string, i: number) => {
    let row = 0;
    let at = t.indexOf("\n");
    let lastNl = -1;
    while (at >= 0 && at < i) {
      row++;
      lastNl = at;
      at = t.indexOf("\n", at + 1);
    }
    return { row, column: i - lastNl - 1 };
  };
  return new Edit({
    startIndex: p,
    oldEndIndex: a.length - s,
    newEndIndex: b.length - s,
    startPosition: point(a, p),
    oldEndPosition: point(a, a.length - s),
    newEndPosition: point(b, b.length - s),
  });
}
