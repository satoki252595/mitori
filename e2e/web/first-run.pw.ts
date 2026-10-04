/**
 * NC-08 / NC-13 / NC-15 first visit (ux.md §7.1–7.2): a browser that has never shown mitori reads at 「初めて」 and
 * follows the 5-minute course; §0 carries the welcome card (the course, the level, 「文を選ぶとAIに…」); the level is
 * saved to the server at once (a reload inside the debounce must not bring 「標準」 back). A returning browser
 * (every other spec, playwright.config.ts storageState) is untouched.
 */
import { expect, test } from "@playwright/test";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

test.describe("first visit", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("@wp10a NC-08 first visit: 初めて, the 5-minute course and the welcome card; saved at once; reload keeps it", async ({ page }) => {
    await configure({ generated: true });
    await page.goto(`/w/${WS}/doc/s0`);
    await waitMark(page, "mitori:section:rendered");
    await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
    const card = page.locator(".welcome");
    await expect(card).toBeVisible();
    await expect(card).toContainText("§0 → §1 → §2");
    await expect(page.locator(".rail .path-t")).toContainText("0 / 3");
    await expect
      .poll(async () => (await mockLog()).some((r) => r.method === "PATCH" && JSON.stringify(r.body).includes('"readerLevel":"newcomer"')), { timeout: 3000 })
      .toBe(true);
    await page.reload();
    await waitMark(page, "mitori:section:rendered");
    await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
    // × hides the card for this workspace (not the level)
    await page.locator(".welcome .x").click();
    await expect(page.locator(".welcome")).toHaveCount(0);
    await page.reload();
    await waitMark(page, "mitori:section:rendered");
    await expect(page.locator(".welcome")).toHaveCount(0);
  });

  test("@wp10a NC-13 help: 「この画面でできること」 lists the Reader's three steps before the keyboard table", async ({ page }) => {
    await configure({ generated: true });
    await page.goto(`/w/${WS}/doc/s0`);
    await waitMark(page, "mitori:section:rendered");
    await page.keyboard.press("?");
    const steps = page.locator("dialog.help .guide li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(1)).toContainText("文を選んで");
    await expect(page.locator("dialog.help .meta")).toContainText("費用の目安");
  });
});
