// bun srv.mjs  (port 4777)
import fs from 'node:fs'
const json = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: 'b' + i, kind: 'paragraph', text: 'x'.repeat(80), anchors: [1, 2, 3], hash: 'abcdef0123456789' })))
const big = new Uint8Array(500_000).fill(97)
fs.writeFileSync('/tmp/mitori-static.bin', big)
const sseClients = new Set()
const enc = new TextEncoder()
let seq = 0
const payload = 'y'.repeat(1000)
const t0 = performance.now()
const server = Bun.serve({
  port: 4777,
  fetch(req, srv) {
    const u = new URL(req.url)
    if (u.pathname === '/ws') return srv.upgrade(req) ? undefined : new Response('no', { status: 400 })
    if (u.pathname === '/json') return new Response(json, { headers: { 'content-type': 'application/json' } })
    if (u.pathname === '/static') return new Response(Bun.file('/tmp/mitori-static.bin'))
    if (u.pathname === '/sse') {
      let ctrl
      const stream = new ReadableStream({ start(c) { ctrl = c; sseClients.add(c); c.enqueue(enc.encode(': hi\n\n')) }, cancel() { sseClients.delete(ctrl) } })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    }
    if (u.pathname === '/start') {
      const n = +(u.searchParams.get('n') || 200), hz = +(u.searchParams.get('hz') || 20)
      let i = 0
      const iv = setInterval(() => {
        const ts = performance.timeOrigin + performance.now()
        const msg = JSON.stringify({ seq: ++seq, ts, p: payload })
        server.publish('doc', msg)
        const sse = enc.encode('data: ' + msg + '\n\n')
        for (const c of sseClients) try { c.enqueue(sse) } catch {}
        if (++i >= n) clearInterval(iv)
      }, 1000 / hz)
      return new Response('started')
    }
    return new Response('mitori bench')
  },
  websocket: { open(ws) { ws.subscribe('doc') }, message() {}, perMessageDeflate: false },
})
console.log('ready in', Math.round(performance.now() - t0), 'ms on', server.port)
