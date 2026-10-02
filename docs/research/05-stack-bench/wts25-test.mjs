import fs from 'node:fs'
import { Parser, Language } from 'wts25'
await Parser.init()
const dir = 'node_modules/tree-sitter-wasms/out'; const ok = [], bad = []
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.wasm'))) { try { const l = await Language.load(dir + '/' + f); ok.push(f.replace('tree-sitter-','').replace('.wasm','') + ':abi' + l.abiVersion) } catch (e) { bad.push(f) } }
console.log('OK', ok.length, ok.join(' ')); console.log('FAILED', bad.length, bad.join(' '))
