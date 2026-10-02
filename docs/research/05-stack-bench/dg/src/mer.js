import { paint, med, graph } from './common.js'
window.__t = async (sizes = [20, 100, 300]) => {
  let t = performance.now(); const mermaid = (await import('mermaid')).default; const importMs = performance.now() - t
  t = performance.now(); mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: false } }); const initMs = performance.now() - t
  const out = { importMs: +importMs.toFixed(0), initMs: +initMs.toFixed(0), runs: [] }
  for (const n of sizes) {
    const g = graph(n); const src = 'flowchart LR\n' + g.nodes.map(x => `${x.id}["${x.id}"]`).join('\n') + '\n' + g.edges.map(([a, b]) => `n${a} --> n${b}`).join('\n')
    const times = []; let svgKB = 0
    for (let i = 0; i < 3; i++) { const s = performance.now(); const { svg } = await mermaid.render('m' + n + '_' + i, src); const host = document.getElementById('host'); host.innerHTML = svg; await paint(); times.push(performance.now() - s); svgKB = Math.round(svg.length / 1024) }
    out.runs.push({ nodes: n, firstMs: +times[0].toFixed(0), warmMedianMs: +med(times.slice(1)).toFixed(0), svgKB })
  }
  return out
}
