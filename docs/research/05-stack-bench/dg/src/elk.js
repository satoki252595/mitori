import ELK from 'elkjs/lib/elk.bundled.js'
import { paint, med, graph, svgFromLayout } from './common.js'
window.__t = async (sizes = [20, 100, 300, 1000]) => {
  const elk = new ELK(); const out = { runs: [] }
  for (const n of sizes) {
    const g = graph(n); const input = () => ({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL' }, children: g.nodes.map(x => ({ id: x.id, width: x.w, height: x.h })), edges: g.edges.map(([a, b], i) => ({ id: 'e' + i, sources: ['n' + a], targets: ['n' + b] })) })
    const L = [], R = []; let svgKB = 0, nodesN = 0
    for (let i = 0; i < 3; i++) { let s = performance.now(); const res = await elk.layout(input()); L.push(performance.now() - s); s = performance.now(); const nodes = res.children.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.width, h: c.height })); const edges = res.edges.map(e => ({ pts: e.sections ? [e.sections[0].startPoint, ...(e.sections[0].bendPoints || []), e.sections[0].endPoint] : [] })); const svg = svgFromLayout(nodes, edges); document.getElementById('host').replaceChildren(svg); await paint(); R.push(performance.now() - s); svgKB = Math.round(svg.outerHTML.length / 1024) }
    out.runs.push({ nodes: n, layoutMedianMs: +med(L).toFixed(0), svgBuildPaintMedianMs: +med(R).toFixed(0), svgKB })
  }
  return out
}
