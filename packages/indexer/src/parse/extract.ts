// Tree-sitter extraction (indexer spec §3.4, §3.6): symbols (kind / parent / qualname / range / signature / hashes /
// exported / doc / complexity), imports, folded refs, test names, rationale comments and LOC — all as plain values
// so the tree can be deleted before the Worker replies.
import type { LineNo, SourceLang, SymbolKind, Xxh3 } from "@mitori/core";
import type { Node, Query, QueryCapture, Tree } from "web-tree-sitter";
import { type GrammarId, type ImportKind, type ImportRecord, PARSE_POOL, RATIONALE_COMMENT_RE, type RefRecord } from "../contract.ts";
import { recoverDefs } from "./generic.ts";
import { clip, isLicenseHeader, lineAt, splitLines, squash, stripCommentMarkers, stripDocstring } from "./text.ts";

/** One extracted symbol (contract shape minus path/blob/key; `parentOrd` replaces the path-bound parent key). */
export interface ExtractedSymbol {
  ord: number;
  kind: SymbolKind;
  name: string;
  qualname: string;
  start: LineNo;
  end: LineNo;
  signature: string;
  sigHash: Xxh3;
  bodyHash: Xxh3;
  exported: boolean;
  parentOrd?: number;
  doc?: string;
  docStart?: LineNo;
  docEnd?: LineNo;
  bodyStart?: LineNo;
  bodyEnd?: LineNo;
  complexity: number;
  decorators?: string[];
  /** Last line of the declaration header (signature end; skeleton callable rule). */
  headerEnd: LineNo;
}

/** Extraction result of one parsed file. */
export interface Extraction {
  symbols: ExtractedSymbol[];
  imports: ImportRecord[];
  refs: RefRecord[];
  tests: { name: string; line: LineNo }[];
  headings?: { level: number; line: LineNo; text: string }[];
  rationale: { start: LineNo; end: LineNo }[];
  errors: number;
  degraded: boolean;
  /** Lines entirely covered by comments (LOC). */
  commentLines: Set<number>;
  /** Module doc lines (Go package comment, Rust `//!`, Python module docstring) for the doc skeleton tier. */
  moduleDoc?: { start: LineNo; end: LineNo };
  /** Go package clause line. */
  packageLine?: LineNo;
}

/** Everything the extractor needs. */
export interface ExtractInput {
  grammar: GrammarId;
  lang: SourceLang;
  text: string;
  lineStarts: readonly number[];
  tree: Tree;
  tags: Query;
  aux: Query;
  testQuery: Query | null;
  errorQuery: Query;
  /** `lite` = test files (type/qualified refs disabled by the caller's query object). */
  lite: boolean;
  /** `.d.ts`-style declaration file. */
  decl: boolean;
  /** Test-class file (test names, `test` kind). */
  isTest: boolean;
  xxh3: (s: string) => Xxh3;
}

interface Def {
  cap: string;
  kind: SymbolKind;
  name: string;
  defNode: Node;
  rangeNode: Node;
  nameStart: number;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  body: Node | null;
  /** Offset where the signature stops (body start / initializer start / range end). */
  sigEnd: number;
  /** Prefix for multi-spec Go declarations (`type ` / `const ` / `var `). */
  sigPrefix: string;
  parent: Def | null;
  qualname: string;
  exported: boolean;
  ord: number;
  complexity: number;
  docStart?: number;
  docEnd?: number;
  doc?: string;
  decorators?: string[];
  /** Rust impl target type name (qualname of impl members). */
  implType?: string;
  /** Go receiver type name. */
  receiver?: string;
  testName?: string;
}

const KIND_OF_CAP: Readonly<Record<string, SymbolKind>> = {
  function: "function",
  method: "method",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  namespace: "namespace",
  module: "module",
  struct: "struct",
  trait: "trait",
  impl: "impl",
  const: "const",
  var: "var",
  field: "field",
  macro: "macro",
};

const CONTAINER_KINDS: ReadonlySet<SymbolKind> = new Set(["class", "impl", "trait", "interface"]);
const RATIONALE_RE = new RegExp(RATIONALE_COMMENT_RE.source, RATIONALE_COMMENT_RE.flags);
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/;
const GO_TEST_RE = /^(Test|Benchmark|Fuzz|Example)[A-Z_0-9]/;
const JS_TEST_CALLEE = /^(?:(?:describe|it|test|bench|suite|context)(?:\.(?:only|skip|each|concurrent|todo|failing))*|Deno\.test)$/;
const JS_ASSET_RE = /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp3|mp4|wav|webm|html?|md|mdx|txt|wasm)(\?.*)?$/i;

/** Last 1-based line containing a character of `n` (Rust line comments include their newline). */
function lastLine(n: Node): number {
  const e = n.endPosition;
  return e.column === 0 && e.row > n.startPosition.row ? e.row : e.row + 1;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    const q = t[0];
    if ((q === '"' || q === "'" || q === "`") && t[t.length - 1] === q) return t.slice(1, -1);
  }
  return t;
}

function ancestor(n: Node, types: ReadonlySet<string>, depth = 8): Node | null {
  let p: Node | null = n.parent;
  for (let i = 0; p !== null && i < depth; i++, p = p.parent) if (types.has(p.type)) return p;
  return null;
}

const IMPORT_STMTS: ReadonlySet<string> = new Set(["import_statement", "import_from_statement", "export_statement", "import_spec"]);

