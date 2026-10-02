// usage: bun sqlite-bench.mjs   |  node sqlite-bench.mjs
import fs from 'node:fs'
const isBun = typeof Bun !== 'undefined'
let DB
if (isBun) DB = (await import('bun:sqlite')).Database
else DB = (await import('node:sqlite')).DatabaseSync
const rt = isBun ? 'bun ' + Bun.version : 'node ' + process.versions.node
const path = '/tmp/mitori-bench.sqlite'
for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(path + s) } catch {}
const t = () => performance.now()
let t0 = t()
const db = new DB(path)
const openMs = t() - t0
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')
db.exec(`CREATE TABLE blocks(id INTEGER PRIMARY KEY, doc TEXT, path TEXT, hash TEXT, line INT, body TEXT);
CREATE INDEX blocks_doc ON blocks(doc, path);
CREATE VIRTUAL TABLE blocks_fts USING fts5(body, content='blocks', content_rowid='id', tokenize='trigram');`)
const words = fs.readFileSync('corpus/crit-go.txt', 'utf8').split('\n').slice(0, 40).map(f => fs.readFileSync(f, 'utf8')).join('\n').split(/\n\n+/)
const N = 100000
t0 = t()
const ins = db.prepare('INSERT INTO blocks(doc,path,hash,line,body) VALUES (?,?,?,?,?)')
db.exec('BEGIN')
for (let i = 0; i < N; i++) ins.run('d' + (i % 50), 'p/' + (i % 5000), 'h' + i, i, words[i % words.length])
db.exec('COMMIT')
const insMs = t() - t0
t0 = t()
db.exec("INSERT INTO blocks_fts(rowid, body) SELECT id, body FROM blocks")
const ftsMs = t() - t0
// point lookups
const get = db.prepare('SELECT * FROM blocks WHERE id=?')
t0 = t(); for (let i = 0; i < 100000; i++) get.get((i * 7919) % N + 1); const getMs = t() - t0
// range
const rng = db.prepare('SELECT count(*) c FROM blocks WHERE doc=? AND path=?')
t0 = t(); for (let i = 0; i < 20000; i++) rng.get('d' + (i % 50), 'p/' + (i % 5000)); const rngMs = t() - t0
// fts queries
const q = db.prepare("SELECT rowid FROM blocks_fts WHERE blocks_fts MATCH ? LIMIT 20")
const terms = ['func', 'http', 'comment', 'Server', 'review', 'session', 'handler', 'json']
t0 = t(); for (let i = 0; i < 2000; i++) q.all('"' + terms[i % terms.length] + '"'); const ftsQMs = t() - t0
// small tx write latency (autosave of a comment)
const upd = db.prepare('UPDATE blocks SET body=? WHERE id=?')
t0 = t(); for (let i = 0; i < 2000; i++) upd.run('x' + i, i + 1); const txMs = t() - t0
console.log(JSON.stringify({ rt, rows: N, openMs: +openMs.toFixed(1), insert100kTxMs: +insMs.toFixed(0), ftsTrigramBuildMs: +ftsMs.toFixed(0), pointGet100kMs: +getMs.toFixed(0), range20kMs: +rngMs.toFixed(0), fts2000QueriesMs: +ftsQMs.toFixed(0), autocommit2000UpdMs: +txMs.toFixed(0), dbMB: +(fs.statSync(path).size / 1048576).toFixed(1) }))
