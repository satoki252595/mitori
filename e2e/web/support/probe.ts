/** Ad-hoc probe: evaluate an expression after boot. node --experimental-strip-types e2e/web/support/probe.ts <path> <conf> <expr> */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.MOCK_URL ?? "http://127.0.0.1:4317";
const [path = "/w/ws_cr1t00000000", conf = "{}", expr = "document.title"] = process.argv.slice(2);
await fetch(`${base}/__mock/configure`, { method: "POST", body: conf, headers: { "content-type": "application/json" } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1440), height: Number(process.env.VH ?? 900) } });
page.on("console", (m) => console.log(`[console.${m.type()}] ${m.text()}`));
await page.goto(base + path);
await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
// EXPR_FILE=<path>: read a longer expression from a file
const code = process.env.EXPR_FILE ? readFileSync(process.env.EXPR_FILE, "utf8") : expr;
console.log(JSON.stringify(await page.evaluate(code), null, 1));
await browser.close();
