import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import { ADAPTERS, langOf } from './parsers.mjs'
const adapter = ADAPTERS[workerData.adapter]()
await adapter.init()
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', (m) => {
  if (m.type !== 'go') return
  let syms = 0, n = 0, bytes = 0
  const t = performance.now()
  for (const f of m.files) {
    const lang = langOf(f); if (!lang || !adapter.supports(lang)) continue
    const src = fs.readFileSync(f, 'utf8'); bytes += src.length
    const h = adapter.parse(lang, f, src)
    syms += adapter.extract(h, lang, src).length
    adapter.free(h); n++
  }
  parentPort.postMessage({ type: 'done', syms, n, bytes, ms: performance.now() - t })
})