/** Base name of a Rust type / trait expression (`fmt::Display` → `Display`, `Foo<T>` → `Foo`, `&mut T` → `T`). */
function rustBaseName(text: string): string {
  let t = text.replace(/\s+/g, " ");
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/<[^<>]*>/g, "");
  }
  t = t.replace(/^(&\s*)?(mut\s+|dyn\s+|impl\s+)?/, "").trim();
  const segs = t.split("::");
  return (segs[segs.length - 1] ?? t).trim();
}

/** Go receiver base type (`(t *T[K])` → `T`). */
function goReceiver(text: string): string | undefined {
  const inner = text.replace(/^\(|\)$/g, "").trim();
  const m = /([\p{L}_][\p{L}\p{N}_]*)\s*(\[[^\]]*\])?\s*$/u.exec(inner);
  return m?.[1];
}

/** Body node of a definition (or null when it has none). */
function bodyOf(grammar: GrammarId, def: Node, cap: string): Node | null {
  const t = def.type;
  if (grammar === "go") {
    if (t === "function_declaration" || t === "method_declaration") return def.childForFieldName("body");
    const spec = t === "type_declaration" ? (def.namedChildren.find((c) => c.type === "type_spec") ?? null) : t === "type_spec" ? def : null;
    const ty = spec?.childForFieldName("type") ?? null;
    if (ty?.type === "struct_type") return ty.namedChildren.find((c) => c.type === "field_declaration_list") ?? null;
    if (ty?.type === "interface_type") return ty;
    return null;
  }
  if (t === "variable_declarator") {
    const v = def.childForFieldName("value");
    if (v === null) return null;
    if (cap === "function" || cap === "class") return v.childForFieldName("body");
    return null;
  }
  if (t === "assignment_expression") return def.childForFieldName("right")?.childForFieldName("body") ?? null;
  return def.childForFieldName("body");
}

/** Offset where an initializer starts (consts/vars/fields: never part of the signature). */
function initializerStart(grammar: GrammarId, def: Node): number | null {
  const t = def.type;
  let v: Node | null = null;
  if (t === "variable_declarator" || t === "public_field_definition" || t === "field_definition" || t === "const_item" || t === "static_item") {
    v = def.childForFieldName("value");
  } else if (t === "assignment") {
    v = def.childForFieldName("right");
  } else if (grammar === "go" && (t === "const_declaration" || t === "var_declaration" || t === "const_spec" || t === "var_spec")) {
    const spec = t.endsWith("_spec") ? def : (def.namedChildren.find((c) => c.type === "const_spec" || c.type === "var_spec") ?? null);
    v = spec?.childForFieldName("value") ?? null;
  }
  if (v === null) return null;
  // Back up over `=` / `:=` and spaces so the signature ends at the declared name/type.
  return v.startIndex;
}

/** Signature cut for Go interfaces (`type I interface {` stops before `{`) and Rust macros. */
function braceStart(n: Node): number | null {
  for (const c of n.children) if (c.type === "{" || c.type === "(" || c.type === "[") return c.startIndex;
  return null;
}

