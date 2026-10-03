// skeleton prototype (Go subset of specs/indexer.md §7.1 rules). usage: bun skelproto.mjs <repo> <path> <tier>
import fs from 'node:fs'
const SP = '/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad', NM = SP + '/bench-stack/node_modules'
const { Parser, Language, Query } = await import(NM + '/web-tree-sitter/web-tree-sitter.js'); await Parser.init()
const L = await Language.load(fs.readFileSync(NM + '/tree-sitter-go/tree-sitter-go.wasm'))
const q = new Query(L, fs.readFileSync(SP + '/design-tmp/idx/queries/go.scm', 'utf8'))
const [repo, rel, tier] = process.argv.slice(2)
const src = fs.readFileSync(repo + '/' + rel, 'utf8'); const lines = src.split('\n'); if (lines.at(-1) === '') lines.pop()
const p = new Parser(); p.setLanguage(L); const tree = p.parse(src)
const defs = []; const imports = []
for (const m of q.matches(tree.rootNode)) {
  const c = {}; for (const x of m.captures) c[x.name] = x.node
  const dk = Object.keys(c).find(k => k.startsWith('def.'))
  if (dk && c.name) { let nd = c[dk]; const par = nd.parent; if (/^(type|const|var)_spec$/.test(nd.type) && par && par.namedChildren.filter(x => x.type === nd.type).length === 1) nd = par; defs.push({ kind: dk.slice(4), node: nd, name: c.name.text }) }
  if (c['import.source']) imports.push(c['import.source'].text.replace(/"/g, ''))
}
const uniq = new Map(); for (const d of defs) { const k = d.node.startIndex + ':' + d.name; if (!uniq.has(k)) uniq.set(k, d) }
const D = [...uniq.values()].sort((a, b) => a.node.startIndex - b.node.startIndex)
const BODY = { function: 'body', method: 'body' }
const isComment = (n) => n?.type === 'comment'
function docRange(n) { // contiguous preceding comment siblings, no blank line gap
  let s = n.previousSibling, end = n.startPosition.row - 1, first = null
  while (s && isComment(s) && s.endPosition.row === end) { first = s.startPosition.row; end = s.startPosition.row - 1; s = s.previousSibling }
  return first === null ? null : [first + 1, n.startPosition.row]
}
const out = []; const n1 = (i) => `${i}|${lines[i - 1]}`
const blankOrClose = (t) => /^\s*$/.test(t) || /^\s*[)}\]];?,?\s*$/.test(t) || /^\s*\/\//.test(t)
const top = D.filter(d => d.kind !== 'field' && d.kind !== 'package' && !(d.kind === 'method' && d.node.type === 'method_elem'))
if (tier === 'l0') {
  const exp = top.filter(d => /^\p{Lu}/u.test(d.name))
  out.push(`=== ${rel} · go · ${lines.length} lines`)
  for (const d of exp) { const n = d.node; const body = n.childForFieldName('body') ?? n.descendantsOfType(['field_declaration_list', 'interface_type'])[0]; const head = src.slice(n.startIndex, body && d.kind !== 'struct' && d.kind !== 'interface' ? body.startIndex : (body ? body.startIndex : n.endIndex)).replace(/\s+/g, ' ').replace(/[\s{]+$/, '').trim(); out.push('> ' + head.slice(0, 120)) }
  const k = top.length - exp.length; if (k > 0) out.push(`> …+${k} private`)
} else {
  out.push(`=== ${rel} · go · ${lines.length} lines · imports: ${imports.join(' ')} ===`)
  const pk = tree.rootNode.namedChildren.find(c => c.type === 'package_clause'); if (pk) out.push(n1(pk.startPosition.row + 1))
  for (const d of top) {
    const n = d.node, s = n.startPosition.row + 1, e = n.endPosition.row + 1
    if (tier === 'doc') { const r = docRange(n); if (r) for (let i = r[0]; i <= r[1] && i < r[0] + 12; i++) out.push(n1(i)) }
    if (d.kind === 'function' || d.kind === 'method') { const b = n.childForFieldName('body'); const bs = b.startPosition.row + 1; for (let i = s; i <= bs && i < s + 8; i++) out.push(n1(i)); if (b.endPosition.row + 1 > bs) out.push('⋮') }
    else { let k = 0; for (let i = s; i <= e; i++) { if (blankOrClose(lines[i - 1]) && i !== s) continue; if (++k > 60) { out.push(`⋮ +${e - i + 1} lines`); break } out.push(n1(i)) } }
  }
}
tree.delete()
process.stdout.write(out.join('\n') + '\n')
