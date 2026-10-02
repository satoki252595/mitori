import fs from 'node:fs'
import MarkdownIt from 'markdown-it'
import { marked } from 'marked'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
// corpus: real markdown (docs from crit + m3e-canvas + CLAUDE.md) repeated + generated JA/EN blocks
const real = ['../refs/crit/README.md', '../refs/crit/AGENTS.md', '../refs/m3e-canvas/README.md', '../refs/m3e-canvas/AGENTS.md'].map(f => fs.readFileSync(f, 'utf8')).join('\n\n')
const gen = (n) => Array.from({ length: n }, (_, i) => i % 10 === 0 ? `## 節 ${i}\n\n` : i % 10 === 5 ? '```ts\nexport function f' + i + '(a: number) { return a + ' + i + ' }\n```\n' : i % 10 === 7 ? `- 項目 A ${i}\n- item **bold** \`code\` [link](https://example.com/${i})\n- 日本語のリスト項目 ${i}\n` : `これは設計書の段落です。**重要**な点は \`${'foo'+i}\` を参照してください。See [docs](https://x.test/${i}).\n`).join('\n')
const docs = { ['real docs (' + (real.length / 1024 | 0) + 'KB)']: real, 'generated 2000 blocks': gen(2000), 'generated 20000 blocks': gen(20000) }
const md = new MarkdownIt({ html: false, linkify: true }); 
const proc = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify)
const impls = {
  'markdown-it': s => md.render(s), 'marked': s => marked.parse(s), 'micromark+gfm': s => micromark(s, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }),
  'remark/rehype': s => String(proc.processSync(s)),
}
if (typeof Bun !== 'undefined') impls['Bun.markdown.html'] = s => Bun.markdown.html(s)
for (const [dn, s] of Object.entries(docs)) {
  const row = []
  for (const [n, f] of Object.entries(impls)) {
    if (n === 'remark/rehype' && s.length > 2_000_000) { row.push(n + ': skipped'); continue }
    f(s); const reps = s.length > 1_000_000 ? 3 : 7; const t = []; let len = 0
    for (let i = 0; i < reps; i++) { const a = performance.now(); len = f(s).length; t.push(performance.now() - a) } t.sort((a, b) => a - b)
    row.push(`${n}: ${t[t.length >> 1].toFixed(1)}ms (${(s.length / 1048576 / (t[t.length >> 1] / 1000)).toFixed(1)}MB/s)`)
  }
  console.log(rt, '|', dn, '\n   ', row.join('\n    '))
}
