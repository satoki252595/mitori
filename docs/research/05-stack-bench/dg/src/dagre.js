import dagre from '@dagrejs/dagre'
import { paint, med, graph, svgFromLayout } from './common.js'
window.__t = async (sizes = [20, 100, 300, 1000]) => {
  const out = { runs: [] }
  for (const n of sizes) {
    const g = graph(n); const L = [], R = []; let svgKB = 0
    for (let i = 0; i < 3; i++) { let s = performance.now(); const d = new dagre.graphlib.Graph(); d.setGraph({ rankdir: 'LR' }); d.setDefaultEdgeLabel(() => ({})); for (const x of g.nodes) d.setNode(x.id, { width: x.w, height: x.h }); for (const [a, b] of g.edges) d.setEdge('n' + a, 'n' + b); dagre.layout(d); L.push(performance.now() - s)
      s = performance.now(); const nodes = d.nodes().map(id => { const p = d.node(id); return { id, x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height } }); const edges = d.edges().map(e => ({ pts: d.edge(e).points })); const svg = svgFromLayout(nodes, edges); document.getElementById('host').replaceChildren(svg); await paint(); R.push(performance.now() - s); svgKB = Math.round(svg.outerHTML.length / 1024) }
    out.runs.push({ nodes: n, layoutMedianMs: +med(L).toFixed(0), svgBuildPaintMedianMs: +med(R).toFixed(0), svgKB })
  }
  return out
}
