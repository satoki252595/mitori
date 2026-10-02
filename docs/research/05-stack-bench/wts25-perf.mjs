import fs from 'node:fs'
const pkg = process.argv[2]
const { Parser, Language } = await import(pkg)
await Parser.init()
const which = process.argv[3] // 'legacy' | 'pkg'
const go = await Language.load(which === 'legacy' ? 'node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm' : 'node_modules/tree-sitter-go/tree-sitter-go.wasm')
const p = new Parser(); p.setLanguage(go)
const files = fs.readFileSync('corpus/gostd-go.txt', 'utf8').split('\n').filter(Boolean).slice(0, 3000).map(f => fs.readFileSync(f, 'utf8'))
const bytes = files.reduce((a, s) => a + s.length, 0)
const run = () => { const t = performance.now(); let n = 0; for (const s of files) { const tr = p.parse(s); n += tr.rootNode.namedChildCount; tr.delete() } return [performance.now() - t, n] }
run(); const a = run(), b = run()
console.log(pkg, which, 'abi', go.abiVersion, 'files', files.length, (bytes / 1048576).toFixed(1) + 'MB', 'ms', Math.round(Math.min(a[0], b[0])), (bytes / 1048576 / (Math.min(a[0], b[0]) / 1000)).toFixed(1) + ' MB/s')
