import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const m = require('@ast-grep/napi')
m.registerDynamicLanguage({ go: require('@ast-grep/lang-go') })
const rt = typeof Bun !== 'undefined' ? 'bun' : 'node'
const GR = '/opt/homebrew/Cellar/go/1.27.1/libexec/src'
for (const [name, lang, paths, rule] of [
  ['go stdlib: top-level funcs', 'go', [GR], { kind: 'function_declaration' }],
  ['go stdlib: funcs+methods+types', 'go', [GR], { any: [{ kind: 'function_declaration' }, { kind: 'method_declaration' }, { kind: 'type_spec' }] }],
]) {
  for (let i = 0; i < 3; i++) {
    let count = 0
    const t = performance.now()
    const n = await m.findInFiles(lang, { paths, matcher: { rule }, languageGlobs: ['**/*.go'] }, (err, nodes) => { if (!err) count += nodes.length })
    console.log(rt, name, 'files', n, 'matches', count, Math.round(performance.now() - t) + ' ms')
  }
}
