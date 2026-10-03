// `bun e2e/export/support/shoot.ts <file.html> <outDir> <prefix> [chapter] [peekChapter]` — the screenshots of
// docs/progress/export/: an export opened with the installed Chrome, the network cut (1440×900 @2x, ja-JP), in the states
// the editorial prototype shows (standard / newcomer / expert reader, cite peek, map, ⌘K, dark, English, narrow).
// Prints console errors and requests that tried to leave the file (there must be none).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [file, outArg, prefix = "export", chapter = "s3", peekChapter = chapter, query = "session"] = process.argv.slice(2);
if (!file || !outArg) throw new Error("usage: shoot.ts <file.html> <outDir> <prefix> [chapter] [peekChapter] [palette query]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const url = `file://${resolve(file)}`;

const browser = await chromium.launch({ channel: "chrome" });
const problems: string[] = [];
const watch = (page: import("@playwright/test").Page) => {
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
  page.on("request", (r) => /^(?:https?|wss?):/.test(r.url()) && problems.push(`[network] ${r.url()}`));
};

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: Number(process.env.SHOT_DPR ?? 2),
  locale: "ja-JP",
  colorScheme: "light",
  offline: true,
});
const page = await ctx.newPage();
watch(page);
const shot = async (name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${prefix}-${name}.png`) });
};
const go = async (hash: string) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForTimeout(250);
};

await page.goto(`${url}#/s0`);
await page.waitForSelector(".blk");
await shot("01-reader-standard-s0");
await go(`#/${chapter}`);
await shot("02-reader-standard-flows");
await go(`#/${peekChapter}`);
const chip = page.locator(".blk a.mcite").first();
if (await chip.count()) {
  await chip.scrollIntoViewIfNeeded();
  await chip.hover();
  await page.waitForTimeout(600);
  await shot("03-cite-peek");
  await page.mouse.move(5, 500);
  await page.keyboard.press("Escape");
}
const term = page.locator("abbr.mterm").first();
if (await term.count()) {
  await go("#/s0");
  await term.scrollIntoViewIfNeeded();
  await term.hover();
  await page.waitForTimeout(600);
  await shot("04-term-card");
  await page.mouse.move(5, 500);
}
await go(`#/${chapter}`);
await page.locator(".seg.level label", { hasText: "初めて" }).click();
await shot("05-reader-newcomer");
await page.locator(".seg.level label", { hasText: "詳しい" }).click();
await shot("06-reader-expert");
await page.keyboard.press("0");
await go("#/map");
await shot("07-map");
await page.locator("svg.plan .room").first().click();
await shot("08-map-room");
await go(`#/${chapter}`);
await page.keyboard.press("Meta+k");
await page.keyboard.type(query);
await shot("09-palette");
await page.keyboard.press("Escape");
await page.locator(".theme-btn").click();
await page.locator(".theme-btn").click();
await shot("10-dark");
await page.locator(".theme-btn").click();
await page.locator(".lang-btn").click();
await go("#/s0");
await shot("11-english-chrome");
await page.close();

const narrow = await browser.newContext({
  viewport: { width: 700, height: 900 },
  deviceScaleFactor: Number(process.env.SHOT_DPR ?? 2),
  locale: "ja-JP",
  offline: true,
});
const np = await narrow.newPage();
watch(np);
await np.goto(`${url}#/${chapter}`);
await np.waitForSelector(".blk");
await np.waitForTimeout(300);
await np.screenshot({ path: join(out, `${prefix}-12-narrow.png`) });
await np.locator(".menu-btn").click();
await np.waitForTimeout(400);
await np.screenshot({ path: join(out, `${prefix}-13-narrow-drawer.png`) });
console.log(problems.length ? problems.join("\n") : "no console errors, no requests left the file");
await browser.close();
