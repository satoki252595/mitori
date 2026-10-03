/**
 * Test-only stand-in for WP-02's S0 + S1 (MILESTONES §0.2: "ParseResponse は fixture"): a simplified path/content
 * classifier and a single-thread web-tree-sitter extraction over the spec's tags queries, producing the StageInput
 * the S2–S4 stages consume. It also runs this WP's fact extractors with the live tree, as the Worker will.
 * Replace with the real `createParseWorker` once WP-02 lands.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FileClass, RepoPath, SourceLang, SymbolKind } from "@mitori/core";
import { Language, type Node, Parser, Query } from "web-tree-sitter";
import type { FileScope, GrammarId, ImportRecord, RefRecord, SymbolDetail } from "../../contract.ts";
import { INVENTORY_SETS } from "../../contract.ts";
import { extractFacts } from "../../facts/registry.ts";
import { isResolverConfig, type StageFile, type StageInput } from "../../resolve/files.ts";

const ROOT = join(import.meta.dir, "../../../../..");
const NM = join(ROOT, "node_modules");
const QDIR = join(ROOT, "docs/design/specs/indexer/queries");

const WASM: Record<GrammarId, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
};
const QUERIES: Record<GrammarId, string[]> = {
  typescript: ["typescript.scm"],
  tsx: ["typescript.scm", "tsx-addendum.scm"],
  javascript: ["javascript.scm"],
  python: ["python.scm"],
  go: ["go.scm"],
  rust: ["rust.scm"],
};

interface Grammar {
  lang: Language;
  tags: Query;
  parser: Parser;
}
let grammars: Promise<Record<GrammarId, Grammar>> | null = null;

export function loadGrammars(): Promise<Record<GrammarId, Grammar>> {
  grammars ??= (async () => {
    await Parser.init({ locateFile: () => join(NM, "web-tree-sitter/web-tree-sitter.wasm") });
    const out = {} as Record<GrammarId, Grammar>;
    for (const g of Object.keys(WASM) as GrammarId[]) {
      const lang = await Language.load(readFileSync(join(NM, WASM[g])));
      const tags = new Query(lang, QUERIES[g].map((f) => readFileSync(join(QDIR, f), "utf8")).join("\n"));
      const parser = new Parser();
      parser.setLanguage(lang);
      out[g] = { lang, tags, parser };
    }
    return out;
  })();
  return grammars;
}

/* ------------------------------------------------------------------ simplified S0 */

const re = (r: { source: string; flags: string }) => new RegExp(r.source, r.flags);
const SECRET = re(INVENTORY_SETS.secretName);
const GEN_NAME = re(INVENTORY_SETS.generatedName);
const MIN_NAME = re(INVENTORY_SETS.minifiedName);
const DOC_NAME = re(INVENTORY_SETS.docName);
const CONFIG_NAME = re(INVENTORY_SETS.configName);
const has = (segs: readonly string[], list: readonly string[]) => segs.some((s) => list.includes(s));
const ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template)$/;

const LANGS: [RegExp, SourceLang, GrammarId | null][] = [
  [/\.d\.ts$|\.[cm]?ts$/, "typescript", "typescript"],
  [/\.tsx$/, "tsx", "tsx"],
  [/\.jsx$/, "jsx", "javascript"],
  [/\.[cm]?js$/, "javascript", "javascript"],
  [/\.pyi?$/, "python", "python"],
  [/\.go$/, "go", "go"],
  [/\.rs$/, "rust", "rust"],
];

interface Classified {
  class: FileClass;
  scope: FileScope;
  lang: SourceLang;
  grammar: GrammarId | null;
  excluded?: StageFile["excluded"];
}

