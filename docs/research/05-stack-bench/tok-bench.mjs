import fs from 'node:fs'
import { encode as encO200k } from 'gpt-tokenizer/encoding/o200k_base'
const rt = typeof Bun !== 'undefined' ? 'bun' : 'node'
const ja = `mitori は、リポジトリ全体を一度だけ読み込み、人間が読みやすい設計書を生成します。設計書上のレビューコメントは、該当するコードの箇所に対して AI エージェントが修正を行います。初めての人でも全体像が分かり、詳しい人は細部まで議論できます。`.repeat(200)
const sets = {
  'Go (crit)': fs.readFileSync('corpus/crit-go.txt', 'utf8').split('\n').filter(Boolean).slice(0, 120).map(f => fs.readFileSync(f, 'utf8')).join('\n'),
  'TS (hono)': fs.readFileSync('corpus/hono-ts.txt', 'utf8').split('\n').filter(Boolean).slice(0, 150).map(f => fs.readFileSync(f, 'utf8')).join('\n'),
  'English md (crit docs)': fs.readdirSync('../refs/crit/docs', { recursive: true }).filter(f => f.endsWith('.md')).map(f => fs.readFileSync('../refs/crit/docs/' + f, 'utf8')).join('\n').slice(0, 400000) || '',
  'Japanese prose': ja,
}
for (const [k, s] of Object.entries(sets)) {
  if (!s) continue
  const bytes = Buffer.byteLength(s), chars = s.length
  let n = 0; const t0 = performance.now(); n = encO200k(s).length; const ms = performance.now() - t0
  const t1 = performance.now(); n = encO200k(s).length; const ms2 = performance.now() - t1
  console.log(rt, k.padEnd(24), 'bytes', bytes, 'chars', chars, 'o200k tokens', n, 'bytes/token', (bytes / n).toFixed(2), 'chars/token', (chars / n).toFixed(2), 'encode', ms2.toFixed(0) + 'ms', (bytes / 1048576 / (ms2 / 1000)).toFixed(1) + ' MB/s')
}
