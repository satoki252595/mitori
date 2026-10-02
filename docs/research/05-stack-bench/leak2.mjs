import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mode = process.argv[2]
const files = fs.readFileSync('corpus/gostd-go.txt','utf8').split('\n').filter(Boolean).slice(0,1000).map(f=>fs.readFileSync(f,'utf8'))
const mb = () => Math.round(process.memoryUsage().rss/1048576)
const gc = typeof Bun !== 'undefined' ? () => Bun.gc(true) : globalThis.gc
let parse
if (mode==='native') { const P = require('tree-sitter'); const p = new P(); p.setLanguage(require('tree-sitter-go')); parse = s => p.parse(s) }
else { const m = require('@ast-grep/napi'); m.registerDynamicLanguage({go: require('@ast-grep/lang-go')}); parse = s => m.parse('go', s) }
const out=[]
for (let r=0;r<5;r++){ for (const s of files) { parse(s) } gc(); await new Promise(r=>setTimeout(r,100)); gc(); out.push(mb()) }
console.log(mode, 'rss after each pass+gc:', out.join(' '))
