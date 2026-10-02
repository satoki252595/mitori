import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import { Parser, Language } from 'web-tree-sitter'
await Parser.init()
const base = path.join(workerData.root, 'node_modules')
const L = { go: 'tree-sitter-go/tree-sitter-go.wasm', ts: 'tree-sitter-typescript/tree-sitter-typescript.wasm', tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm', js: 'tree-sitter-javascript/tree-sitter-javascript.wasm' }
const langs = {}
for (const [k, v] of Object.entries(L)) langs[k] = await Language.load(path.join(base, v))
const parser = new Parser()
const extLang = f => f.endsWith('.go') ? 'go' : f.endsWith('.tsx') ? 'tsx' : /\.(ts|mts|cts)$/.test(f) ? 'ts' : /\.(js|mjs|cjs|jsx)$/.test(f) ? 'js' : null
const TSD = new Set(['function_declaration','generator_function_declaration','class_declaration','abstract_class_declaration','interface_declaration','type_alias_declaration','enum_declaration','internal_module','module'])
function symbols(root, lang) {
  const out = []
  for (const n of root.namedChildren) {
    let t = n.type, d = n
    if (lang === 'go') {
      if (t === 'function_declaration' || t === 'method_declaration') out.push([t[0], n.childForFieldName('name')?.text, n.startPosition.row])
      else if (t === 'type_declaration') for (const c of n.namedChildren) out.push(['t', c.childForFieldName('name')?.text, n.startPosition.row])
      continue
    }
    if (t === 'export_statement') { d = n.childForFieldName('declaration'); if (!d) continue; t = d.type }
    if (TSD.has(t)) out.push([t[0], d.childForFieldName('name')?.text, d.startPosition.row])
    else if (t === 'lexical_declaration' || t === 'variable_declaration') for (const c of d.namedChildren) if (c.type === 'variable_declarator') out.push(['v', c.childForFieldName('name')?.text, d.startPosition.row])
  }
  return out
}
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', (m) => {
  if (m.type !== 'job') return
  const res = []
  let readMs = 0, parseMs = 0
  for (const f of m.files) {
    let t = performance.now()
    const src = fs.readFileSync(path.join(m.repo, f), 'utf8')
    const h = Bun.hash.xxHash3(src).toString(16)
    readMs += performance.now() - t
    const lang = extLang(f)
    let syms = null
    if (lang && !m.hashOnly) {
      // skip minified / generated blobs
      const avg = src.length / (1 + (src.match(/\n/g)?.length ?? 0))
      if (avg < 300) { t = performance.now(); parser.setLanguage(langs[lang]); const tree = parser.parse(src); syms = symbols(tree.rootNode, lang); tree.delete(); parseMs += performance.now() - t }
    }
    res.push([f, h, syms])
  }
  parentPort.postMessage({ type: 'done', id: m.id, res, readMs, parseMs })
})
