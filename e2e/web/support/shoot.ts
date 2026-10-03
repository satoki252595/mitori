/**
 * Screenshot helper for visual review (not a test): node --experimental-strip-types e2e/web/support/shoot.ts
 *   <out-dir> [w=1440] [h=900] [path=/w/ws_crit00000000] [dark=0] [configure-json]
 */
import { chromium } from "playwright";

const [out = "shots", w = "1440", h = "900", path = "/w/ws_crit00000000", dark = "0", conf = "{}"] = process.argv.slice(2);
const base = process.env.MOCK_URL ?? "http://127.0.0.1:4317";
await fetch(`${base}/__mock/configure`, { method: "POST", body: conf, headers: { "content-type": "application/json" } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, colorScheme: dark === "1" ? "dark" : "light" });
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(base + path);
await page.waitForTimeout(1500);
const name = `${out}/${path.replace(/[^a-z0-9]+/gi, "_")}-${w}x${h}${dark === "1" ? "-dark" : ""}.png`;
await page.screenshot({ path: name });
console.log(name);
console.log(errors.join("\n"));
await browser.close();
