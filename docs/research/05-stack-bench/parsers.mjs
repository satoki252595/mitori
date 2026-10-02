// Parser adapters. Each adapter: { init(), langOf(file)->lang|null, parse(lang,file,src)->handle, extract(handle,lang,src)->[[kind,name,line]], free(handle) }
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ROOT = path.dirname(new URL(import.meta.url).pathname)

export function langOf(file) {
  if (file.endsWith('.go')) return 'go'
  if (file.endsWith('.tsx')) return 'tsx'
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) return 'ts'
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') || file.endsWith('.jsx')) return 'js'
  return null
}

const TS_DECL = new Set([
  'function_declaration', 'generator_function_declaration', 'class_declaration', 'abstract_class_declaration',
  'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'internal_module', 'module',
])

// ---------- tree-sitter-like node walkers (shared by wts / native / ast-grep via accessors) ----------
function extractTS(root, acc) {
  // acc: { children(n), type(n), name(n), line(n), declOf(n) , varNames(n)}
  const out = []
  for (const n of acc.children(root)) {
    let t = acc.type(n), d = n
    if (t === 'export_statement') {
      d = acc.declOf(n)
      if (!d) continue
      t = acc.type(d)
    }
    if (TS_DECL.has(t)) out.push([t, acc.name(d), acc.line(d)])
    else if (t === 'lexical_declaration' || t === 'variable_declaration') {
      for (const nm of acc.varNames(d)) out.push(['var', nm, acc.line(d)])
    }
  }
  return out
}
function extractGo(root, acc) {
  const out = []
  for (const n of acc.children(root)) {
    const t = acc.type(n)
    if (t === 'function_declaration' || t === 'method_declaration') out.push([t, acc.name(n), acc.line(n)])
    else if (t === 'type_declaration') { for (const nm of acc.goSpecs(n, 'type_spec')) out.push(['type', nm, acc.line(n)]) }
    else if (t === 'const_declaration') { for (const nm of acc.goSpecs(n, 'const_spec')) out.push(['const', nm, acc.line(n)]) }
    else if (t === 'var_declaration') { for (const nm of acc.goSpecs(n, 'var_spec')) out.push(['var', nm, acc.line(n)]) }
  }
  return out
}

