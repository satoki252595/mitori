// usage: bun s1bench.mjs <repo> [workers|auto]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { Worker } from 'node:worker_threads'; import { execFileSync } from 'node:child_process'
const SP = '/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad'
const repo = path.resolve(process.argv[2]); const arg = process.argv[3] ?? 'auto'
const EXT = [[/\.tsx$/, 'tsx'], [/\.[cm]?ts$/, 'typescript'], [/\.(jsx|[cm]?js)$/, 'javascript'], [/\.pyi?$/, 'python'], [/\.go$/, 'go'], [/\.rs$/, 'rust']]
const SKIP = /(^|\/)(node_modules|vendor|third_party|dist|testdata|fixtures?|__fixtures__|__snapshots__|\.github\/workflows|\.claude)\//
let peak = 0; const iv = setInterval(() => { const r = process.memoryUsage().rss; if (r > peak) peak = r }, 5)
const T0 = performance.now()
const ls = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean)
const tLs = performance.now() - T0
const todo = []; let MB = 0
for (const l of ls) { const [meta, p] = l.split('\t'); if (meta.startsWith('160000') || meta.startsWith('120000') || SKIP.test(p) || /\.min\.js$/.test(p)) continue; const e = EXT.find(([re]) => re.test(p)); if (!e) continue; let g = e[1]; const s = fs.statSync(path.join(repo, p)).size; if (s > 2 * 1048576) continue; if (g === 'javascript' && s > 0) { const fd = fs.openSync(path.join(repo, p), 'r'); const b = Buffer.alloc(2048); fs.readSync(fd, b, 0, 2048, 0); fs.closeSync(fd); if (/@flow\b/.test(b.toString())) g = 'tsx' } todo.push([p, g, s]); MB += s / 1048576 }
const tStat = performance.now() - T0 - tLs
const cores = os.availableParallelism()
const NW = arg === 'auto' ? Math.max(1, Math.min(Math.ceil(MB / 2), Math.min(8, cores - 2))) : +arg
const t1 = performance.now()
const workers = Array.from({ length: NW }, () => new Worker(SP + '/design-tmp/idx/s1worker.mjs', { workerData: { nm: SP + '/bench-stack/node_modules', qd: SP + '/design-tmp/idx/queries' } }))
await Promise.all(workers.map(w => new Promise(r => w.once('message', r))))
const tInit = performance.now() - t1
todo.sort((a, b) => b[2] - a[2])
// dynamic LPT queue, batches of <=64 files or <=1MiB
const TB = Math.min(1048576, Math.max(32768, (MB * 1048576) / (NW * 8))); const batches = []; let cur = [], curB = 0
for (const f of todo) { cur.push([f[0], f[1]]); curB += f[2]; if (cur.length >= 64 || curB >= TB) { batches.push(cur); cur = []; curB = 0 } } if (cur.length) batches.push(cur)
let bi = 0, files = 0, defs = 0, sumRead = 0, sumParse = 0, sumQuery = 0
const t2 = performance.now()
await Promise.all(workers.map(w => (async () => { while (bi < batches.length) { const b = batches[bi++]; const r = await new Promise(res => { w.once('message', res); w.postMessage({ repo, files: b }) }); sumRead += r.readMs; sumParse += r.parseMs; sumQuery += r.queryMs; for (const o of r.out) { files++; if (o[2]) defs += o[2].length } } })()))
const tWork = performance.now() - t2
clearInterval(iv)
console.log(JSON.stringify({ repo: path.basename(repo), cores, workers: NW, files: todo.length, MB: +MB.toFixed(1), lsMs: Math.round(tLs), statMs: Math.round(tStat), initMs: Math.round(tInit), workMs: Math.round(tWork), totalMs: Math.round(performance.now() - T0), sumReadMs: Math.round(sumRead), sumParseMs: Math.round(sumParse), sumQueryMs: Math.round(sumQuery), defs, peakRssMB: Math.round(peak / 1048576) }))
for (const w of workers) w.terminate()
