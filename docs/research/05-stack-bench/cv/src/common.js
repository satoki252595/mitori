export const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
export const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(2) }
export const heap = () => performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
export async function loadDoc(name) { return await (await fetch(name)).text() }
export const anchorLines = (nLines, n) => Array.from({ length: n }, (_, i) => Math.floor((i + 0.5) * nLines / n) + 1)
