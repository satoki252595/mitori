import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'; import path from 'node:path'
const NM = workerData.nm; const QD = workerData.qd
const { Parser, Language, Query } = await import(NM + '/web-tree-sitter/web-tree-sitter.js')
await Parser.init()
const G = { typescript: ['tree-sitter-typescript/tree-sitter-typescript.wasm', ['typescript.scm']], tsx: ['tree-sitter-typescript/tree-sitter-tsx.wasm', ['typescript.scm', 'tsx-addendum.scm']], javascript: ['tree-sitter-javascript/tree-sitter-javascript.wasm', ['javascript.scm']], python: ['tree-sitter-python/tree-sitter-python.wasm', ['python.scm']], go: ['tree-sitter-go/tree-sitter-go.wasm', ['go.scm']], rust: ['tree-sitter-rust/tree-sitter-rust.wasm', ['rust.scm']] }
const cache = {}
async function lang(g) { if (cache[g]) return cache[g]; const [w, qs] = G[g]; const L = await Language.load(fs.readFileSync(path.join(NM, w))); const q = new Query(L, qs.map(f => fs.readFileSync(path.join(QD, f), 'utf8')).join('\n')); return (cache[g] = { L, q }) }
const parser = new Parser()
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', async (m) => {
  const out = []; let readMs = 0, parseMs = 0, queryMs = 0
  for (const [rel, g] of m.files) {
    let t = performance.now(); const buf = fs.readFileSync(path.join(m.repo, rel)); const h = Bun.hash.xxHash3(buf); readMs += performance.now() - t
    let nl = 0; for (let i = 0; i < buf.length; i++) if (buf[i] === 10) nl++
    if (buf.length / Math.max(1, nl) > 300 || buf.subarray(0, 8000).includes(0)) { out.push([rel, 'skip']); continue }
    const { L, q } = await lang(g); parser.setLanguage(L)
    t = performance.now(); const tree = parser.parse(buf.toString()); parseMs += performance.now() - t
    t = performance.now(); const caps = q.captures(tree.rootNode); const defs = []; const refs = new Map(); const imps = []
    for (const c of caps) { const n = c.name; if (n === 'name') defs.push([c.node.text, c.node.startPosition.row + 1]); else if (n.startsWith('ref.')) { const k = c.node.text; refs.set(k, (refs.get(k) ?? 0) + 1) } else if (n.startsWith('import.')) imps.push(c.node.text) }
    queryMs += performance.now() - t
    tree.delete()
    out.push([rel, h.toString(16), defs, [...refs], imps])
  }
  parentPort.postMessage({ out, readMs, parseMs, queryMs })
})