export function extract(inp: ExtractInput): Extraction {
  const { grammar, text, lineStarts } = inp;
  const root = inp.tree.rootNode;
  const slice = (n: Node): string => text.slice(n.startIndex, n.endIndex);
  const line = (offset: number): number => lineAt(lineStarts, offset);

  const defs: Def[] = [];
  const seenDef = new Set<string>();
  const nameStarts = new Set<number>();
  const exportNames = new Set<string>();
  const docNodes: Node[] = [];
  let moduleDocNode: Node | null = null;
  const rustModuleDocs: Node[] = [];
  const importSrc: { node: Node; kind: ImportKind; spec: string }[] = [];
  const importNames: Node[] = [];
  const exportSrc: Node[] = [];
  const refRaw: { kind: RefRecord["kind"]; node: Node; qual?: Node }[] = [];
  let allList: string[] | null = null;
  let packageNode: Node | null = null;

  for (const m of inp.tags.matches(root)) {
    let defCap: QueryCapture | null = null;
    let nameCap: QueryCapture | null = null;
    let qualPkg: Node | null = null;
    let qualName: Node | null = null;
    let allSeen = false;
    for (const c of m.captures) {
      const n = c.name;
      if (n.startsWith("def.")) defCap = c;
      else if (n === "name") nameCap = c;
      else if (n === "ref.qual.pkg") qualPkg = c.node;
      else if (n === "ref.qual.name") qualName = c.node;
      else if (n.startsWith("ref.")) refRaw.push({ kind: n.slice(4) as RefRecord["kind"], node: c.node });
      else if (n === "import.source") importSrc.push({ node: c.node, kind: "static", spec: "" });
      else if (n === "import.dynamic") importSrc.push({ node: c.node, kind: "dynamic", spec: "" });
      else if (n === "import.mod") importSrc.push({ node: c.node, kind: "mod", spec: "" });
      else if (n === "import.name") importNames.push(c.node);
      else if (n === "export.source") exportSrc.push(c.node);
      else if (n === "export.name") {
        const v = unquote(slice(c.node));
        exportNames.add(v);
        if (grammar === "python") {
          allList ??= [];
          allList.push(v);
        }
      } else if (n === "doc") docNodes.push(c.node);
      else if (n === "doc.module") {
        if (grammar === "rust") rustModuleDocs.push(c.node);
        else moduleDocNode ??= c.node;
      } else if (n === "_all") allSeen = true;
    }
    if (allSeen && allList === null) allList = [];
    if (qualPkg !== null && qualName !== null) refRaw.push({ kind: "qual", node: qualName, qual: qualPkg });
    if (defCap !== null && nameCap !== null) {
      const cap = defCap.name.slice(4);
      if (cap === "package") {
        packageNode = defCap.node;
        continue;
      }
      const key = `${defCap.node.startIndex}:${nameCap.node.startIndex}:${cap}`;
      if (seenDef.has(key)) continue;
      seenDef.add(key);
      nameStarts.add(nameCap.node.startIndex);
      defs.push(newDef(inp, cap, defCap.node, nameCap.node, slice));
    }
  }

  // ---- order, overloads, parents --------------------------------------------------------------
  defs.sort((a, b) => a.start - b.start || b.end - a.end);
  const folded = grammar === "typescript" || grammar === "tsx" ? foldOverloads(defs) : defs;
  assignParents(folded);
  if (grammar === "go") goReceivers(folded, slice);

  // ---- aux query: complexity + comments ----------------------------------------------------------
  const comments: Node[] = [];
  const cx: number[] = [];
  for (const c of inp.aux.captures(root)) {
    if (c.name === "cx") cx.push(c.node.startIndex);
    else if (c.name === "comment") comments.push(c.node);
  }
  attributeComplexity(folded, cx);

  // ---- kinds, qualnames, exported, docs ------------------------------------------------------------
  const ctx: LangCtx = {
    inp,
    slice,
    line,
    exportNames,
    allList,
    cjsExports: grammar === "javascript" || grammar === "typescript" || grammar === "tsx" ? cjsExportNames(root, slice) : null,
  };
  for (const d of folded) fixKind(d, inp);
  qualnames(folded);
  for (const d of folded) d.exported = isExported(d, ctx);
  attachDocs(folded, ctx, docNodes);

  // ---- tests -----------------------------------------------------------------------------------------
  const tests: { name: string; line: LineNo }[] = [];
  collectTests(folded, ctx, tests);

  // ---- errors / degraded ------------------------------------------------------------------------------
  let errors = 0;
  let errorBytes = 0;
  const errorLines: { start: number; end: number }[] = [];
  if (root.hasError) {
    let coveredTo = -1;
    for (const c of inp.errorQuery.captures(root)) {
      errors++;
      if (c.name === "err") {
        const s = c.node.startIndex;
        const e = c.node.endIndex;
        if (e > coveredTo) {
          if (s >= coveredTo) errorLines.push({ start: c.node.startPosition.row + 1, end: lastLine(c.node) });
          errorBytes += e - Math.max(s, coveredTo);
          coveredTo = e;
        }
      }
    }
  }
  const degraded = text.length > 0 && errorBytes / text.length > PARSE_POOL.degradedErrorRatio;

  // ---- symbols (+ definitions recovered from ERROR regions) -------------------------------------------
  folded.forEach((d, i) => {
    d.ord = i;
  });
  let symbols: ExtractedSymbol[] = folded.map((d) => toSymbol(d, inp, text, line, comments));
  if (errorLines.length > 0) symbols = mergeRecovered(symbols, recoverDefs(splitLines(text), errorLines, new Set(symbols.map((s) => s.start)), inp.xxh3));

  // ---- imports -----------------------------------------------------------------------------------------
  const imports = collectImports(inp, importSrc, importNames, exportSrc, slice, line);

  // ---- refs -----------------------------------------------------------------------------------------------
  const refs = degraded ? [] : foldRefs(refRaw, nameStarts, slice, importAliases(inp, imports));

  // ---- comments: LOC, rationale ---------------------------------------------------------------------------
  const commentLines = new Set<number>();
  const rationale: { start: LineNo; end: LineNo }[] = [];
  for (const c of comments) {
    const s = c.startIndex;
    const e = c.endIndex;
    const sl = c.startPosition.row + 1;
    const el = lastLine(c);
    const ls = lineStarts[sl - 1] as number;
    const leEnd = (lineStarts[el] ?? text.length + 1) - 1;
    const pre = !/\S/.test(text.slice(ls, s));
    const post = !/\S/.test(text.slice(e, leEnd));
    for (let l = sl; l <= el; l++) if ((l > sl || pre) && (l < el || post)) commentLines.add(l);
    const body = text.slice(s, e);
    if (RATIONALE_RE.test(body) && !TODO_RE.test(body) && !isLicenseHeader(sl, body)) {
      const last = rationale[rationale.length - 1];
      if (last !== undefined && sl <= last.end + 1) last.end = Math.max(last.end, el);
      else rationale.push({ start: sl, end: el });
    }
  }

  const out: Extraction = { symbols, imports, refs, tests, rationale, errors, degraded, commentLines };
  if (packageNode !== null) {
    const pn = packageNode as Node;
    const pkgName = pn.namedChildren.find((c) => c.type === "package_identifier");
    out.packageLine = pn.startPosition.row + 1;
    out.headings = [{ level: 0, line: out.packageLine, text: pkgName ? slice(pkgName) : "" }];
    const pd = leadingComments(pn, text);
    if (pd !== null && !isLicenseHeader(pd.start, pd.text)) out.moduleDoc = { start: pd.start, end: pd.end };
  } else if (moduleDocNode !== null) {
    const md = moduleDocNode as Node;
    out.moduleDoc = { start: md.startPosition.row + 1, end: lastLine(md) };
  } else if (rustModuleDocs.length > 0) {
    const first = rustModuleDocs[0] as Node;
    let end = lastLine(first);
    for (const n of rustModuleDocs.slice(1)) {
      if (n.startPosition.row + 1 > end + 1) break;
      end = lastLine(n);
    }
    out.moduleDoc = { start: first.startPosition.row + 1, end };
  }
  return out;
}

