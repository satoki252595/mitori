import { assets } from "./assets.gen"
const t0 = performance.now()
const s = Bun.serve({ port: 0, fetch(req) { const p = new URL(req.url).pathname; const f = assets[p === "/" ? "/cm.html" : p]; return f ? new Response(Bun.file(f)) : new Response("nf", { status: 404 }) } })
if (process.argv.includes("--selftest")) { const r = await fetch(`http://localhost:${s.port}/cm.html`); console.log("selftest", r.status, (await r.text()).length, "ready ms", Math.round(performance.now() - t0)); process.exit(0) }
console.log("listening", s.port)
