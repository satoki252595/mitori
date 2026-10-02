import fs from 'node:fs'
import { ADAPTERS } from './parsers.mjs'
const f = '../refs/crit/web/mermaid.min.js'; const src = fs.readFileSync(f, 'utf8')
for (const name of ['wts', 'native', 'astgrep', 'oxc', 'tsc']) {
  const a = ADAPTERS[name](); await a.init()
  const run = () => { const t = performance.now(); const h = a.parse('js', f, src); const n = a.extract(h, 'js', src).length; a.free(h); return [performance.now() - t, n] }
  run(); const r = [run(), run(), run()].sort((x, y) => x[0] - y[0])[1]
  console.log(name.padEnd(8), 'mermaid.min.js', (src.length / 1048576).toFixed(1) + 'MB', r[0].toFixed(0) + 'ms', 'top-level syms', r[1])
}
process.exit(0)
