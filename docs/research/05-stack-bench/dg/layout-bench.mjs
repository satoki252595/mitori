import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const rt = typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.versions.node
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
function graph(n, deg = 2) { const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, w: 120 + Math.floor(rnd() * 60), h: 36 })); const edges = []; for (let i = 1; i < n; i++) { edges.push([Math.floor(rnd() * i), i]); for (let k = 1; k < deg; k++) if (rnd() < 0.5) edges.push([Math.floor(rnd() * i), i]) } return { nodes, edges } }
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1]
async function timeit(fn, reps = 3) { await fn(); const t = []; for (let i = 0; i < reps; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s) } return Math.round(med(t)) }
let elk
if (typeof Bun !== 'undefined') { const ELKApi = require('elkjs/lib/elk-api.js'); elk = new ELKApi({ workerUrl: new URL('./node_modules/elkjs/lib/elk-worker.min.js', import.meta.url).pathname, workerFactory: (u) => new Worker(u) }) }
else { const ELK = require('elkjs/lib/elk.bundled.js'); elk = new ELK() }
const dagre = require('@dagrejs/dagre')
const sizes = (process.argv[2] || '20,100,300,1000').split(',').map(Number)
for (const n of sizes) {
  const g = graph(n)
  const elkG = () => ({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' }, children: g.nodes.map(x => ({ id: x.id, width: x.w, height: x.h })), edges: g.edges.map(([a, b], i) => ({ id: 'e' + i, sources: ['n' + a], targets: ['n' + b] })) })
  const tElk = await timeit(() => elk.layout(elkG()), n >= 1000 ? 1 : 3)
  const tDagre = await timeit(() => { const d = new dagre.graphlib.Graph(); d.setGraph({ rankdir: 'LR' }); d.setDefaultEdgeLabel(() => ({})); for (const x of g.nodes) d.setNode(x.id, { width: x.w, height: x.h }); for (const [a, b] of g.edges) d.setEdge('n' + a, 'n' + b); dagre.layout(d) }, n >= 1000 ? 1 : 3)
  console.log(rt, 'nodes', n, 'edges', g.edges.length, 'ELK layered', tElk + 'ms', 'dagre', tDagre + 'ms')
}
// D2
try {
  const { D2 } = await import('@terrastruct/d2')
  const d2 = new D2()
  for (const n of [20, 100, 300]) {
    const g = graph(n); const src = g.nodes.map(x => `${x.id}: ${x.id}`).join('\n') + '\n' + g.edges.map(([a, b]) => `n${a} -> n${b}`).join('\n')
    for (const layout of ['dagre', 'elk']) {
      const f = async () => { const r = await d2.compile(src, { layout }); return await d2.render(r.diagram, r.renderOptions) }
      let svg; const t0 = performance.now(); svg = await f(); const first = performance.now() - t0
      const t = []; for (let i = 0; i < 2; i++) { const s = performance.now(); svg = await f(); t.push(performance.now() - s) }
      console.log(rt, 'D2 wasm', layout, 'nodes', n, 'first', Math.round(first) + 'ms', 'warm', Math.round(med(t)) + 'ms', 'svgKB', Math.round(svg.length / 1024))
    }
  }
  await d2.worker?.terminate?.()
} catch (e) { console.log('D2 error', String(e).slice(0, 300)) }
process.exit(0)
