// usage: bun pipeline.mjs <repo> <workers> ; runs cold, warm(no change), warm(1 file changed)
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { Database } from 'bun:sqlite'
import { execFileSync } from 'node:child_process'
const repo = path.resolve(process.argv[2]); const NW = +(process.argv[3] ?? 8)
const dbPath = '/tmp/mitori-pipeline.sqlite'; for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + s) } catch {}
const EXTS = /\.(go|ts|tsx|mts|cts|js|mjs|cjs|jsx)$/
const T = {}
const tick = (k, t0) => (T[k] = +(performance.now() - t0).toFixed(1))
const startAll = performance.now()
// --- init workers (once)
let t = performance.now()
const workers = Array.from({ length: NW }, () => new Worker(new URL('./pworker.mjs', import.meta.url), { workerData: { root: path.dirname(new URL(import.meta.url).pathname) } }))
await Promise.all(workers.map(w => new Promise(r => w.once('message', r))))
tick('workerInitMs', t)
t = performance.now()
const db = new Database(dbPath); db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE files(path TEXT PRIMARY KEY, size INT, mtime REAL, hash TEXT, syms TEXT)')
tick('dbOpenMs', t)
async function scan(label) {
  const R = { label }
  let t0 = performance.now()
  const all = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(f => f && EXTS.test(f))
  R.lsFilesMs = +(performance.now() - t0).toFixed(1); R.files = all.length
  t0 = performance.now()
  const st = new Map(); for (const f of all) { try { const s = fs.statSync(path.join(repo, f)); if (s.size < 2_000_000) st.set(f, [s.size, s.mtimeMs]) } catch {} }
  R.statMs = +(performance.now() - t0).toFixed(1)
  t0 = performance.now()
  const cache = new Map(db.query('SELECT path,size,mtime,hash FROM files').all().map(r => [r.path, r]))
  R.cacheLoadMs = +(performance.now() - t0).toFixed(1)
  const todo = []; for (const [f, [size, mt]] of st) { const c = cache.get(f); if (!c || c.size !== size || c.mtime !== mt) todo.push(f) }
  R.changedByStat = todo.length
  // size-sorted round robin
  t0 = performance.now()
  todo.sort((a, b) => st.get(b)[0] - st.get(a)[0])
  const buckets = Array.from({ length: NW }, () => []); todo.forEach((f, i) => buckets[i % NW].push(f))
  const results = await Promise.all(workers.map((w, i) => buckets[i].length ? new Promise(r => { w.once('message', r); w.postMessage({ type: 'job', id: i, repo, files: buckets[i] }) }) : { res: [], readMs: 0, parseMs: 0 }))
  R.workersWallMs = +(performance.now() - t0).toFixed(1)
  R.sumReadHashMs = +results.reduce((a, r) => a + r.readMs, 0).toFixed(0); R.sumParseMs = +results.reduce((a, r) => a + r.parseMs, 0).toFixed(0)
  t0 = performance.now()
  const up = db.prepare('INSERT OR REPLACE INTO files(path,size,mtime,hash,syms) VALUES (?,?,?,?,?)')
  let nsym = 0, reparsed = 0
  db.exec('BEGIN'); for (const r of results) for (const [f, h, syms] of r.res) { const [size, mt] = st.get(f); const c = cache.get(f); if (c && c.hash === h) { up.run(f, size, mt, h, null); continue }; up.run(f, size, mt, h, syms ? JSON.stringify(syms) : null); if (syms) { nsym += syms.length; reparsed++ } } db.exec('COMMIT')
  R.dbWriteMs = +(performance.now() - t0).toFixed(1); R.symbols = nsym
  R.totalMs = +(R.lsFilesMs + R.statMs + R.cacheLoadMs + R.workersWallMs + R.dbWriteMs).toFixed(1)
  return R
}
const out = []
out.push(await scan('cold (empty cache)'))
out.push(await scan('warm (nothing changed)'))
// touch one file with real change
const victim = execFileSync('git', ['ls-files', '-z'], { cwd: repo }).toString().split('\0').find(f => EXTS.test(f))
const orig = fs.readFileSync(path.join(repo, victim), 'utf8'); fs.writeFileSync(path.join(repo, victim), orig + '\n// edit\n')
out.push(await scan('warm (1 file edited)'))
fs.writeFileSync(path.join(repo, victim), orig)
console.log(JSON.stringify({ repo: path.basename(repo), workers: NW, init: T, scans: out }, null, 0))
process.exit(0)
