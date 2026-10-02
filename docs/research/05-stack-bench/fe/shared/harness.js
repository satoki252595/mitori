const WORDS = 'design doc block anchor review comment repo module symbol token cache worker parse render virtual list stable id patch agent diff suggestion thread resolve merge export import function class type interface'.split(' ')
let seed = 12345
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
export function makeText() { const n = 12 + Math.floor(rnd() * 14); let s = ''; for (let i = 0; i < n; i++) s += WORDS[Math.floor(rnd() * WORDS.length)] + ' '; return s.trim() }
let nextId = 1
export function makeData(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = { id: nextId++, text: makeText(), count: Math.floor(rnd() * 4) }; return a }
export const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] }
// ops: { create(n), clear(), update10th(), select(i), swap(), remove(i), append(n), addComment(i), rowCount() }
export function install(name, ops) {
  window.__fw = name
  installVirt(ops)
  const time = async (fn) => { const t = performance.now(); fn(); await paint(); return performance.now() - t }
  window.__bench = async (reps = 9) => {
    const res = {}
    const rec = (k, v) => (res[k] ??= []).push(v)
    for (let r = 0; r < reps + 2; r++) {   // first 2 iterations are warmup
      const keep = r >= 2
      await time(() => ops.clear()); await paint()
      const a = await time(() => ops.create(1000)); keep && rec('create1k', a)
      keep && rec('replaceAll1k', await time(() => ops.create(1000)))
      keep && rec('update10th', await time(() => ops.update10th()))
      keep && rec('select', await time(() => ops.select(500 + (r % 7))))
      keep && rec('swap', await time(() => ops.swap()))
      keep && rec('remove', await time(() => ops.remove(300 + r)))
      keep && rec('append1k', await time(() => ops.append(1000)))
      await time(() => ops.clear()); await paint()
      keep && rec('create10k', await time(() => ops.create(10000)))
      keep && rec('addComment@10k', await time(() => ops.addComment(5000 + r)))
      keep && rec('select@10k', await time(() => ops.select(4000 + r)))
      keep && rec('clear10k', await time(() => ops.clear()))
    }
    const out = {}
    for (const k in res) out[k] = +med(res[k]).toFixed(1)
    // memory after 10k rows
    await time(() => ops.create(10000)); await paint()
    out.heapMB10k = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
    out.domNodes10k = document.getElementsByTagName('*').length
    await time(() => ops.clear())
    out.fw = name
    return out
  }
}
export function installVirt(ops) {
  window.__benchVirt = async (steps = 300) => {
    await ops.clear(); await paint()
    ops.create(10000); await paint()
    ops.virt(true); await paint()
    const times = [], tot = []
    for (let i = 0; i < steps + 20; i++) {
      const start = Math.floor(rnd() * 9900)
      const t = performance.now(); ops.scrollTo(start); const dt = performance.now() - t
      await paint(); const dt2 = performance.now() - t
      if (i >= 20) { times.push(dt); tot.push(dt2) }
    }
    const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return +b[Math.floor(b.length * p)].toFixed(2) }
    const out = { fw: window.__fw, scriptMedianMs: q(times, .5), scriptP95Ms: q(times, .95), scriptP99Ms: q(times, .99), toPaintMedianMs: q(tot, .5), domNodes: document.getElementsByTagName('*').length }
    ops.virt(false); await ops.clear(); await paint()
    return out
  }
}
export const CSS = `body{font:13px/1.4 system-ui;margin:0}.blk{display:flex;gap:8px;padding:4px 8px;border-bottom:1px solid #eee}.blk.sel{background:#fffbe0}.g{width:48px;color:#888}.body{flex:1}.c{min-width:28px}`
