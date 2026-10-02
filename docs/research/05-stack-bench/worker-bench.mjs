// usage: <rt> worker-bench.mjs <adapter> <corpus> <nWorkers>
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import { ADAPTERS, langOf } from './parsers.mjs'
const [adapterName, corpus, nW] = process.argv.slice(2)
const N = +nW
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
const probe = ADAPTERS[adapterName](); // for supports() only (no init needed for supports? needs init) 
const supportsGo = !['oxc', 'tsc'].includes(adapterName)
let files = []
for (const c of corpus.split(',')) for (const f of fs.readFileSync(`corpus/${c}.txt`, 'utf8').split('\n').filter(Boolean)) { const l = langOf(f); if (!l || (l === 'go' && !supportsGo)) continue; files.push([f, fs.statSync(f).size]) }
files.sort((a, b) => b[1] - a[1])
const buckets = Array.from({ length: N }, () => ({ files: [], size: 0 }))
for (const [f, s] of files) { const b = buckets.reduce((m, x) => x.size < m.size ? x : m); b.files.push(f); b.size += s }
const t0 = performance.now()
const workers = buckets.map(() => new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { adapter: adapterName } }))
await Promise.all(workers.map(w => new Promise(r => w.once('message', r))))
const t1 = performance.now()
const results = await Promise.all(workers.map((w, i) => new Promise(r => { w.once('message', r); w.postMessage({ type: 'go', files: buckets[i].files }) })))
const t2 = performance.now()
const rss = process.memoryUsage().rss
workers.forEach(w => w.terminate())
const syms = results.reduce((a, r) => a + r.syms, 0), n = results.reduce((a, r) => a + r.n, 0)
const maxMs = Math.max(...results.map(r => r.ms)), minMs = Math.min(...results.map(r => r.ms))
console.log(JSON.stringify({ rt, adapter: adapterName, corpus, workers: N, files: n, syms, initWallMs: Math.round(t1 - t0), workWallMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0), filesPerSec: Math.round(n / ((t2 - t1) / 1000)), slowestWorkerMs: Math.round(maxMs), fastestWorkerMs: Math.round(minMs), rssMB: Math.round(rss / 1048576) }))
process.exit(0)
