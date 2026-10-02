// usage: <runtime> parse-bench.mjs <adapter> <corpusName[,corpusName...]> [reps=5] [mode=extract|parse]
import fs from 'node:fs'
import { ADAPTERS, langOf } from './parsers.mjs'

const [adapterName, corpusArg, repsArg = '5', mode = 'extract'] = process.argv.slice(2)
const reps = +repsArg
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
const mb = b => +(b / 1048576).toFixed(1)

const t0 = performance.now()
const adapter = ADAPTERS[adapterName]()
await adapter.init()
const initMs = performance.now() - t0

// load corpus into memory
const files = []
for (const c of corpusArg.split(',')) {
  for (const f of fs.readFileSync(`corpus/${c}.txt`, 'utf8').split('\n').filter(Boolean)) {
    const lang = langOf(f)
    if (!lang || !adapter.supports(lang)) continue
    files.push({ f, lang, src: fs.readFileSync(f, 'utf8') })
  }
}
const bytes = files.reduce((a, x) => a + Buffer.byteLength(x.src), 0)
const rss0 = process.memoryUsage().rss

const GCN = +(process.env.GCEVERY || 0)
const gc = typeof Bun !== 'undefined' ? () => Bun.gc(true) : (globalThis.gc || (() => {}))
function pass() {
  let syms = 0, errs = 0, k = 0
  const t = performance.now()
  for (const x of files) {
    if (GCN && ++k % GCN === 0) gc()
    try {
      const h = adapter.parse(x.lang, x.f, x.src)
      if (mode === 'extract') syms += adapter.extract(h, x.lang, x.src).length
      adapter.free(h)
    } catch (e) { errs++; if (errs === 1) console.error('ERR', x.f, String(e).slice(0, 200)) }
  }
  return { ms: performance.now() - t, syms, errs }
}

const runs = []
for (let i = 0; i < reps; i++) runs.push(pass())
const ms = runs.map(r => r.ms)
const cold = ms[0]
const warm = [...ms.slice(1)].sort((a, b) => a - b)
const med = warm.length ? warm[Math.floor(warm.length / 2)] : cold
const best = warm.length ? warm[0] : cold
const rssPeak = process.memoryUsage().rss
const res = {
  rt, adapter: adapter.name, corpus: corpusArg, mode, files: files.length, MB: mb(bytes), initMs: +initMs.toFixed(0),
  coldMs: +cold.toFixed(0), warmMedMs: +med.toFixed(0), warmBestMs: +best.toFixed(0),
  filesPerSec: Math.round(files.length / (med / 1000)), MBps: +(bytes / 1048576 / (med / 1000)).toFixed(1),
  syms: runs[0].syms, errs: runs[0].errs, rssBaseMB: mb(rss0), rssPeakMB: mb(rssPeak),
}
console.log(JSON.stringify(res))
