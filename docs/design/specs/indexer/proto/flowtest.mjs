import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const SP = '/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad', NM = SP + '/bench-stack/node_modules'
const { Parser, Language } = await import(NM + '/web-tree-sitter/web-tree-sitter.js'); await Parser.init()
const G = { js: 'tree-sitter-javascript/tree-sitter-javascript.wasm', tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm', ts: 'tree-sitter-typescript/tree-sitter-typescript.wasm' }
const L = {}; for (const [k, v] of Object.entries(G)) L[k] = await Language.load(fs.readFileSync(path.join(NM, v)))
const p = new Parser(); const repo = SP + '/corpus/react'
const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(f => /\.js$/.test(f))
const errNodes = (t) => { let n = 0; const c = t.walk(); const visit = () => { do { if (c.nodeType === 'ERROR' || c.nodeIsMissing) n++; if (c.gotoFirstChild()) { visit(); c.gotoParent() } } while (c.gotoNextSibling()) }; visit(); return n }
const R = { flow: { n: 0, js: 0, tsx: 0, ts: 0 }, noflow: { n: 0, js: 0, tsx: 0 } }
for (const f of files) {
  const s = fs.readFileSync(path.join(repo, f), 'utf8'); if (s.length > 2e6) continue
  const flow = /@flow\b/.test(s.slice(0, 2048)); const g = flow ? R.flow : R.noflow; g.n++
  for (const k of flow ? ['js', 'tsx', 'ts'] : ['js', 'tsx']) { p.setLanguage(L[k]); const t = p.parse(s); if (t.rootNode.hasError) g[k]++; t.delete() }
}
console.log(JSON.stringify(R))
