import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseSync } = require('oxc-parser')
const rt = typeof Bun !== 'undefined' ? 'bun' : 'node'
const files = ['crit-ts','m3e-ts','hono-ts'].flatMap(c => fs.readFileSync(`corpus/${c}.txt`,'utf8').split('\n').filter(Boolean)).map(f => [f, fs.readFileSync(f,'utf8')])
const bytes = files.reduce((a,[,s])=>a+s.length,0)
function run(label, fn) { fn(); const t=[]; for(let i=0;i<7;i++){const s=performance.now(); fn(); t.push(performance.now()-s)} t.sort((a,b)=>a-b); console.log(rt, label.padEnd(34), Math.round(t[3])+' ms', (bytes/1048576/(t[3]/1000)).toFixed(0)+' MB/s') }
run('parse only (no getter)', () => { for (const [f,s] of files) parseSync(f,s) })
run('parse + module (imports/exports)', () => { let n=0; for (const [f,s] of files) { const r = parseSync(f,s); n += r.module.staticImports.length + r.module.staticExports.length } })
run('parse + full program (JSON)', () => { for (const [f,s] of files) parseSync(f,s).program.body.length })
if (rt==='node') { run('lazy + body.length', () => { for (const [f,s] of files) { const r = parseSync(f,s,{experimentalLazy:true}); r.program.body.length; r.dispose() } }) }