export function classify(path: RepoPath, size: number, head: string): Classified {
  const segs = path.split("/");
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1] as string;
  const ext = /\.([^.]+)$/.exec(base)?.[1]?.toLowerCase() ?? "";
  const lg = LANGS.find(([r]) => r.test(path));
  const lang: SourceLang = lg?.[1] ?? "generic";
  const grammar = lg?.[2] ?? null;
  const ex = (cls: FileClass, excluded: NonNullable<StageFile["excluded"]>): Classified => ({ class: cls, scope: "main", lang, grammar, excluded });
  if (ENV_TEMPLATE.test(path)) return ex("secret", "secret");
  if (SECRET.test(path)) return ex("secret", "secret");
  if ((INVENTORY_SETS.lockfiles as readonly string[]).includes(base)) return ex("lockfile", "lockfile");
  if ((INVENTORY_SETS.binaryExts as readonly string[]).includes(ext)) return ex("binary", "binary");
  if (size > 2_097_152) return ex("oversize", "oversize");
  if (has(dirs, INVENTORY_SETS.vendorSegments)) return ex("vendored", "vendored");
  if (has(dirs, INVENTORY_SETS.generatedSegments) || GEN_NAME.test(path)) return ex("generated", "generated");
  if (MIN_NAME.test(path)) return ex("minified", "minified");
  const lines = head.split("\n");
  if (size > 1024 && head.length / Math.max(1, lines.length) > 300) return ex("minified", "minified");
  if (lines.slice(0, 5).some((l) => /Code generated .* DO NOT EDIT\.|@generated\b/.test(l))) return ex("generated", "generated");
  if (has(dirs, INVENTORY_SETS.fixtureSegments)) return ex("ignored", "fixture");
  if ((INVENTORY_SETS.dataExts as readonly string[]).includes(ext) && size > 51_200 && !CONFIG_NAME.test(path)) return ex("data_large", "data_large");
  const example = has(dirs, INVENTORY_SETS.exampleSegments);
  const tooling = /^(scripts|tools|\.github)\//.test(path) || /\.config\.[cm]?[jt]s$/.test(path);
  const scope: FileScope = example ? "example" : tooling ? "tooling" : "main";
  const testName = /(_test\.go|\.(test|spec)\.[cm]?[jt]sx?|(^|\/)test_[^/]*\.py|_test\.py|(^|\/)conftest\.py)$/.test(path);
  const code = grammar !== null || (INVENTORY_SETS.codeExts as readonly string[]).includes(ext);
  if (code && (testName || has(dirs, INVENTORY_SETS.testSegments))) return { class: "test", scope: "test", lang, grammar };
  if ((INVENTORY_SETS.docExts as readonly string[]).includes(ext) || DOC_NAME.test(path)) return { class: "docs", scope, lang: "generic", grammar: null };
  if (CONFIG_NAME.test(path) || (INVENTORY_SETS.configExts as readonly string[]).includes(ext))
    return { class: "config", scope, lang: "generic", grammar: null };
  if (grammar || ext === "sql" || (INVENTORY_SETS.codeExts as readonly string[]).includes(ext)) return { class: "source", scope, lang, grammar };
  return { class: "ignored", scope, lang, grammar: null, excluded: "special" };
}

/* ------------------------------------------------------------------ simplified S1 */

