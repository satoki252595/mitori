import fs from 'node:fs'
import { Parser, Language } from 'web-tree-sitter'
await Parser.init()
const ts = await Language.load('node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm')
const p = new Parser(); p.setLanguage(ts)
const src = fs.readFileSync('cv/public/big20k.ts', 'utf8')
let t = performance.now(); let tree = p.parse(src); const full = performance.now() - t
const lines = src.split('\n'); const mid = lines.slice(0, 10000).join('\n').length
const times = []
let cur = src
for (let i = 0; i < 50; i++) {
  const pos = mid + i; const ins = ' /*x*/'
  const before = cur.slice(0, pos), after = cur.slice(pos)
  const rowOf = s => s.split('\n').length - 1
  const startRow = rowOf(before), startCol = before.length - (before.lastIndexOf('\n') + 1)
  const edit = { startIndex: pos, oldEndIndex: pos, newEndIndex: pos + ins.length, startPosition: { row: startRow, column: startCol }, oldEndPosition: { row: startRow, column: startCol }, newEndPosition: { row: startRow, column: startCol + ins.length } }
  cur = before + ins + after
  tree.edit(edit)
  const s = performance.now(); const nt = p.parse(cur, tree); times.push(performance.now() - s); tree.delete(); tree = nt
}
times.sort((a, b) => a - b)
console.log(`20k-line TS file (${(src.length / 1024) | 0}KB): full parse ${full.toFixed(1)}ms; incremental reparse after 1 edit median ${times[25].toFixed(2)}ms p95 ${times[47].toFixed(2)}ms`)
