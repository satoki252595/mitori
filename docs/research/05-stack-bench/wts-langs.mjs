import fs from 'node:fs'
import { Parser, Language } from 'web-tree-sitter'
await Parser.init()
const cands = []
for (const d of fs.readdirSync('node_modules')) if (d.startsWith('tree-sitter-') && d !== 'tree-sitter-wasms') for (const f of fs.readdirSync('node_modules/' + d)) if (f.endsWith('.wasm')) cands.push(`node_modules/${d}/${f}`)
for (const f of fs.readdirSync('node_modules/@vscode/tree-sitter-wasm/wasm')) if (f.endsWith('.wasm') && f !== 'tree-sitter.wasm') cands.push('node_modules/@vscode/tree-sitter-wasm/wasm/' + f)
const ok = [], bad = []
for (const f of cands) { try { const t = performance.now(); const l = await Language.load(f); ok.push([f.replace('node_modules/', ''), l.abiVersion, (fs.statSync(f).size / 1024) | 0, Math.round(performance.now() - t)]) } catch (e) { bad.push(f.replace('node_modules/', '')) } }
console.log('LOAD OK (file, abi, KB, loadMs):'); for (const r of ok) console.log(' ', r.join('  '))
console.log('FAILED:', bad.join(', '))
