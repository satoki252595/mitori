// bun cli.mjs <nWS> <nSSE> <n msgs> <hz>
const [nWS, nSSE, n, hz] = process.argv.slice(2).map(Number)
const lat = []
const now = () => performance.timeOrigin + performance.now()
let open = 0
const sockets = []
for (let i = 0; i < nWS; i++) { const ws = new WebSocket('ws://localhost:4777/ws'); ws.onopen = () => open++; ws.onmessage = e => { const m = JSON.parse(e.data); lat.push(['ws', now() - m.ts]) }; sockets.push(ws) }
for (let i = 0; i < nSSE; i++) {
  fetch('http://localhost:4777/sse').then(async r => { open++; const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let k; while ((k = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, k); buf = buf.slice(k + 2); if (ev.startsWith('data: ')) { const m = JSON.parse(ev.slice(6)); lat.push(['sse', now() - m.ts]) } } } })
}
while (open < nWS + nSSE) await new Promise(r => setTimeout(r, 20))
await fetch(`http://localhost:4777/start?n=${n}&hz=${hz}`)
await new Promise(r => setTimeout(r, n / hz * 1000 + 800))
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]
for (const k of ['ws', 'sse']) {
  const a = lat.filter(x => x[0] === k).map(x => x[1]).sort((x, y) => x - y)
  if (a.length) console.log(JSON.stringify({ kind: k, clients: k === 'ws' ? nWS : nSSE, msgs: a.length, expected: (k === 'ws' ? nWS : nSSE) * n, p50: +pct(a, .5).toFixed(2), p95: +pct(a, .95).toFixed(2), p99: +pct(a, .99).toFixed(2), max: +a[a.length - 1].toFixed(2) }))
}
process.exit(0)
