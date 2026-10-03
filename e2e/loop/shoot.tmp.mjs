// Scratch: drive the loop mock in Chromium and take screenshots of each loop step.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:4410";
const OUT = process.env.OUT ?? "/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/shots";
const WS = "ws_cr1t00000000";
const step = process.argv[2] ?? "all";

const post = (p, b) => fetch(`${BASE}${p}`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "ja-JP" });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await post("/__loop/configure", { speed: Number(process.env.SPEED ?? 1) });
await page.goto(`${BASE}/w/${WS}/doc/s3`);
await page.waitForSelector(".blk .mc");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/00-reader.png` });

// select text inside the first prose claim
const target = page.locator('.reader-root .blk[data-kind="prose"] .mc').filter({ hasText: "1回だけ再試行する" }).first();
await target.scrollIntoViewIfNeeded();
const box = await target.evaluate((el) => {
  const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes("1回だけ"));
  const r = document.createRange();
  const i = t.textContent.indexOf("1回だけ再試行する");
  r.setStart(t, i);
  r.setEnd(t, i + "1回だけ再試行する".length);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const b = r.getBoundingClientRect();
  return { x: b.x, y: b.y };
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/01-seltool.png` });
await page.keyboard.press("f");
await page.waitForSelector(".composer textarea");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-composer-open.png` });
await page.keyboard.type("回数を設定で変えられるようにしたい。既定は1、上限は3。");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/03-composer-typed.png` });
await page.keyboard.press("Meta+Enter");
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/04-optimistic.png` });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/05-running.png` });
await page.waitForSelector(".rc", { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-ready.png` });
await page.keyboard.press("r");
await page.waitForSelector(".rv .diff", { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/07-review.png` });
await page.keyboard.press("Meta+Enter");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/08-accepted.png` });
await page.goto(`${BASE}/w/${WS}/inbox?f=all`);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/09-inbox.png` });
await browser.close();