const COMMENT = /^\s*(\/\/|#|\/\*|\*|--)/;

function locOf(text: string): number {
  let n = 0;
  for (const l of text.split("\n")) if (l.trim() !== "" && !COMMENT.test(l)) n++;
  return n;
}

const DEF_KINDS = new Set([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "namespace",
  "module",
  "struct",
  "trait",
  "impl",
  "const",
  "var",
  "field",
  "macro",
]);

function exportedOf(lang: SourceLang, name: string, def: Node): boolean {
  if (lang === "go") return /^\p{Lu}/u.test(name);
  if (lang === "python") return !name.startsWith("_") || /^__\w+__$/.test(name);
  if (lang === "rust") return /^pub\b/.test(def.text) || def.type === "impl_item";
  for (let p: Node | null = def, i = 0; p && i < 3; p = p.parent, i++) if (p.type === "export_statement") return true;
  return false;
}

function signatureOf(def: Node): string {
  const t = def.text;
  const brace = t.search(/[{:]\s*(\n|$)|\{/);
  const head = (brace > 0 ? t.slice(0, brace) : (t.split("\n")[0] ?? t)).replace(/\s+/g, " ").trim();
  return head.length > 200 ? `${head.slice(0, 199)}…` : head;
}

/** Parse one file into a StageFile (symbols, imports, refs, facts). */
export function parseStageFile(path: RepoPath, text: string, c: Classified, g: Grammar | null, blob: string): StageFile {
  const lines = text.split("\n").length;
  const base: StageFile = {
    path,
    blob,
    lang: c.lang,
    class: c.class,
    scope: c.scope,
    lines,
    loc: locOf(text),
    symbols: [],
    imports: [],
    refs: [],
    tests: [],
    facts: [],
  };
  if (c.excluded !== undefined) base.excluded = c.excluded;
  if (!g) {
    const fileInfo = { path, lang: c.lang, class: c.class, scope: c.scope };
    base.facts = extractFacts({ file: fileInfo, text, imports: [] });
    if (c.class === "docs")
      base.headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
        level: (m[1] as string).length,
        line: text.slice(0, m.index).split("\n").length,
        text: (m[2] as string).trim(),
      }));
    return base;
  }
  const tree = g.parser.parse(text);
  if (!tree) return base;
  try {
    const symbols: SymbolDetail[] = [];
    const imports = new Map<string, ImportRecord>();
    const byStmt = new Map<number, ImportRecord>();
    const refs = new Map<string, RefRecord>();
    const defNameIds = new Set<number>();
    let pkg: string | undefined;
    const defs: { node: Node; name: string; kind: string }[] = [];
    for (const m of g.tags.matches(tree.rootNode)) {
      const caps: Record<string, Node> = {};
      for (const cap of m.captures) caps[cap.name] ??= cap.node;
      const defCap = m.captures.find((x) => x.name.startsWith("def."));
      if (defCap && caps.name) {
        const kind = defCap.name.slice(4);
        if (kind === "package") pkg = caps.name.text;
        else if (DEF_KINDS.has(kind)) {
          defs.push({ node: defCap.node, name: caps.name.text.replace(/<.*$/s, ""), kind });
          defNameIds.add(caps.name.id);
        }
        continue;
      }
      const stmtOf = (n: Node) => {
        let s: Node = n;
        while (s.parent && !/(statement|declaration|import_spec|use_declaration|mod_item|import_from|call_expression|^call$)/.test(s.type)) s = s.parent;
        return s;
      };
      if (caps["import.source"] || caps["import.dynamic"] || caps["export.source"] || caps["import.mod"]) {
        const src = caps["import.source"] ?? caps["import.dynamic"] ?? caps["export.source"] ?? (caps["import.mod"] as Node);
        const stmt = c.lang === "go" ? (src.parent ?? src) : stmtOf(src);
        let spec = src.text.replace(/^['"`]|['"`]$/g, "");
        let kind: ImportRecord["kind"] = "static";
        const names: string[] = [];
        if (caps["import.dynamic"]) kind = "dynamic";
        else if (caps["export.source"]) kind = /^export\s+type\b/.test(stmt.text) ? "type" : "reexport";
        else if (caps["import.mod"]) {
          kind = "mod";
          const attr = stmt.previousNamedSibling;
          const pathAttr = attr?.type === "attribute_item" ? /#\[path\s*=\s*"([^"]+)"\]/.exec(attr.text)?.[1] : undefined;
          if (pathAttr) names.push(`path=${pathAttr}`);
        } else if (/^import\s+type\b/.test(stmt.text)) kind = "type";
        if (c.lang === "go") {
          const alias = stmt.childForFieldName("name");
          if (alias) names.push(alias.text);
          spec = spec.replace(/^"|"$/g, "");
        }
        const key = `${stmt.id}\0${spec}`;
        if (imports.has(key)) continue;
        const rec: ImportRecord = { spec, line: stmt.startPosition.row + 1, kind, names };
        imports.set(key, rec);
        if (!byStmt.has(stmt.id)) byStmt.set(stmt.id, rec);
        continue;
      }
      if (caps["import.name"]) {
        continue; // bound after all sources are known (second pass)
      }
      if (caps["ref.qual.pkg"] && caps["ref.qual.name"]) {
        const k = `qual\0${caps["ref.qual.pkg"].text}\0${caps["ref.qual.name"].text}`;
        const r = refs.get(k);
        if (r) r.count++;
        else
          refs.set(k, {
            name: caps["ref.qual.name"].text,
            kind: "qual",
            qual: caps["ref.qual.pkg"].text,
            count: 1,
            firstLine: caps["ref.qual.name"].startPosition.row + 1,
          });
        continue;
      }
      const refCap = m.captures.find((x) => x.name.startsWith("ref."));
      if (refCap && !defNameIds.has(refCap.node.id)) {
        const kind = refCap.name.slice(4) as RefRecord["kind"];
        const k = `${kind}\0${refCap.node.text}`;
        const r = refs.get(k);
        if (r) r.count++;
        else refs.set(k, { name: refCap.node.text, kind, count: 1, firstLine: refCap.node.startPosition.row + 1 });
      }
    }
    // late import.name captures come before their source in some grammars: second pass
    for (const m of g.tags.matches(tree.rootNode)) {
      const nameCap = m.captures.find((x) => x.name === "import.name");
      if (!nameCap) continue;
      let s: Node = nameCap.node;
      while (s.parent && !/(statement|declaration|import_spec)/.test(s.type)) s = s.parent;
      const rec = byStmt.get(s.id);
      if (rec && !rec.names.includes(nameCap.node.text) && rec.names.length < 32) rec.names.push(nameCap.node.text);
    }
    defs.sort((a, b) => a.node.startIndex - b.node.startIndex || b.node.endIndex - a.node.endIndex);
    const stack: { end: number; qual: string; key: string; exported: boolean }[] = [];
    const seen = new Map<string, number>();
    defs.forEach((d, ord) => {
      while (stack.length > 0 && (stack[stack.length - 1] as { end: number }).end < d.node.endIndex) stack.pop();
      const parent = stack[stack.length - 1];
      let name = d.name;
      if (d.kind === "impl") name = d.name.replace(/\s+/g, "");
      let qual = parent ? `${parent.qual}.${name}` : name;
      if (c.lang === "go" && d.kind === "method") {
        const recv = d.node.childForFieldName("receiver")?.text.match(/\*?\s*([A-Za-z_]\w*)\s*(\[.*\])?\)$/)?.[1];
        if (recv) qual = `${recv}.${name}`;
      }
      const n = (seen.get(qual) ?? 0) + 1;
      seen.set(qual, n);
      if (n > 1) qual = `${qual}~${n}`;
      const exported = exportedOf(c.lang, name, d.node) && (!parent || parent.exported);
      const kind = (d.kind === "function" && parent ? "method" : d.kind) as SymbolKind;
      const sig = signatureOf(d.node);
      const s: SymbolDetail = {
        key: `${path}#${qual}`,
        path,
        blob,
        kind,
        name,
        qualname: qual,
        start: d.node.startPosition.row + 1,
        end: d.node.endPosition.row + 1,
        signature: sig,
        sigHash: Bun.hash
          .xxHash3(`${kind}\0${qual}\0${sig.replace(/\s+/g, "")}`)
          .toString(16)
          .padStart(16, "0"),
        bodyHash: Bun.hash.xxHash3(d.node.text.replace(/\s+/g, " ")).toString(16).padStart(16, "0"),
        exported,
        ord,
        complexity: 0,
        ...(parent ? { parent: parent.key as SymbolDetail["key"] } : {}),
      };
      symbols.push(s);
      stack.push({ end: d.node.endIndex, qual, key: s.key, exported });
    });
    base.symbols = symbols;
    base.imports = [...imports.values()];
    base.refs = [...refs.values()];
    if (pkg !== undefined) {
      const build = /^\/\/go:build\s+(.+)$/m.exec(text.slice(0, Math.max(0, text.indexOf("package "))))?.[1];
      base.headings = [{ level: 0, line: 1, text: pkg }, ...(build !== undefined ? [{ level: -1, line: 1, text: build }] : [])];
    }
    base.facts = extractFacts({ file: { path, lang: c.lang, class: c.class, scope: c.scope }, text, tree, imports: base.imports });
    return base;
  } finally {
    tree.delete();
  }
}

/* ------------------------------------------------------------------ repos */

/** Corpus root: `MITORI_CORPUS_DIR` / `~/.cache/mitori-corpus/<name>@<sha12>`, else the session scratchpad clone. */
export function corpusDir(name: string): string | null {
  const roots = [process.env.MITORI_CORPUS_DIR ?? join(homedir(), ".cache", "mitori-corpus")];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const hit = readdirSync(r).find((d) => d === name || d.startsWith(`${name}@`));
    if (hit) return join(r, hit);
  }
  for (const p of [
    `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/refs/${name}`,
    `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/corpus/${name}`,
  ])
    if (existsSync(p)) return p;
  return null;
}

