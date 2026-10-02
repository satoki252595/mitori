// usage: <rt> watch-bench.mjs <impl: fswatch|parcel> <dir>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const [impl, dir] = process.argv.slice(2)
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
const abs = path.resolve(dir)
const P = process.env.PROBE ?? ''
const waiters = new Map()   // filename -> resolve
const seen = new Set()
let totalEvents = 0
const hit = (name) => { totalEvents++; const b = path.basename(name); seen.add(b); const w = waiters.get(b); if (w) { waiters.delete(b); w(performance.now()) } }
const t0 = performance.now()
let close
if (impl === 'fswatch') {
  const w = fs.watch(abs, { recursive: true }, (ev, name) => { if (name) hit(name) })
  close = () => w.close()
} else {
  const pw = require('@parcel/watcher')
  const sub = await pw.subscribe(abs, (err, events) => { for (const e of events) hit(e.path) }, { ignore: ['**/.git/**'] })
  close = () => sub.unsubscribe()
}
const setupMs = performance.now() - t0
await new Promise(r => setTimeout(r, 500))
// single-write latency
const lat = []
for (let i = 0; i < 40; i++) {
  const name = `__probe_${i}.go`
  const p = new Promise(r => waiters.set(name, r))
  const ts = performance.now()
  fs.writeFileSync(path.join(abs, P, 'net', name), 'package x\n' + i)
  const te = await Promise.race([p, new Promise(r => setTimeout(() => r(-1), 3000))])
  if (te > 0) lat.push(te - ts)
  await new Promise(r => setTimeout(r, 30))
}
lat.sort((a, b) => a - b)
// burst: 2000 files
const BN = 2000
const bs = performance.now()
for (let i = 0; i < BN; i++) fs.writeFileSync(path.join(abs, P, 'os', `__burst_${i}.go`), 'package y\n' + i)
let lastCount = -1
const burstNames = () => { let c = 0; for (let i = 0; i < BN; i++) if (seen.has(`__burst_${i}.go`)) c++; return c }
while (true) { await new Promise(r => setTimeout(r, 50)); const c = burstNames(); if (c === BN || performance.now() - bs > 8000) { lastCount = c; break } }
const burstMs = performance.now() - bs
// cpu idle (user+sys over 2s)
const c0 = process.cpuUsage(); await new Promise(r => setTimeout(r, 2000)); const c1 = process.cpuUsage(c0)
const rss = Math.round(process.memoryUsage().rss / 1048576)
close()
// cleanup
for (let i = 0; i < 40; i++) try { fs.unlinkSync(path.join(abs, P, 'net', `__probe_${i}.go`)) } catch {}
for (let i = 0; i < BN; i++) try { fs.unlinkSync(path.join(abs, P, 'os', `__burst_${i}.go`)) } catch {}
console.log(JSON.stringify({ rt, impl, dir, setupMs: +setupMs.toFixed(1), probes: lat.length, p50ms: +(lat[Math.floor(lat.length / 2)] ?? -1).toFixed(1), p95ms: +(lat[Math.floor(lat.length * .95)] ?? -1).toFixed(1), burst: `${lastCount}/${BN}`, burstMs: Math.round(burstMs), idleCpuMs2s: Math.round((c1.user + c1.system) / 1000), rssMB: rss }))
process.exit(0)
