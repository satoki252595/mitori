import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const SP = '/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad', NM = SP + '/bench-stack/node_modules', Q = SP + '/design-tmp/idx/queries/facts'
const { Parser, Language, Query } = await import(NM + '/web-tree-sitter/web-tree-sitter.js'); await Parser.init()
const C = { typescript: ['tree-sitter-typescript/tree-sitter-typescript.wasm', 'js-routes-env.scm', /\.[cm]?ts$/], tsx: ['tree-sitter-typescript/tree-sitter-tsx.wasm', 'js-routes-env.scm', /\.tsx$/], javascript: ['tree-sitter-javascript/tree-sitter-javascript.wasm', 'js-routes-env.scm', /\.[cm]?jsx?$/], python: ['tree-sitter-python/tree-sitter-python.wasm', 'py-routes-env.scm', /\.py$/], go: ['tree-sitter-go/tree-sitter-go.wasm', 'go-routes-env.scm', /\.go$/], rust: ['tree-sitter-rust/tree-sitter-rust.wasm', 'rust-routes-env.scm', /\.rs$/] }
const HTTP = /^(get|post|put|patch|delete|head|options|all|any|on|route|use|handlefunc|handle|group|mount|nest|resource|scope|service|api_route|add_url_rule|add_api_route|path|re_path|url|method|methodfunc|add_api_websocket_route|websocket|connect|trace)$/i
const [lang, repoRel, onlyRe] = process.argv.slice(2); const [w, qf, ext] = C[lang]; const repo = SP + '/' + repoRel
const L = await Language.load(fs.readFileSync(path.join(NM, w))); let q; try { q = new Query(L, fs.readFileSync(path.join(Q, qf), 'utf8')) } catch (e) { console.log(lang, 'COMPILE ERROR', e.message); process.exit(1) }
const p = new Parser(); p.setLanguage(L)
const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(f => f && ext.test(f) && (!onlyRe || new RegExp(onlyRe).test(f)) && !/(^|\/)(node_modules|vendor|fixtures)\//.test(f))
const R = { routes: 0, routePathOk: 0, env: new Set(), cli: 0, tests: 0, entry: 0 }; const ex = []
for (const f of files) {
  const s = fs.readFileSync(path.join(repo, f), 'utf8'); if (s.length > 2e6) continue
  const t = p.parse(s)
  for (const m of q.matches(t.rootNode)) {
    const cap = Object.fromEntries(m.captures.map(c => [c.name, c.node]))
    if (cap['route.path'] && cap['route.method']) { const meth = cap['route.method'].text, pth = cap['route.path'].text.replace(/^[rbuf]*["'`]+|["'`]+$/g, ''); if (HTTP.test(meth) && /^(\/|\*|[A-Z]+ \/|\^|[a-z0-9_<>{}:.-]+\/)/.test(pth)) { R.routes++; if (ex.length < 6 && Math.random() < 0.1) ex.push(`${f}:${cap['route.method'].startPosition.row + 1} ${meth} ${pth}`) } }
    if (cap['env.name']) R.env.add(cap['env.name'].text.replace(/["']/g, ''))
    if (cap['cli.use'] || cap['cli.reg'] || cap['cli.case'] || cap['cli.arg'] || cap['cli.attr']) R.cli++
    if (cap['test.name'] || cap['test.attr']) R.tests++
    if (cap['entry.main']) R.entry++
  }
  t.delete()
}
console.log(JSON.stringify({ lang, repo: repoRel, files: files.length, routes: R.routes, envUnique: R.env.size, envSample: [...R.env].slice(0, 8), cliCandidates: R.cli, testCandidates: R.tests, mains: R.entry, routeSamples: ex }))
