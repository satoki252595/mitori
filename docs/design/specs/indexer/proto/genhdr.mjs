import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const COMMENT = /^\s*(\/\/+|#+|\/\*+|\*+|<!--|--|;+|%+|"""|''')\s?/
const STRONG = [/^\/\/ Code generated .* DO NOT EDIT\.$/, /@generated\b/, /\b(this|the) (file|code) (is|was|has been) (automatically |auto-|machine[- ])?generated\b/i, /^(auto-?generated|automatically generated|generated) (file|code|by|from|with|using)\b/i, /\bgenerated\b.*\bdo not (edit|modify)\b|\bdo not (edit|modify)\b.*\bgenerated\b/i]
for (const repo of process.argv.slice(2)) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(f => f && /\.(go|[cm]?[jt]sx?|py|rs|txt|toml|ya?ml|json)$/.test(f))
  const hits = []
  for (const f of files) {
    let fd; try { fd = fs.openSync(path.join(repo, f), 'r') } catch { continue }
    const b = Buffer.alloc(1024); const n = fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd)
    const lines = b.subarray(0, n).toString().split('\n').slice(0, 5)
    for (const l of lines) { if (!COMMENT.test(l)) continue; const body = l.replace(COMMENT, ''); if (STRONG.some(r => r.test(l.trim()) || r.test(body.trim()))) { hits.push(f + ' | ' + l.trim().slice(0, 80)); break } }
  }
  console.log(path.basename(repo), hits.length); for (const h of hits.slice(0, 12)) console.log('   ', h)
}
