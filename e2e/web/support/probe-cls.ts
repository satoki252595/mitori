/** Ad-hoc probe: list layout shifts with their sources. node --experimental-strip-types e2e/web/support/probe-cls.ts <path> [conf] */
import { chromium } from "playwright";

const base = process.env.MOCK_URL ?? "http://127.0.0.1:4317";
const [path = "/w/ws_cr1t00000000", conf = "{}"] = process.argv.slice(2);
await fetch(`${base}/__mock/configure`, { method: "POST", body: conf, headers: { "content-type": "application/json" } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1440), height: Number(process.env.VH ?? 900) } });
await page.addInitScript(() => {
  (window as unknown as { __s: unknown[] }).__s = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as (PerformanceEntry & {
      value: number;
      sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
    })[]) {
      (window as unknown as { __s: unknown[] }).__s.push({
        t: Math.round(e.startTime),
        v: e.value,
        src: e.sources.map((s) => {
          const el = s.node as Element | undefined;
          return `${el?.nodeName}.${(el as Element)?.className?.toString?.().slice(0, 40)} ${JSON.stringify([s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height])}→${JSON.stringify([s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height])}`;
        }),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
});
await page.goto(base + path);
await page.waitForTimeout(2000);
// CLICK=<selector>: report only the shifts after clicking it (e.g. the language switch)
if (process.env.CLICK) {
  await page.evaluate(() => {
    (window as unknown as { __s: unknown[] }).__s = [];
  });
  await page.locator(process.env.CLICK).click();
  await page.waitForTimeout(800);
}
console.log(JSON.stringify(await page.evaluate(() => (window as unknown as { __s: unknown[] }).__s), null, 1));
await browser.close();