// =====================================================================================================
// definitions
// =====================================================================================================

function newDef(inp: ExtractInput, cap: string, node: Node, nameNode: Node, slice: (n: Node) => string): Def {
  const g = inp.grammar;
  let defNode = node;
  let rangeNode = node;
  let sigPrefix = "";
  if (g === "go" && (node.type === "type_spec" || node.type === "type_alias" || node.type === "const_spec" || node.type === "var_spec")) {
    const parent = node.parent;
    if (parent !== null) {
      const list = parent.type.endsWith("_list") ? parent.parent : parent;
      const sameKind = parent.namedChildren.filter(
        (c) => c.type === node.type || (node.type === "type_alias" && c.type === "type_spec") || (node.type === "type_spec" && c.type === "type_alias"),
      );
      if (parent.type.endsWith("_declaration") && sameKind.length === 1) {
        defNode = parent;
        rangeNode = parent;
      } else {
        const kw = (list ?? parent).type.replace("_declaration", "");
        sigPrefix = `${kw} `;
      }
    }
  }
  if (g === "typescript" || g === "tsx" || g === "javascript") {
    if (node.type === "variable_declarator") {
      const decl = node.parent;
      if (
        decl !== null &&
        (decl.type === "lexical_declaration" || decl.type === "variable_declaration") &&
        decl.namedChildren.find((c) => c.type === "variable_declarator")?.startIndex === node.startIndex
      )
        rangeNode = decl;
    } else if (node.type === "assignment_expression" && node.parent?.type === "expression_statement") {
      rangeNode = node.parent;
    }
    const p = rangeNode.parent;
    if (p !== null && p.type === "export_statement") rangeNode = p;
  }
  let decorators: string[] | undefined;
  if (g === "python" && node.parent?.type === "decorated_definition") {
    rangeNode = node.parent;
    decorators = rangeNode.namedChildren
      .filter((c) => c.type === "decorator")
      .slice(0, 4)
      .map((c) => squash(slice(c)));
  }
  if (g === "rust") {
    const attrs: string[] = [];
    for (
      let s = defNode.previousNamedSibling;
      s !== null && (s.type === "attribute_item" || s.type === "line_comment" || s.type === "block_comment");
      s = s.previousNamedSibling
    ) {
      if (s.type === "attribute_item") attrs.unshift(squash(slice(s)));
    }
    if (attrs.length > 0) decorators = attrs.slice(-4);
  }
  const body = bodyOf(g, defNode, cap);
  const init = body === null ? initializerStart(g, defNode) : null;
  let sigEnd = body !== null ? body.startIndex : (init ?? defNode.endIndex);
  if (g === "go" && body !== null && body.type === "interface_type") sigEnd = braceStart(body) ?? sigEnd;
  if (g === "rust" && defNode.type === "macro_definition") sigEnd = braceStart(defNode) ?? sigEnd;
  const d: Def = {
    cap,
    kind: KIND_OF_CAP[cap] ?? "function",
    name: slice(nameNode),
    defNode,
    rangeNode,
    nameStart: nameNode.startIndex,
    start: rangeNode.startIndex,
    end: defNode.endIndex,
    startLine: rangeNode.startPosition.row + 1,
    endLine: lastLine(defNode),
    body,
    sigEnd,
    sigPrefix,
    parent: null,
    qualname: "",
    exported: false,
    ord: 0,
    complexity: 0,
  };
  if (decorators !== undefined) d.decorators = decorators;
  if (g === "rust" && defNode.type === "impl_item") {
    const ty = defNode.childForFieldName("type");
    const tr = defNode.childForFieldName("trait");
    d.implType = ty === null ? d.name : rustBaseName(slice(ty));
    d.name = tr === null ? `impl ${d.implType}` : `impl ${rustBaseName(slice(tr))} for ${d.implType}`;
  }
  return d;
}

/** TS overloads: consecutive `function_signature`s followed by the same-named implementation fold into one. */
function foldOverloads(defs: Def[]): Def[] {
  const out: Def[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i] as Def;
    if (d.defNode.type !== "function_signature") {
      out.push(d);
      continue;
    }
    let j = i;
    while (j < defs.length && (defs[j] as Def).defNode.type === "function_signature" && (defs[j] as Def).name === d.name) j++;
    const impl = defs[j];
    if (impl !== undefined && impl.defNode.type === "function_declaration" && impl.name === d.name) {
      impl.start = d.start;
      impl.startLine = d.startLine;
      impl.rangeNode = d.rangeNode;
      out.push(impl);
      i = j;
    } else out.push(d);
  }
  return out;
}

/** Parent = smallest enclosing definition (defs sorted by start asc, end desc). */
function assignParents(defs: Def[]): void {
  const stack: Def[] = [];
  for (const d of defs) {
    while (stack.length > 0 && (stack[stack.length - 1] as Def).end <= d.start) stack.pop();
    const top = stack[stack.length - 1];
    d.parent = top !== undefined && top.end >= d.end ? top : null;
    stack.push(d);
  }
}

