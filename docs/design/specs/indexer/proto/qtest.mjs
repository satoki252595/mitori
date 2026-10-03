// usage: bun qtest.mjs <lang> <repoDir> [maxFiles]
// Compiles mitori tags query for <lang>, runs on tracked files of repoDir, prints capture stats.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const SP = '/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad'
const NM = SP + '/bench-stack/node_modules'
const { Parser, Language, Query } = await import(NM + '/web-tree-sitter/web-tree-sitter.js')
await Parser.init()
const Q = SP + '/design-tmp/idx/queries'
const CFG = {
  typescript: { wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm', q: ['typescript.scm'], ext: /\.(ts|mts|cts)$/ },
  tsx: { wasm: 'tree-sitter-typescript/tree-sitter-tsx.wasm', q: ['typescript.scm', 'tsx-addendum.scm'], ext: /\.tsx$/ },
  javascript: { wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm', q: ['javascript.scm'], ext: /\.(js|mjs|cjs|jsx)$/ },
  python: { wasm: 'tree-sitter-python/tree-sitter-python.wasm', q: ['python.scm'], ext: /\.(py|pyi)$/ },
  go: { wasm: 'tree-sitter-go/tree-sitter-go.wasm', q: ['go.scm'], ext: /\.go$/ },
  rust: { wasm: 'tree-sitter-rust/tree-sitter-rust.wasm', q: ['rust.scm'], ext: /\.rs$/ },
}
const lang = process.argv[2], repo = path.resolve(process.argv[3]), max = +(process.argv[4] ?? 1e9)
const c = CFG[lang]
const L = await Language.load(fs.readFileSync(path.join(NM, c.wasm)))
const src = c.q.map(f => fs.readFileSync(path.join(Q, f), 'utf8')).join('\n')
let query
try { query = new Query(L, src) } catch (e) { console.log(JSON.stringify({ lang, compileError: String(e.message ?? e) })); process.exit(1) }
const parser = new Parser(); parser.setLanguage(L)
const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0')
  .filter(f => f && c.ext.test(f) && !/(^|\/)(node_modules|vendor|dist)\//.test(f) && !f.endsWith('.d.ts') || (lang === 'typescript' && f.endsWith('.d.ts') && false)).slice(0, max)
const counts = {}; let parseMs = 0, queryMs = 0, bytes = 0, errFiles = 0, skipped = 0, n = 0
const samples = {}
for (const f of files) {
  let s; try { s = fs.readFileSync(path.join(repo, f), 'utf8') } catch { continue }
  if (s.length > 2_000_000) { skipped++; continue }
  const avg = s.length / (1 + (s.match(/\n/g)?.length ?? 0)); if (avg > 300) { skipped++; continue }
  bytes += s.length; n++
  let t = performance.now(); const tree = parser.parse(s); parseMs += performance.now() - t
  if (tree.rootNode.hasError) errFiles++
  t = performance.now(); const caps = query.captures(tree.rootNode); queryMs += performance.now() - t
  for (const cap of caps) {
    if (cap.name.startsWith('_')) continue
    counts[cap.name] = (counts[cap.name] ?? 0) + 1
    if (cap.name === 'name' || cap.name.startsWith('import') || cap.name.startsWith('export') || cap.name.startsWith('doc')) {
      const arr = (samples[cap.name] ??= []); if (arr.length < 4 && Math.random() < 0.05) arr.push(`${f}:${cap.node.startPosition.row + 1} ${cap.node.text.slice(0, 60).replace(/\n/g, '⏎')}`)
    }
  }
  tree.delete()
}
console.log(JSON.stringify({ lang, repo: path.basename(repo), files: n, skipped, MB: +(bytes / 1048576).toFixed(2), errFiles, parseMs: Math.round(parseMs), queryMs: Math.round(queryMs), parseMBps: +((bytes / 1048576) / (parseMs / 1000)).toFixed(1), queryMBps: +((bytes / 1048576) / (queryMs / 1000)).toFixed(1), counts, samples }, null, 1))
