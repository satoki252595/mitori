// Judge probe: uniform a11y / typography / DOM metrics across the 3 prototypes (JUDGEMENT.md §1.2).
// Run from a dir with `bun add playwright` (uses installed Chrome): node judge-probe.mjs > probe-results.json
import { chromium } from "playwright";
const ROOT = "file:///Users/satoki252595/work/20261002_aiAgentTool/docs/design/prototypes";
const STATES = {
  editorial: [
    ["doc-light", "/editorial/index.html?theme=light&level=standard#doc"],
    ["doc-dark", "/editorial/index.html?theme=dark&level=standard#doc"],
    ["map", "/editorial/index.html?theme=light#map"],
    ["review", "/editorial/index.html?theme=light#review"],
    ["inbox", "/editorial/index.html?theme=light#inbox"],
  ],
  pro: [
    ["doc-light", "/pro/index.html#state=doc&theme=light&level=standard"],
    ["doc-dark", "/pro/index.html#state=doc&theme=dark&level=standard"],
    ["map", "/pro/index.html#state=scan&theme=light"],
    ["review", "/pro/index.html#state=ready&theme=light&speed=50"],
    ["inbox", "/pro/index.html#state=inbox&theme=light"],
  ],
  map: [
    ["doc-light", "/map/index.html#s=reader&room=session&theme=light&clean=1"],
    ["doc-dark", "/map/index.html#s=reader&room=session&theme=dark&clean=1"],
    ["map", "/map/index.html#s=first-run&theme=light&clean=1"],
    ["review", "/map/index.html#s=ready&theme=light&clean=1"],
    ["inbox", "/map/index.html#s=inbox&theme=light&clean=1"],
  ],
};

const probe = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const htmlBg = parse(getComputedStyle(document.body).backgroundColor);
    if (!stack.length || stack[stack.length - 1].a < 0.99) base = htmlBg && htmlBg.a > 0.99 ? htmlBg : base;
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  const textEls = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n; (n = walker.nextNode());) { if (!n.nodeValue.trim()) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; if (el.closest("svg")) continue; seen.add(el); if (vis(el)) textEls.push(el); }
  let small11 = 0, small12 = 0, minFs = 99, cFail = 0, cTotal = 0; const fails = [];
  const fsHist = {};
  for (const el of textEls) {
    const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const fw = +cs.fontWeight || 400;
    fsHist[Math.round(fs)] = (fsHist[Math.round(fs)] || 0) + 1;
    if (fs < 11) small11++; if (fs < 12) small12++; if (fs < minFs) minFs = fs;
    const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); const f = blend(fg, bg);
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    cTotal++; if (ratio < (large ? 3 : 4.5)) { cFail++; if (fails.length < 12) fails.push({ t: el.textContent.trim().slice(0, 24), fs, ratio: +ratio.toFixed(2), cls: el.className && String(el.className).slice(0, 30) }); }
  }
  const inter = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=option],input,select,textarea,summary,[tabindex="0"]')].filter(vis);
  let smallT = 0; const smallList = [];
  for (const el of inter) { const r = el.getBoundingClientRect(); if (r.width < 24 || r.height < 24) { smallT++; if (smallList.length < 8) smallList.push({ t: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) }); } }
  // prose measure: paragraph-like elements with most text
  const cands = [...document.querySelectorAll("p, .blk, li")].filter(vis).filter(e => (e.textContent || "").length > 60);
  let prose = null;
  if (cands.length) {
    const byFs = {};
    for (const e of cands) { const cs = getComputedStyle(e); const k = cs.fontSize + "|" + cs.lineHeight; (byFs[k] ||= []).push(e); }
    const k = Object.keys(byFs).sort((a, b) => byFs[b].length - byFs[a].length)[0];
    const e = byFs[k][0]; const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize);
    const w = e.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    prose = { fontSize: fs, lineHeight: +(parseFloat(cs.lineHeight) / fs).toFixed(2), widthPx: Math.round(w), cjkCharsPerLine: Math.round(w / fs), family: cs.fontFamily.slice(0, 60), autospace: cs.textAutospace || cs.getPropertyValue("text-autospace"), lineBreak: cs.lineBreak };
  }
  const h = [...document.querySelectorAll("h1,h2")].filter(vis)[0];
  const head = h ? { tag: h.tagName, fs: parseFloat(getComputedStyle(h).fontSize), family: getComputedStyle(h).fontFamily.slice(0, 50), weight: getComputedStyle(h).fontWeight } : null;
  return {
    dom: document.getElementsByTagName("*").length,
    textEls: textEls.length, minFontPx: minFs, under11px: small11, under12px: small12,
    fsTop: Object.entries(fsHist).sort((a, b) => b[1] - a[1]).slice(0, 6),
    contrastFail: cFail, contrastChecked: cTotal, fails,
    interactiveVisible: inter.length, under24px: smallT, smallList,
    prose, head,
    htmlLang: document.documentElement.lang,
    liveRegions: document.querySelectorAll("[aria-live]").length,
  };
};

const b = await chromium.launch({ channel: "chrome" });
const out = {};
for (const [name, states] of Object.entries(STATES)) {
  out[name] = {};
  for (const [st, path] of states) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(ROOT + path); await p.waitForTimeout(st === "review" ? 2500 : 900);
    if (name === "editorial" && st === "review") { try { await p.evaluate(() => window.mitoriDemo && mitoriDemo.review && mitoriDemo.review()); await p.waitForTimeout(800); } catch {} }
    const r = await p.evaluate(probe);
    // keyboard: Tab 20 times, count focused elements with a visible focus indicator
    let tabVisible = 0, tabTotal = 0;
    await p.mouse.click(5, 450).catch(() => {});
    for (let i = 0; i < 20; i++) {
      await p.keyboard.press("Tab");
      const fv = await p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); const has = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none"); return has; });
      if (fv !== null) { tabTotal++; if (fv) tabVisible++; }
    }
    r.tabFocus = `${tabVisible}/${tabTotal}`;
    r.errors = errs.length;
    out[name][st] = r;
    await ctx.close();
  }
}
await b.close();
console.log(JSON.stringify(out, null, 1));
