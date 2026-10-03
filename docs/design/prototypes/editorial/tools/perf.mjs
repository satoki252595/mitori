// Perceived-performance probe for the editorial prototype (Playwright + installed Chrome).
// Usage (from a dir where `bun add playwright` was run):
//   MITORI_PROTO=file:///abs/path/docs/design/prototypes/editorial/index.html bun perf.mjs
// Prints: CLS at load / during simulated generation, DOM nodes, reader-level switch,
// palette keystroke, composer-open latency (keydown → composer painted), JS heap.
import { chromium } from "playwright";
const PAGE = process.env.MITORI_PROTO || new URL("../index.html", import.meta.url).href;
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.addInitScript(() => {
  window.__cls = 0;
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
});
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

await p.goto(PAGE + "?theme=light#map"); await p.waitForTimeout(600);
const mapCls = await p.evaluate(() => window.__cls);
await p.evaluate(() => { window.__cls = 0; });
await p.keyboard.press("Enter"); await p.waitForTimeout(6500);           // simulated generation (60x)
const genCls = await p.evaluate(() => window.__cls);

await p.goto(PAGE + "?theme=light#doc"); await p.waitForTimeout(600);
const r = await p.evaluate(async () => {
  const raf = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const out = { level: [], pal: [], dom: document.getElementsByTagName("*").length };
  for (let i = 0; i < 9; i++) { await raf(); const t0 = performance.now(); mitoriDemo.setLevel(["newcomer", "expert", "standard"][i % 3]); document.body.offsetHeight; out.level.push(performance.now() - t0); }
  mitoriDemo.openPal("");
  const inp = document.getElementById("palInput");
  for (const q of ["m", "mo", "moc", "moch", "mochi", "s", "se", "ses", "sess", "gene"]) { const t0 = performance.now(); inp.value = q; inp.dispatchEvent(new Event("input")); document.body.offsetHeight; out.pal.push(performance.now() - t0); }
  return out;
});
await p.waitForTimeout(50); await p.keyboard.press("Escape"); await p.waitForTimeout(100);

const composer = [];
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => { mitoriDemo.focus("b_r2wt4q8n"); document.addEventListener("keydown", () => { window.__t0 = performance.now(); }, { once: true, capture: true }); });
  await p.keyboard.press("e");
  composer.push(await p.evaluate(() => new Promise(res => {
    setTimeout(() => res(-1), 3000);
    const chk = () => document.querySelector(".mcard.composer") ? requestAnimationFrame(() => res(performance.now() - window.__t0)) : requestAnimationFrame(chk);
    chk();
  })));
  await p.keyboard.press("Escape"); await p.waitForTimeout(100);
}
const heap = await p.evaluate(() => performance.memory ? (performance.memory.usedJSHeapSize / 1e6).toFixed(1) : "n/a");
console.log(JSON.stringify({
  mapCls, genCls, dom: r.dom,
  levelMs_p50: med(r.level).toFixed(1), levelMs_max: Math.max(...r.level).toFixed(1),
  palMs_p50: med(r.pal).toFixed(2), palMs_max: Math.max(...r.pal).toFixed(2),
  composerMs_p50: med(composer).toFixed(1), composerMs_max: Math.max(...composer).toFixed(1),
  heapMB: heap, errs
}, null, 1));
await b.close();
