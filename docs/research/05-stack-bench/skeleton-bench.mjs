// Token economics: raw source vs signature skeleton (one line per top-level decl, with doc-comment first line)
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
const require = createRequire(import.meta.url)
const Parser = require('tree-sitter'); const parser = new Parser()
const Go = require('tree-sitter-go'), TS = require('tree-sitter-typescript')
const langFor = f => f.endsWith('.go') ? Go : f.endsWith('.tsx') ? TS.tsx : TS.typescript
const sigOf = (n, src) => { const t = src.slice(n.startIndex, n.endIndex); const i = t.indexOf('{'); const head = (i > 0 ? t.slice(0, i) : t.split('\n')[0]).replace(/\s+/g, ' ').trim(); return head.length > 200 ? head.slice(0, 200) : head }
const DECL = new Set(['function_declaration','method_declaration','type_declaration','const_declaration','var_declaration','class_declaration','interface_declaration','type_alias_declaration','enum_declaration','lexical_declaration','export_statement','abstract_class_declaration'])
for (const [name, corpora, limit] of [['crit (Go)', ['crit-go'], 1e9], ['hono (TS)', ['hono-ts'], 1e9], ['m3e-canvas (TS/TSX)', ['m3e-ts'], 1e9], ['Go stdlib net/http+net (Go)', ['gostd-go'], 1e9]]) {
  let files = corpora.flatMap(c => fs.readFileSync(`corpus/${c}.txt`, 'utf8').split('\n').filter(Boolean))
  if (name.startsWith('Go stdlib')) files = files.filter(f => /\/src\/(net|net\/http|encoding\/json)\//.test(f))
  let rawBytes = 0, skel = [], nd = 0
  const t0 = performance.now()
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8'); rawBytes += Buffer.byteLength(src)
    parser.setLanguage(langFor(f)); const tree = parser.parse(src, undefined, { bufferSize: src.length + 1 })
    const lines = []
    for (const n of tree.rootNode.namedChildren) if (DECL.has(n.type)) { lines.push(sigOf(n, src)); nd++ }
    skel.push(f.split('/').slice(-3).join('/') + '\n' + lines.join('\n'))
  }
  const skelText = skel.join('\n')
  const rawTok = files.map(f => encode(fs.readFileSync(f, 'utf8')).length).reduce((a, b) => a + b, 0)
  const skelTok = encode(skelText).length
  console.log(name.padEnd(30), 'files', files.length, 'rawMB', (rawBytes / 1048576).toFixed(2), 'rawTokens', rawTok, 'decls', nd, 'skeletonTokens', skelTok, 'ratio', (rawTok / skelTok).toFixed(1) + 'x', 'ms', Math.round(performance.now() - t0))
}
