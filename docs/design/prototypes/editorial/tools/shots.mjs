import { chromium } from "playwright";
const PAGE = process.env.MITORI_PROTO || new URL("../index.html", import.meta.url).href;
const OUT = process.argv[2] || new URL("../shots", import.meta.url).pathname;
const only = process.argv[3] ? process.argv[3].split(",") : null;
const want = n => !only || only.includes(n);
const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
async function page(w = 1440, h = 900, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: opts.dark ? "dark" : "light", reducedMotion: "no-preference" });
  const p = await ctx.newPage();
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", e => errors.push("pageerror: " + e.message));
  return p;
}
const settle = p => p.waitForTimeout(450);
async function shot(p, name) { await p.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); }

if (want("01")) {
  const p = await page();
  await p.goto(PAGE + "?theme=light#map");
  await settle(p);
  await shot(p, "01-first-run-map");
  await p.hover('.room[data-room="sess"]'); await p.waitForTimeout(500);
  await shot(p, "01b-map-hover");
  await p.mouse.move(5, 880);
  await p.keyboard.press("Enter"); await p.waitForTimeout(2600);
  await shot(p, "01c-generating");
  await p.close();
}
if (want("02")) {
  const p = await page();
  await p.goto(PAGE + "?theme=light&level=standard#doc");
  await settle(p);
  await p.evaluate(() => mitoriDemo.scrollTo("s3", 64));
  await p.waitForTimeout(400);
  await shot(p, "02-reader-standard");
  await p.hover('.cite[data-c="skey"]'); await p.waitForTimeout(650);
  await shot(p, "02b-reader-peek");
  await p.mouse.move(5, 500); await p.waitForTimeout(300);
  await p.keyboard.press("Minus"); await p.waitForTimeout(300);
  await p.evaluate(() => mitoriDemo.scrollTo("s3", 64)); await p.waitForTimeout(300);
  await shot(p, "02c-reader-newcomer");
  await p.keyboard.press("Equal"); await p.keyboard.press("Equal"); await p.waitForTimeout(300);
  await p.evaluate(() => mitoriDemo.scrollTo("s3-1", 90)); await p.waitForTimeout(300);
  await shot(p, "02d-reader-expert");
  await p.close();
}
if (want("03")) {
  const p = await page();
  await p.goto(PAGE + "?theme=light&level=standard#doc");
  await settle(p);
  await p.evaluate(() => { mitoriDemo.selectFix(); });
  await p.waitForTimeout(250);
  await p.evaluate(() => mitoriDemo.scrollTo("s3-2", 120)); await p.waitForTimeout(200);
  await p.evaluate(() => { mitoriDemo.selectFix(); });
  await p.waitForTimeout(250);
  await shot(p, "03a-selection-toolbar");
  await p.keyboard.press("f"); await p.waitForTimeout(300);
  await p.keyboard.type("回数を設定で変えられるようにしたい。既定は1、上限は3。");
  await p.waitForTimeout(300);
  await shot(p, "03b-composer");
  await p.keyboard.press("Meta+Enter"); await p.waitForTimeout(4200);
  await shot(p, "03c-job-running");
  await p.evaluate(() => mitoriDemo.ff()); await p.waitForTimeout(400);
  await shot(p, "03d-job-ready-card");
  await p.keyboard.press("r"); await p.waitForTimeout(700);
  await shot(p, "03e-review-ready");
  await p.keyboard.press("Meta+Enter"); await p.waitForTimeout(260);
  await shot(p, "03f-accepted-flash-undo");
  await p.waitForTimeout(1500);
  // inbox after flow
  await p.keyboard.press("g"); await p.keyboard.press("i"); await p.waitForTimeout(400);
  await p.keyboard.press("j"); await p.keyboard.press("j"); await p.waitForTimeout(300);
  await shot(p, "04-inbox");
  await p.keyboard.press("Meta+k"); await p.waitForTimeout(250);
  await p.keyboard.type("mochi"); await p.waitForTimeout(300);
  await shot(p, "05-palette-romaji");
  await p.close();
}
if (want("06")) {
  const p = await page(1440, 900, { dark: true });
  await p.goto(PAGE + "?theme=dark&level=standard#doc");
  await settle(p);
  await p.evaluate(() => mitoriDemo.scrollTo("s3", 64)); await p.waitForTimeout(400);
  await p.hover('#s3 .term[data-t="sessionkey"]'); await p.waitForTimeout(650);
  await shot(p, "06-reader-dark");
  await p.goto(PAGE + "?theme=dark#map"); await settle(p);
  await shot(p, "06b-map-dark");
  await p.close();
}
if (want("07")) {
  const p = await page(820, 1180);
  await p.goto(PAGE + "?theme=light&level=standard#doc");
  await settle(p);
  await p.evaluate(() => mitoriDemo.scrollTo("s3", 64)); await p.waitForTimeout(400);
  await shot(p, "07-tablet-reader");
  await p.close();
}
if (want("08")) {
  const p = await page();
  await p.goto(PAGE + "?theme=light&level=standard#doc"); await settle(p);
  await p.evaluate(() => mitoriDemo.scrollTo("s3-2", 120)); await p.waitForTimeout(200);
  await p.evaluate(() => { mitoriDemo.selectFix(); }); await p.waitForTimeout(200);
  await p.click('#langBtn'); await p.waitForTimeout(200);
  await p.evaluate(() => { mitoriDemo.selectFix(); }); await p.waitForTimeout(150);
  await p.keyboard.press("e"); await p.waitForTimeout(200);
  await p.keyboard.type("Why exactly one retry?"); await p.keyboard.press("Meta+Enter"); await p.waitForTimeout(6500);
  await shot(p, "08-en-chrome-explain-answered");
  await p.keyboard.press("Shift+?"); await p.waitForTimeout(300);
  await shot(p, "09-help-overlay");
  await p.close();
}
await browser.close();
console.log("errors:", errors.length ? errors.join("\n") : "none");
