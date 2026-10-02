import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
const root = path.resolve(process.argv[2])
const t = (label, fn, n = 5) => { fn(); const a = []; for (let i = 0; i < n; i++) { const s = performance.now(); const r = fn(); a.push(performance.now() - s); if (i === n - 1) { a.sort((x, y) => x - y); console.log(rt.padEnd(12), label.padEnd(44), a[Math.floor(n / 2)].toFixed(1).padStart(8), 'ms', r !== undefined ? '(' + r + ')' : '') } } }
t('git ls-files', () => execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean).length)
t('git ls-files + status --porcelain', () => { execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 }); return execFileSync('git', ['status', '--porcelain'], { cwd: root }).length })
t('rg --files', () => execFileSync('rg', ['--files', '-0'], { cwd: root, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean).length)
t('fs.readdirSync recursive', () => fs.readdirSync(root, { recursive: true }).length)
function walk(d, out) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = d + '/' + e.name; if (e.isDirectory()) walk(p, out); else out.push(p) } return out }
t('manual walk (withFileTypes)', () => walk(root, []).length)
if (typeof Bun !== 'undefined') t('Bun.Glob scanSync **/*', () => { let n = 0; for (const _ of new Bun.Glob('**/*').scanSync({ cwd: root, onlyFiles: true })) n++; return n })
const files = walk(root, [])
t('stat all (mtime+size)', () => { let s = 0; for (const f of files) s += fs.statSync(f).size; return Math.round(s / 1048576) + 'MB' })
let bytes = 0
t('read all files (readFileSync)', () => { bytes = 0; for (const f of files) bytes += fs.readFileSync(f).length; return Math.round(bytes / 1048576) + 'MB' })
const bufs = files.map(f => fs.readFileSync(f))
const MB = bufs.reduce((a, b) => a + b.length, 0) / 1048576
const hh = (label, fn) => t(`hash ${label} (${MB.toFixed(0)}MB in-mem)`, () => { fn() }, 5)
hh('crypto sha256', () => { for (const b of bufs) crypto.createHash('sha256').update(b).digest('hex') })
hh('crypto sha1', () => { for (const b of bufs) crypto.createHash('sha1').update(b).digest('hex') })
hh('crypto md5', () => { for (const b of bufs) crypto.createHash('md5').update(b).digest('hex') })
if (typeof Bun !== 'undefined') {
  hh('Bun.hash (wyhash)', () => { for (const b of bufs) Bun.hash(b) })
  hh('Bun.hash.xxHash64', () => { for (const b of bufs) Bun.hash.xxHash64(b) })
  hh('Bun.hash.xxHash3', () => { for (const b of bufs) Bun.hash.xxHash3(b) })
  hh('Bun.CryptoHasher blake3', () => { for (const b of bufs) new Bun.CryptoHasher('blake3').update(b).digest('hex') })
  hh('Bun.CryptoHasher sha256', () => { for (const b of bufs) new Bun.CryptoHasher('sha256').update(b).digest('hex') })
}