/** Go methods: parent = the receiver type when defined in the same file. */
function goReceivers(defs: Def[], slice: (n: Node) => string): void {
  const types = new Map<string, Def>();
  for (const d of defs) if (d.parent === null && (d.kind === "struct" || d.kind === "interface" || d.kind === "type")) types.set(d.name, d);
  for (const d of defs) {
    if (d.defNode.type !== "method_declaration") continue;
    const recv = d.defNode.childForFieldName("receiver");
    const r = recv === null ? undefined : goReceiver(slice(recv));
    if (r === undefined) continue;
    d.receiver = r;
    const t = types.get(r);
    if (t !== undefined) d.parent = t;
  }
}

function attributeComplexity(defs: readonly Def[], cx: number[]): void {
  if (defs.length === 0 || cx.length === 0) return;
  cx.sort((a, b) => a - b);
  for (const pos of cx) {
    let lo = 0;
    let hi = defs.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((defs[mid] as Def).start <= pos) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let d: Def | null = idx >= 0 ? (defs[idx] as Def) : null;
    while (d !== null && d.end < pos) d = d.parent;
    if (d !== null) d.complexity++;
  }
}

interface LangCtx {
  inp: ExtractInput;
  slice: (n: Node) => string;
  line: (offset: number) => number;
  exportNames: ReadonlySet<string>;
  allList: string[] | null;
  cjsExports: ReadonlySet<string> | null;
}