// ---------------- web-tree-sitter ----------------
export function makeWTS(grammarDir = 'tree-sitter-wasms/out') {
  let P, Language, parser
  const langs = {}
  const acc = {
    children: n => n.namedChildren,
    type: n => n.type,
    name: n => n.childForFieldName('name')?.text,
    line: n => n.startPosition.row,
    declOf: n => n.childForFieldName('declaration'),
    varNames: n => n.namedChildren.filter(c => c.type === 'variable_declarator').map(c => c.childForFieldName('name')?.text),
    goSpecs: (n, spec) => {
      const out = []
      for (const c of n.namedChildren) {
        if (c.type === spec) out.push(c.childForFieldName('name')?.text ?? c.namedChildren[0]?.text)
        else if (c.type === spec + '_list' || c.type === 'var_spec_list') for (const s of c.namedChildren) if (s.type === spec) out.push(s.namedChildren[0]?.text)
      }
      return out
    },
  }
  return {
    name: 'web-tree-sitter',
    async init() {
      const m = await import('web-tree-sitter')
      P = m.Parser; Language = m.Language
      await P.init()
      parser = new P()
      const base = path.join(ROOT, 'node_modules')
      const f = { go: 'tree-sitter-go/tree-sitter-go.wasm', ts: 'tree-sitter-typescript/tree-sitter-typescript.wasm', tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm', js: 'tree-sitter-javascript/tree-sitter-javascript.wasm' }
      for (const [k, v] of Object.entries(f)) langs[k] = await Language.load(path.join(base, v))
    },
    supports: l => !!langs[l],
    parse(lang, file, src) { parser.setLanguage(langs[lang]); return parser.parse(src) },
    extract(tree, lang) { return lang === 'go' ? extractGo(tree.rootNode, acc) : extractTS(tree.rootNode, acc) },
    free(tree) { tree.delete() },
  }
}

// ---------------- native tree-sitter ----------------
export function makeNative() {
  let Parser, parser
  const langs = {}
  const acc = {
    children: n => n.namedChildren,
    type: n => n.type,
    name: n => n.childForFieldName('name')?.text,
    line: n => n.startPosition.row,
    declOf: n => n.childForFieldName('declaration'),
    varNames: n => n.namedChildren.filter(c => c.type === 'variable_declarator').map(c => c.childForFieldName('name')?.text),
    goSpecs: (n, spec) => {
      const out = []
      for (const c of n.namedChildren) {
        if (c.type === spec) out.push(c.childForFieldName('name')?.text ?? c.namedChildren[0]?.text)
        else if (c.type.endsWith('_list')) for (const s of c.namedChildren) if (s.type === spec) out.push(s.namedChildren[0]?.text)
      }
      return out
    },
  }
  return {
    name: 'tree-sitter(native)',
    async init() {
      Parser = require('tree-sitter')
      parser = new Parser()
      langs.go = require('tree-sitter-go')
      const ts = require('tree-sitter-typescript')
      langs.ts = ts.typescript; langs.tsx = ts.tsx
      langs.js = require('tree-sitter-javascript')
    },
    supports: l => !!langs[l],
    parse(lang, file, src) { parser.setLanguage(langs[lang]); return parser.parse(src, undefined, { bufferSize: Math.max(32768, src.length + 1) }) },
    extract(tree, lang) { return lang === 'go' ? extractGo(tree.rootNode, acc) : extractTS(tree.rootNode, acc) },
    free() {},
  }
}

// ---------------- @ast-grep/napi ----------------
export function makeAstGrep() {
  let parse, Lang
  const L = {}
  const acc = {
    children: n => n.children().filter(c => c.isNamed()),
    type: n => n.kind(),
    name: n => n.field('name')?.text(),
    line: n => n.range().start.line,
    declOf: n => n.field('declaration'),
    varNames: n => n.children().filter(c => c.kind() === 'variable_declarator').map(c => c.field('name')?.text()),
    goSpecs: (n, spec) => {
      const out = []
      for (const c of n.children()) {
        const k = c.kind()
        if (k === spec) out.push(c.field('name')?.text() ?? c.children().find(x => x.isNamed())?.text())
        else if (k.endsWith('_list')) for (const s of c.children()) if (s.kind() === spec) out.push(s.children().find(x => x.isNamed())?.text())
      }
      return out
    },
  }
  return {
    name: '@ast-grep/napi',
    async init() {
      const m = require('@ast-grep/napi')
      parse = m.parse; Lang = m.Lang
      m.registerDynamicLanguage({ go: require('@ast-grep/lang-go') })
      L.go = 'go'; L.ts = Lang.TypeScript; L.tsx = Lang.Tsx; L.js = Lang.JavaScript
    },
    supports: l => !!L[l],
    parse(lang, file, src) { return parse(L[lang], src) },
    extract(root, lang) { const r = root.root(); return lang === 'go' ? extractGo(r, acc) : extractTS(r, acc) },
    free() {},
  }
}

// ---------------- oxc-parser (JS/TS only) ----------------
function lineIndex(src) {
  const a = [0]
  let i = -1
  while ((i = src.indexOf('\n', i + 1)) !== -1) a.push(i + 1)
  return a
}
function lineOf(idx, off) {
  let lo = 0, hi = idx.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= off) lo = mid; else hi = mid - 1 }
  return lo
}
export function makeOxc(opts = {}) {
  let parseSync
  return {
    name: 'oxc-parser',
    async init() { parseSync = require('oxc-parser').parseSync },
    supports: l => l !== 'go',
    parse(lang, file, src) { return { res: parseSync(file, src, { lang, ...opts }), src } },
    extract({ res, src }) {
      const out = []
      let idx
      const ln = off => (idx ??= lineIndex(src), lineOf(idx, off))
      for (let n of res.program.body) {
        if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDeclaration' || n.type === 'ExportDefaultDeclaration') { n = n.declaration; if (!n) continue }
        switch (n.type) {
          case 'FunctionDeclaration': case 'ClassDeclaration': case 'TSInterfaceDeclaration': case 'TSTypeAliasDeclaration': case 'TSEnumDeclaration': case 'TSModuleDeclaration':
            out.push([n.type, n.id?.name, ln(n.start)]); break
          case 'VariableDeclaration':
            for (const d of n.declarations) out.push(['var', d.id?.name, ln(n.start)])
            break
        }
      }
      return out
    },
    free(h) { h.res.dispose?.() },
  }
}

// ---------------- TypeScript compiler API ----------------
export function makeTSC() {
  let ts
  return {
    name: 'typescript(tsc API)',
    async init() { ts = require('typescript') },
    supports: l => l !== 'go',
    parse(lang, file, src) {
      const kind = lang === 'tsx' ? ts.ScriptKind.TSX : lang === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS
      return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, kind)
    },
    extract(sf) {
      const out = []
      const ln = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line
      for (const n of sf.statements) {
        if (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n))
          out.push([ts.SyntaxKind[n.kind], n.name?.text, ln(n)])
        else if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) out.push(['var', d.name?.text, ln(n)])
      }
      return out
    },
    free() {},
  }
}

export const ADAPTERS = {
  wts: () => makeWTS('tree-sitter-wasms/out'),
  wts_pkg: () => makeWTS('tree-sitter-wasms/out'), // placeholder alias
  native: makeNative,
  astgrep: makeAstGrep,
  oxc: makeOxc,
  oxcraw: () => makeOxc({ experimentalRawTransfer: true }),
  oxclazy: () => makeOxc({ experimentalLazy: true }),
  tsc: makeTSC,
}
