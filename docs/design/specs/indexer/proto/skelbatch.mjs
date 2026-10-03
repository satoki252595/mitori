import fs from 'node:fs'; import { execFileSync } from 'node:child_process'
const { render } = await import('./skelfn.mjs')
const repo = process.argv[2]
const files = execFileSync('git', ['ls-files', '-z', '--', 'internal', 'cmd'], { cwd: repo }).toString().split('\0').filter(f => f.endsWith('.go') && !f.endsWith('_test.go'))
let full = 0, fullN = 0; const T = { l0: 0, sig: 0, doc: 0 }
for (const f of files) { const s = fs.readFileSync(repo + '/' + f, 'utf8'); full += s.length; const nl = s.split('\n').length; fullN += s.length + nl * (String(nl).length + 1); for (const t of ['l0', 'sig', 'doc']) T[t] += render(repo, f, t).length }
console.log(JSON.stringify({ files: files.length, fullChars: full, fullNumberedChars: fullN, ...T, sigRatio: +(T.sig / full).toFixed(3), docRatio: +(T.doc / full).toFixed(3), l0Ratio: +(T.l0 / full).toFixed(4), sigTokV5: Math.round(T.sig / 2.3), l0TokV5: Math.round(T.l0 / 2.3) }))
