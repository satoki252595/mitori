/**
 * @wp10a UI language (ux.md §11, AC-J12, AC-U81): switching ja → en at runtime changes only the chrome — no reload,
 * layout shift ≤ 0.01 (counting shifts right after the click too), the design-doc body is byte-identical — and in
 * EN the visible chrome (`[data-chrome]` minus `[data-user-content]`) carries 0 Japanese characters.
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

/** Visible Japanese characters in the chrome that are not user content (brand and `lang="ja"` labels excepted). */
function japaneseInChrome(page: Page) {
  return page.evaluate(() => {
    const JA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const out: string[] = [];
    const roots = document.querySelectorAll<HTMLElement>("[data-chrome]");
    for (const root of roots) {
      if (root.parentElement?.closest("[data-chrome]")) continue; // count each subtree once
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const text = n.nodeValue ?? "";
        if (!JA.test(text)) continue;
        const el = n.parentElement;
        if (!el || el.closest("[data-user-content], [data-brand], [lang='ja'], .sr-only")) continue;
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        out.push(`${el.tagName.toLowerCase()}.${el.className}: ${text.trim().slice(0, 40)}`);
      }
    }
    return out;
  });
}

async function installAllShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { t: number; v: number }[] };
    w.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { value: number })[]) w.__shifts.push({ t: e.startTime, v: e.value });
    }).observe({ type: "layout-shift", buffered: true });
  });
}

const shiftsSince = (page: Page, t0: number) =>
  page.evaluate((t) => (window as unknown as { __shifts: { t: number; v: number }[] }).__shifts.filter((s) => s.t >= t).reduce((a, s) => a + s.v, 0), t0);

test("@wp10a AC-U81 ja → en at runtime: chrome only, no reload, shift ≤ 0.01, doc body unchanged; AC-J12 0 Japanese chrome chars", async ({ page }) => {
  await installAllShifts(page);
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.waitForTimeout(400);
  const body = () => page.locator(".reader-root [data-b]").evaluateAll((els) => els.map((e) => e.textContent).join("\n"));
  const before = await body();
  const navs = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await expect(page.locator(".hdr .tab").nth(1)).toHaveText("設計書");
  const t0 = await page.evaluate(() => performance.now());
  await page.locator(".lang-btn").click();
  await expect(page.locator(".hdr .tab").nth(1)).toHaveText("Design doc");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navs);
  const shift = await shiftsSince(page, t0);
  console.log(`[i18n] ja→en shift ${shift}`);
  expect(shift).toBeLessThanOrEqual(0.01);
  expect(await body()).toBe(before);
  expect(await japaneseInChrome(page), "S2 chrome in EN").toEqual([]);
  // S1 through the header tab (client-side navigation keeps EN)
  await page.locator(".hdr .tab").first().click();
  await waitMark(page, "mitori:map:painted");
  await page.waitForTimeout(300);
  expect(await japaneseInChrome(page), "S1 chrome in EN").toEqual([]);
  // ⌘K in EN
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".pal input").fill("theme");
  await expect(page.locator(".pal-it").first()).toBeVisible();
  expect(await japaneseInChrome(page), "palette chrome in EN").toEqual([]);
});

test("@wp10a en → ja back: the chrome returns to Japanese and the doc body is untouched", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.locator(".lang-btn").click();
  await expect(page.locator(".hdr .tab").nth(1)).toHaveText("Design doc");
  await page.locator(".lang-btn").click();
  await expect(page.locator(".hdr .tab").nth(1)).toHaveText("設計書");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ja");
});