export const FIXTURES = join(ROOT, "fixtures/repos");

function listFiles(root: string): RepoPath[] {
  if (existsSync(join(root, ".git"))) {
    const r = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe", stderr: "ignore" });
    return r.stdout.toString().split("\0").filter(Boolean).sort();
  }
  const out: RepoPath[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, "");
  return out.sort();
}

export interface LoadedRepo {
  input: StageInput;
  texts: Map<RepoPath, string>;
  parseMs: number;
}

const blobCache = new Map<string, StageFile>();
const configTextCache = new Map<string, string>();

/** First-parent commits, oldest first (`git rev-list --first-parent --reverse HEAD`). */
export function commitsOf(root: string): string[] {
  const r = Bun.spawnSync(["git", "rev-list", "--first-parent", "--reverse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  return r.stdout.toString().split("\n").filter(Boolean);
}

/** The repo as of `commit` (tracked files only), parsing each (path, blob) once across calls. */
export async function loadCommit(root: string, commit: string): Promise<LoadedRepo> {
  const gs = await loadGrammars();
  const ls = Bun.spawnSync(["git", "ls-tree", "-r", "-z", "-l", commit], { cwd: root, stdout: "pipe", stderr: "ignore" }).stdout.toString();
  const entries = ls
    .split("\0")
    .filter(Boolean)
    .map((l) => {
      const [meta, path] = l.split("\t") as [string, string];
      const [mode, type, blob, size] = meta.split(/\s+/) as [string, string, string, string];
      return { mode, type, blob, size: Number(size) || 0, path };
    })
    .filter((e) => e.type === "blob" && e.mode !== "120000");
  const missing = entries.filter((e) => !blobCache.has(`${e.path}\0${e.blob}`) && e.size <= 2_097_152);
  const contents = new Map<string, string>();
  if (missing.length > 0) {
    const out = Bun.spawnSync(["git", "cat-file", "--batch"], {
      cwd: root,
      stdin: new TextEncoder().encode(`${[...new Set(missing.map((e) => e.blob))].join("\n")}\n`),
      stdout: "pipe",
    }).stdout;
    let at = 0;
    const dec = new TextDecoder();
    while (at < out.length) {
      const nl = out.indexOf(10, at);
      const [oid, , len] = dec.decode(out.subarray(at, nl)).split(" ") as [string, string, string];
      const n = Number(len);
      contents.set(oid, dec.decode(out.subarray(nl + 1, nl + 1 + n)));
      at = nl + 1 + n + 1;
    }
  }
  const files: StageFile[] = [];
  const texts = new Map<RepoPath, string>();
  const configTexts = new Map<RepoPath, string>();
  const t0 = performance.now();
  for (const e of entries.sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const key = `${e.path}\0${e.blob}`;
    let f = blobCache.get(key);
    const raw = contents.get(e.blob);
    if (!f) {
      const text = raw ?? "";
      const c = classify(e.path, e.size, text.slice(0, 8192));
      if ((c.excluded !== undefined && !ENV_TEMPLATE.test(e.path)) || text.includes("\u0000"))
        f = {
          path: e.path,
          blob: e.blob,
          lang: c.lang,
          class: c.class,
          scope: c.scope,
          excluded: c.excluded ?? "binary",
          lines: 0,
          loc: 0,
          symbols: [],
          imports: [],
          refs: [],
          tests: [],
          facts: [],
        };
      else f = parseStageFile(e.path, text, c, c.grammar ? gs[c.grammar] : null, e.blob);
      blobCache.set(key, f);
      if (isResolverConfig(e.path)) configTextCache.set(key, text);
    }
    files.push(f);
    const t = configTextCache.get(key);
    if (t !== undefined) configTexts.set(e.path, t);
    if (raw !== undefined) texts.set(e.path, raw);
  }
  return { input: { files, texts: configTexts }, texts, parseMs: performance.now() - t0 };
}

const cache = new Map<string, Promise<LoadedRepo>>();

/** Load + parse a repo directory (memoized per path + override). `overrides` replace file texts (edit simulation). */
export function loadRepo(root: string, overrides?: ReadonlyMap<RepoPath, string>): Promise<LoadedRepo> {
  const key = overrides ? `${root}\0${[...overrides.keys()].join(",")}\0${Bun.hash([...overrides.values()].join("\0"))}` : root;
  let p = cache.get(key);
  if (!p) {
    p = parseRepo(root, overrides);
    if (!overrides) cache.set(key, p);
  }
  return p;
}

async function parseRepo(root: string, overrides?: ReadonlyMap<RepoPath, string>): Promise<LoadedRepo> {
  const gs = await loadGrammars();
  const files: StageFile[] = [];
  const texts = new Map<RepoPath, string>();
  const configTexts = new Map<RepoPath, string>();
  const t0 = performance.now();
  for (const path of listFiles(root)) {
    const abs = join(root, path);
    let size: number;
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    const raw = overrides?.get(path) ?? (size <= 2_097_152 ? readFileSync(abs, "utf8") : "");
    const c = classify(path, size, raw.slice(0, 8192));
    const blob = Bun.hash.xxHash3(raw).toString(16).padStart(16, "0");
    if (c.excluded !== undefined && !ENV_TEMPLATE.test(path)) {
      files.push({
        path,
        blob,
        lang: c.lang,
        class: c.class,
        scope: c.scope,
        excluded: c.excluded,
        lines: 0,
        loc: 0,
        symbols: [],
        imports: [],
        refs: [],
        tests: [],
        facts: [],
      });
      continue;
    }
    if (raw.includes("\u0000")) continue;
    texts.set(path, raw);
    if (isResolverConfig(path)) configTexts.set(path, raw);
    files.push(parseStageFile(path, raw, c, c.grammar ? gs[c.grammar] : null, blob));
  }
  return { input: { files, texts: configTexts }, texts, parseMs: performance.now() - t0 };
}
