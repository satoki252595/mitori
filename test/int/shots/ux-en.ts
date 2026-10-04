/**
 * UX drive, English chrome (finishing pass, track ux): the Fix-without-@ states of the Composer in the EN UI —
 * candidates on a facts row, the hint on an uncited sentence, the ⚡-only note on ⤴. Installed Chrome via Playwright,
 * the in-process daemon, NO engine call (nothing is sent). Exit 77 = no Chrome.
 *
 *   scripts/nd bun scripts/gen-assets.ts && scripts/nd bun test/int/shots/ux-en.ts [--out docs/progress/ux] [--scheme dark]
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildFixture } from "@mitori/testkit";
import { chromium } from "@playwright/test";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../fake-claude.ts";
import { startInt } from "../harness.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = resolve(ROOT, opt("--out", join(tmpdir(), "mitori-ux-en")) as string);
mkdirSync(OUT, { recursive: true });
const scheme = opt("--scheme", "light") === "dark" ? "dark" : "light";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: unknown, what: string): void => {
  if (!ok) throw new Error(`check failed: ${what}`);
};

let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch (e) {
  console.error("[ux-en] Google Chrome is not available:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(77);
}
const repo = await buildFixture("go-small");
const int = await startInt({ spawner: fakeClaude({ dtMs: 1 }), config: FAKE_CLAUDE_CONFIG });
const { ws } = await int.open(repo.root);
const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}/doc/s4` });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: "en-US" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const composer = () => page.locator("section.composer").first();
const suffix = scheme === "dark" ? "-dark" : "";
let exit = 0;
try {
  await page.goto(nonce.url);
  await page.waitForFunction(() => performance.getEntriesByName("mitori:shell:painted").length > 0);
  // the EN chrome (the header's language toggle), the doc stays as written
  if ((await page.locator("button.lang-btn").innerText()).trim() === "EN") await page.locator("button.lang-btn").click();
  await page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().waitFor();
  await sleep(400);
  await page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().dblclick();
  await sleep(250);
  await page.keyboard.press("f");
  await composer().getByText("referenced here").first().waitFor({ timeout: 5000 });
  await sleep(300);
  await page.screenshot({ path: join(OUT, `ux-en-01-fix-candidates${suffix}.png`) });
  await page.keyboard.press("Escape");
  await sleep(300);

  await page.goto(new URL(`/w/${ws}/doc/s10`, page.url()).href);
  await page.locator(".blk .mb", { hasText: "まだ決定はありません" }).first().waitFor();
  await sleep(400);
  await page.evaluate(() => {
    const root = [...document.querySelectorAll(".reader-root .blk .mb")].find((x) => x.textContent?.includes("まだ決定はありません"));
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const at = n.data.indexOf("まだ決定はありません");
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + 10);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return;
    }
  });
  await sleep(300);
  await page.keyboard.press("f");
  await composer().locator(".tg-none").waitFor({ timeout: 5000 });
  await composer().locator("textarea").first().click();
  await page.keyboard.type("make it clearer", { delay: 5 });
  await sleep(600);
  await page.screenshot({ path: join(OUT, `ux-en-02-fix-hint${suffix}.png`) });
  await composer().locator("button.path").click();
  await composer().getByText("Run here instead").waitFor({ timeout: 3000 });
  check(!(await composer().locator("button.send").isEnabled()), "send disabled on ⤴ for an uncited Fix");
  await sleep(200);
  await page.screenshot({ path: join(OUT, `ux-en-03-fix-push-only${suffix}.png`) });
  check(errors.length === 0, `no page errors / HTTP errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, out: OUT }));
} catch (e) {
  exit = 1;
  console.error("[ux-en] FAILED", e, errors);
  await page.screenshot({ path: join(OUT, "99-failure-en.png") }).catch(() => undefined);
} finally {
  await browser.close();
  await int.close();
  await repo.dispose();
}
process.exit(exit);
