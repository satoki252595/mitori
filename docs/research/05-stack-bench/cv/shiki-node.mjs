import fs from 'node:fs'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
const doc = fs.readFileSync('public/big5k.ts', 'utf8'); const lines = doc.split('\n')
for (const name of ['js', 'onig']) {
  let t = performance.now()
  const hl = await createHighlighterCore({ themes: [import('@shikijs/themes/github-light')], langs: [import('@shikijs/langs/typescript')], engine: name === 'js' ? createJavaScriptRegexEngine() : createOnigurumaEngine(import('shiki/wasm')) })
  const init = performance.now() - t
  hl.codeToHtml(lines.slice(0, 200).join('\n'), { lang: 'typescript', theme: 'github-light' })
  t = performance.now(); let n = 0
  for (let i = 0; i + 100 <= lines.length; i += 100) { hl.codeToHtml(lines.slice(i, i + 100).join('\n'), { lang: 'typescript', theme: 'github-light' }); n++ }
  const ms = performance.now() - t
  console.log(rt, 'shiki', name, 'init', init.toFixed(0) + 'ms', n, 'x100-line snippets', ms.toFixed(0) + 'ms', (ms / n).toFixed(1) + 'ms/snippet', (doc.length / 1048576 / (ms / 1000)).toFixed(2) + ' MB/s')
}
