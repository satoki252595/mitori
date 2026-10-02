export const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
export const med = a => [...a].sort((x, y) => x - y)[a.length >> 1]
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
export function graph(n, deg = 2) { const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, w: 120 + Math.floor(rnd() * 60), h: 36 })); const edges = []; for (let i = 1; i < n; i++) { edges.push([Math.floor(rnd() * i), i]); for (let k = 1; k < deg; k++) if (rnd() < 0.5) edges.push([Math.floor(rnd() * i), i]) } return { nodes, edges } }
export function svgFromLayout(nodes, edges, pos) { // nodes with x,y,w,h ; edges as polylines
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg')
  let maxX = 0, maxY = 0
  for (const e of edges) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M' + e.pts.map(q => q.x + ',' + q.y).join(' L')); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#888'); svg.append(p) }
  for (const n of nodes) { const g = document.createElementNS(NS, 'g'); g.dataset.id = n.id; g.setAttribute('transform', `translate(${n.x},${n.y})`); const r = document.createElementNS(NS, 'rect'); r.setAttribute('width', n.w); r.setAttribute('height', n.h); r.setAttribute('rx', 6); r.setAttribute('fill', '#eef'); const t = document.createElementNS(NS, 'text'); t.setAttribute('x', 8); t.setAttribute('y', 22); t.textContent = n.id; g.append(r, t); svg.append(g); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h) }
  svg.setAttribute('viewBox', `0 0 ${maxX + 20} ${maxY + 20}`); svg.setAttribute('width', 1000); svg.setAttribute('height', 600); return svg
}