function fixKind(d: Def, inp: ExtractInput): void {
  const p = d.parent;
  if (d.kind === "function" && p !== null && CONTAINER_KINDS.has(p.kind)) d.kind = "method";
  if (inp.grammar === "python" && d.kind === "function" && p !== null && p.kind === "class") d.kind = "method";
  if ((d.kind === "method" || d.kind === "function") && p !== null && CONTAINER_KINDS.has(p.kind)) {
    if (
      (d.name === "constructor" && inp.grammar !== "python" && inp.grammar !== "go" && inp.grammar !== "rust") ||
      (d.name === "__init__" && inp.grammar === "python")
    )
      d.kind = "constructor";
  }
  if (d.kind === "function" || d.kind === "method") {
    if (inp.grammar === "go" && inp.isTest && d.defNode.type === "function_declaration" && GO_TEST_RE.test(d.name)) d.kind = "test";
    else if (inp.grammar === "python" && inp.isTest && /^test/.test(d.name) && (p === null || (p.kind === "class" && /^Test/.test(p.name)))) d.kind = "test";
    else if (inp.grammar === "rust" && (d.decorators ?? []).some((a) => /^#\[(tokio::test|test|rstest)\b/.test(a))) d.kind = "test";
  }
}

function qualnames(defs: readonly Def[]): void {
  const seen = new Map<string, number>();
  for (const d of defs) {
    const p = d.parent;
    let base: string;
    if (d.kind === "impl") base = d.name;
    else if (p === null) base = d.receiver === undefined ? d.name : `${d.receiver}.${d.name}`;
    else if (p.kind === "impl") base = `${p.implType ?? p.name}.${d.name}`;
    else base = `${p.qualname}.${d.name}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    d.qualname = n === 1 ? base : `${base}~${n}`;
  }
}

const GO_UPPER = /^\p{Lu}/u;

function isExported(d: Def, ctx: LangCtx): boolean {
  const g = ctx.inp.grammar;
  const p = d.parent;
  if (g === "go") return GO_UPPER.test(d.name);
  if (g === "rust") {
    if (p !== null && p.kind === "impl") {
      if (p.defNode.childForFieldName("trait") !== null) return p.exported;
      return rustVisible(d.defNode, ctx.slice);
    }
    if (p !== null && (p.kind === "trait" || p.kind === "enum")) return p.exported;
    if (d.kind === "impl") return implTargetExported(d, ctx);
    if (d.kind === "macro") return (d.decorators ?? []).some((a) => a.startsWith("#[macro_export"));
    return rustVisible(d.defNode, ctx.slice);
  }
  if (g === "python") {
    if (p === null) return ctx.allList !== null ? ctx.allList.includes(d.name) : !d.name.startsWith("_");
    if (p.kind === "class") return p.exported && (!d.name.startsWith("_") || /^__.+__$/.test(d.name));
    return false;
  }
  // TS / JS
  if (p === null) {
    if (ctx.inp.decl) return true;
    if (d.rangeNode.type === "export_statement") return true;
    if (ctx.exportNames.has(d.name)) return true;
    if (ctx.cjsExports !== null && (ctx.cjsExports.has(d.name) || isCjsAssignment(d, ctx.slice))) return true;
    return false;
  }
  if (p.kind === "class" || p.kind === "interface") {
    if (!p.exported) return false;
    if (d.name.startsWith("#")) return false;
    for (const c of d.defNode.children) if (c.type === "accessibility_modifier" && /private|protected/.test(ctx.slice(c))) return false;
    return true;
  }
  if (p.kind === "namespace") return p.exported && d.rangeNode.type === "export_statement";
  return false;
}

function rustVisible(n: Node, slice: (n: Node) => string): boolean {
  const v = n.namedChildren.find((c) => c.type === "visibility_modifier");
  if (v === undefined) return false;
  const t = slice(v).replace(/\s+/g, "");
  return t === "pub" || t === "pub(crate)";
}

const implTargets = new WeakMap<object, Map<string, boolean>>();

function implTargetExported(d: Def, ctx: LangCtx): boolean {
  let m = implTargets.get(ctx);
  if (m === undefined) {
    m = new Map();
    implTargets.set(ctx, m);
  }
  const found = m.get(d.implType ?? "");
  if (found !== undefined) return found;
  // Search top-level type items of the file.
  for (const c of ctx.inp.tree.rootNode.namedChildren) {
    if (c.type !== "struct_item" && c.type !== "enum_item" && c.type !== "union_item" && c.type !== "type_item" && c.type !== "trait_item") continue;
    const nm = c.childForFieldName("name");
    if (nm !== null && ctx.slice(nm) === d.implType) {
      const v = rustVisible(c, ctx.slice);
      m.set(d.implType ?? "", v);
      return v;
    }
  }
  m.set(d.implType ?? "", true);
  return true;
}

/** `module.exports.foo = …` / `exports.foo = …` definitions. */
function isCjsAssignment(d: Def, slice: (n: Node) => string): boolean {
  if (d.defNode.type !== "assignment_expression") return false;
  const left = d.defNode.childForFieldName("left");
  const obj = left?.childForFieldName("object");
  if (obj === null || obj === undefined) return false;
  const t = slice(obj);
  return t === "exports" || t === "module.exports";
}

/** Names in `module.exports = { a, b: c }` / `module.exports = name` at program level. */
function cjsExportNames(root: Node, slice: (n: Node) => string): Set<string> | null {
  let out: Set<string> | null = null;
  for (const st of root.namedChildren) {
    if (st.type !== "expression_statement") continue;
    const a = st.namedChildren[0];
    if (a === undefined || a.type !== "assignment_expression") continue;
    const left = a.childForFieldName("left");
    if (left === null || slice(left) !== "module.exports") continue;
    const right = a.childForFieldName("right");
    if (right === null) continue;
    out ??= new Set();
    if (right.type === "identifier") out.add(slice(right));
    else if (right.type === "object") {
      for (const pr of right.namedChildren) {
        if (pr.type === "shorthand_property_identifier") out.add(slice(pr));
        else if (pr.type === "pair") {
          const v = pr.childForFieldName("value");
          if (v !== null && v.type === "identifier") out.add(slice(v));
          const k = pr.childForFieldName("key");
          if (k !== null) out.add(unquote(slice(k)));
        }
      }
    }
  }
  return out;
}

// =====================================================================================================
// docs
// =====================================================================================================

function isCommentNode(t: string): boolean {
  return t === "comment" || t === "line_comment" || t === "block_comment";
}

/** Contiguous comment siblings directly above `n` (no blank line in between). */
function leadingComments(
  n: Node,
  text: string,
  skip?: (s: Node) => boolean,
  accept?: (s: Node) => boolean,
): { start: number; end: number; text: string } | null {
  let expect = n.startPosition.row + 1 - 1; // the line right above the definition (1-based)
  let first: Node | null = null;
  let last: Node | null = null;
  for (let s = n.previousSibling; s !== null; s = s.previousSibling) {
    if (skip?.(s)) {
      expect = s.startPosition.row;
      continue;
    }
    if (!isCommentNode(s.type) || (accept !== undefined && !accept(s))) break;
    if (lastLine(s) < expect) break;
    // A trailing comment on the previous code line (`x := 1 // note`) is not a doc.
    const ls = text.lastIndexOf("\n", s.startIndex - 1) + 1;
    if (/\S/.test(text.slice(ls, s.startIndex))) break;
    first = s;
    last ??= s;
    expect = s.startPosition.row;
  }
  if (first === null || last === null) return null;
  return { start: first.startPosition.row + 1, end: lastLine(last), text: text.slice(first.startIndex, last.endIndex) };
}

function attachDocs(defs: readonly Def[], ctx: LangCtx, docNodes: readonly Node[]): void {
  const g = ctx.inp.grammar;
  const { text, slice } = { text: ctx.inp.text, slice: ctx.slice };
  if (g === "python") {
    const byDef = new Map<number, Def>();
    for (const d of defs) byDef.set(d.defNode.startIndex, d);
    for (const s of docNodes) {
      const owner = s.parent?.parent?.parent;
      if (owner === null || owner === undefined) continue;
      const d = byDef.get(owner.startIndex);
      if (d === undefined) continue;
      d.docStart = s.startPosition.row + 1;
      d.docEnd = lastLine(s);
      d.doc = clip(stripDocstring(slice(s)), 600);
    }
    return;
  }
  const docSet = g === "rust" ? new Set(docNodes.map((n) => n.startIndex)) : null;
  for (const d of defs) {
    const anchor = g === "rust" ? d.defNode : d.rangeNode;
    const r =
      docSet !== null
        ? leadingComments(
            anchor,
            text,
            (s) => s.type === "attribute_item",
            (s) => docSet.has(s.startIndex),
          )
        : leadingComments(anchor, text);
    if (r === null || isLicenseHeader(r.start, r.text)) continue;
    d.docStart = r.start;
    d.docEnd = r.end;
    d.doc = clip(stripCommentMarkers(r.text), 600);
  }
}

// =====================================================================================================
// tests
// =====================================================================================================

function collectTests(defs: readonly Def[], ctx: LangCtx, out: { name: string; line: LineNo }[]): void {
  const { inp, slice } = ctx;
  const g = inp.grammar;
  if (g === "go" || g === "python" || g === "rust") {
    for (const d of defs) {
      if (d.kind !== "test") continue;
      let name = d.name;
      if (g === "python" && d.parent !== null) name = `${d.parent.name}::${d.name}`;
      if (g === "rust") {
        const mods: string[] = [];
        for (let p = d.parent; p !== null; p = p.parent) if (p.kind === "module") mods.unshift(p.name);
        name = [...mods, d.name].join("::");
      }
      d.testName = name;
      out.push({ name, line: d.startLine });
    }
  }
  if (!inp.isTest || inp.testQuery === null) return;
  if (g === "go") {
    const tests = defs.filter((d) => d.kind === "test");
    for (const m of inp.testQuery.matches(inp.tree.rootNode)) {
      const nm = m.captures.find((c) => c.name === "t.name")?.node;
      if (nm === undefined) continue;
      const pos = nm.startIndex;
      const owner = tests.find((d) => d.start <= pos && d.end >= pos);
      if (owner !== undefined) out.push({ name: `${owner.name}/${unquote(slice(nm))}`, line: nm.startPosition.row + 1 });
    }
    return;
  }
  // JS / TS: describe / it / test chains.
  const calls: { s: number; e: number; name: string; leaf: boolean; line: number }[] = [];
  for (const m of inp.testQuery.matches(inp.tree.rootNode)) {
    const fn = m.captures.find((c) => c.name === "t.fn")?.node;
    const nm = m.captures.find((c) => c.name === "t.name")?.node;
    if (fn === undefined || nm === undefined) continue;
    const callee = slice(fn);
    if (!JS_TEST_CALLEE.test(callee)) continue;
    const call = fn.parent;
    if (call === null) continue;
    const head = callee.split(".")[0] as string;
    calls.push({
      s: call.startIndex,
      e: call.endIndex,
      name: unquote(slice(nm)),
      leaf: head !== "describe" && head !== "suite" && head !== "context",
      line: call.startPosition.row + 1,
    });
  }
  calls.sort((a, b) => a.s - b.s);
  const stack: typeof calls = [];
  for (const c of calls) {
    while (stack.length > 0 && (stack[stack.length - 1] as (typeof calls)[number]).e <= c.s) stack.pop();
    if (c.leaf) out.push({ name: [...stack.filter((x) => !x.leaf).map((x) => x.name), c.name].join(" › "), line: c.line });
    stack.push(c);
  }
}

// =====================================================================================================
// symbols
// =====================================================================================================

function stripRanges(text: string, from: number, to: number, comments: readonly Node[]): string {
  let out = "";
  let at = from;
  for (const c of comments) {
    if (c.endIndex <= from || c.startIndex >= to) continue;
    if (c.startIndex > at) out += text.slice(at, c.startIndex);
    at = Math.max(at, c.endIndex);
  }
  if (at < to) out += text.slice(at, to);
  return out;
}

function toSymbol(d: Def, inp: ExtractInput, text: string, line: (o: number) => number, comments: readonly Node[]): ExtractedSymbol {
  let sigRaw = text.slice(d.start, Math.max(d.start, d.sigEnd));
  if (d.body === null && d.sigEnd !== d.defNode.endIndex) sigRaw = sigRaw.replace(/\s*:?=\s*$/, "");
  let signature = squash(`${d.sigPrefix}${sigRaw}`).replace(/\s*[{:]\s*$/, "");
  signature = clip(signature, 200);
  const sigHash = inp.xxh3(`${d.kind}\0${d.qualname}\0${signature.replace(/\s+/g, "")}`);
  const bFrom = d.body?.startIndex ?? d.start;
  const bTo = d.body?.endIndex ?? d.end;
  const bodyHash = inp.xxh3(squash(stripRanges(text, bFrom, bTo, comments)));
  let headerEnd = d.endLine;
  const s: ExtractedSymbol = {
    ord: d.ord,
    kind: d.kind,
    name: d.name,
    qualname: d.qualname,
    start: d.startLine,
    end: d.endLine,
    signature,
    sigHash,
    bodyHash,
    exported: d.exported,
    complexity: d.complexity,
    headerEnd,
  };
  if (d.body !== null) {
    s.bodyStart = d.body.startPosition.row + 1;
    s.bodyEnd = lastLine(d.body);
    if (text[d.body.startIndex] === "{" || (inp.grammar === "go" && d.body.type === "interface_type")) headerEnd = line(d.sigEnd);
    else {
      let k = d.body.startIndex - 1;
      while (k > d.start && /\s/.test(text[k] as string)) k--;
      headerEnd = line(k);
    }
    s.headerEnd = Math.max(s.start, headerEnd);
  } else if (d.sigEnd < d.end) {
    s.headerEnd = Math.max(s.start, line(Math.max(d.start, d.sigEnd - 1)));
  }
  if (d.parent !== null) s.parentOrd = d.parent.ord;
  if (d.doc !== undefined && d.doc !== "") s.doc = d.doc;
  if (d.docStart !== undefined) s.docStart = d.docStart;
  if (d.docEnd !== undefined) s.docEnd = d.docEnd;
  if (d.decorators !== undefined) s.decorators = d.decorators;
  return s;
}

/** Merge recovered top-level symbols into the tree symbols (source order; ords and parent ords renumbered). */
function mergeRecovered(symbols: ExtractedSymbol[], recovered: ExtractedSymbol[]): ExtractedSymbol[] {
  if (recovered.length === 0) return symbols;
  const seen = new Set(symbols.map((s) => s.qualname));
  for (const r of recovered) {
    let q = r.name;
    for (let n = 2; seen.has(q); n++) q = `${r.name}~${n}`;
    seen.add(q);
    r.qualname = q;
    r.ord = -1;
  }
  const all = [...symbols, ...recovered].sort((a, b) => a.start - b.start || b.end - a.end);
  const remap = new Map<number, number>();
  all.forEach((s, i) => {
    if (s.ord >= 0) remap.set(s.ord, i);
  });
  return all.map((s, i) => {
    const out: ExtractedSymbol = { ...s, ord: i };
    if (s.parentOrd !== undefined) {
      const p = remap.get(s.parentOrd);
      if (p === undefined) delete out.parentOrd;
      else out.parentOrd = p;
    }
    return out;
  });
}

// =====================================================================================================
// imports
// =====================================================================================================

function rustUseNames(spec: string): string[] {
  const out: string[] = [];
  for (const raw of spec.replace(/[{}]/g, ",").split(",")) {
    const t = raw.trim();
    if (t === "" || t.endsWith("::")) continue;
    const as = /\bas\s+([A-Za-z_]\w*)$/.exec(t);
    if (as) {
      out.push(as[1] as string);
      continue;
    }
    const segs = t.split("::");
    let last = (segs[segs.length - 1] ?? "").trim();
    if (last === "self") last = (segs[segs.length - 2] ?? "").trim();
    if (last !== "" && last !== "*") out.push(last);
  }
  return out;
}

function collectImports(
  inp: ExtractInput,
  srcs: { node: Node; kind: ImportKind; spec: string }[],
  names: readonly Node[],
  exportSrc: readonly Node[],
  slice: (n: Node) => string,
  line: (o: number) => number,
): ImportRecord[] {
  const g = inp.grammar;
  const byStmt = new Map<number, string[]>();
  for (const n of names) {
    const st = ancestor(n, IMPORT_STMTS);
    if (st === null) continue;
    const list = byStmt.get(st.startIndex) ?? [];
    list.push(slice(n));
    byStmt.set(st.startIndex, list);
  }
  const out: ImportRecord[] = [];
  for (const s of srcs) {
    const raw = slice(s.node);
    const spec = g === "rust" ? squash(raw) : g === "python" ? raw.trim() : unquote(raw);
    let kind = s.kind;
    let nm: string[] = [];
    const st = s.kind === "dynamic" ? null : (ancestor(s.node, IMPORT_STMTS) ?? (s.node.parent?.type === "import_statement" ? s.node.parent : null));
    if (st !== null) nm = byStmt.get(st.startIndex) ?? [];
    if (g === "rust" && s.kind === "static" && s.node.parent?.type === "use_declaration") nm = rustUseNames(spec);
    if ((g === "typescript" || g === "tsx" || g === "javascript") && st !== null) {
      if (/^import\s+type\b/.test(text10(inp.text, st.startIndex))) kind = "type";
      else if (kind === "static" && JS_ASSET_RE.test(spec)) kind = "asset";
    }
    out.push({ spec, line: line(s.node.startIndex), kind, names: nm.slice(0, 32) });
  }
  for (const n of exportSrc) {
    const st = n.parent;
    const nm = st === null ? [] : (byStmt.get(st.startIndex) ?? exportClauseNames(st, slice));
    out.push({ spec: unquote(slice(n)), line: line(n.startIndex), kind: "reexport", names: nm.slice(0, 32) });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

function text10(text: string, at: number): string {
  return text.slice(at, at + 16);
}

function exportClauseNames(st: Node, slice: (n: Node) => string): string[] {
  const clause = st.namedChildren.find((c) => c.type === "export_clause");
  if (clause === undefined) return [];
  return clause.namedChildren.filter((c) => c.type === "export_specifier").map((c) => slice(c.childForFieldName("name") ?? c));
}

/** Import aliases a qualified ref's head must match (Go package names, Rust `use` leaves / crate roots). */
function importAliases(inp: ExtractInput, imports: readonly ImportRecord[]): Set<string> {
  const out = new Set<string>();
  if (inp.grammar === "go") {
    for (const i of imports) {
      if (i.names.length > 0) {
        for (const n of i.names) out.add(n);
        continue;
      }
      const segs = i.spec.split("/");
      let last = segs[segs.length - 1] ?? i.spec;
      if (/^v\d+$/.test(last) && segs.length > 1) last = segs[segs.length - 2] as string;
      out.add(last.replace(/\.v\d+$/, "").replace(/^go-/, ""));
    }
  } else if (inp.grammar === "rust") {
    for (const s of ["crate", "self", "super", "Self", "std", "core", "alloc"]) out.add(s);
    for (const i of imports) {
      for (const n of i.names) out.add(n);
      const head = i.spec.split("::")[0]?.trim();
      if (head) out.add(head);
    }
  }
  return out;
}

// =====================================================================================================
// refs
// =====================================================================================================

function foldRefs(
  raw: readonly { kind: RefRecord["kind"]; node: Node; qual?: Node }[],
  nameStarts: ReadonlySet<number>,
  slice: (n: Node) => string,
  aliases: ReadonlySet<string>,
): RefRecord[] {
  const folded = new Map<string, RefRecord>();
  for (const r of raw) {
    if (r.kind !== "qual" && nameStarts.has(r.node.startIndex)) continue;
    const name = slice(r.node);
    if (name === "") continue;
    let qual: string | undefined;
    if (r.qual !== undefined) {
      qual = slice(r.qual);
      if (!aliases.has(qual)) continue;
    }
    const key = `${r.kind}\0${qual ?? ""}\0${name}`;
    const hit = folded.get(key);
    if (hit !== undefined) {
      hit.count++;
      continue;
    }
    if (folded.size >= PARSE_POOL.refsPerFileMax) continue;
    const rec: RefRecord = { name, kind: r.kind, count: 1, firstLine: r.node.startPosition.row + 1 };
    if (qual !== undefined) rec.qual = qual;
    folded.set(key, rec);
  }
  return [...folded.values()];
}
