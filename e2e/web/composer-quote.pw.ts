/**
 * The Composer's quote (ux.md §4.5): a long selection is clamped to two lines — and nothing of a third line shows
 * (an 8 px padding inside the `overflow: hidden` box used to reveal the top of line 3 under the clamp).
 */
import { expect, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

test("@wp10a Composer quote: a long selection shows exactly two lines, no sliver of a third", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  // the longest paragraph of the page, selected whole
  const p = page
    .locator(".blk p")
    .filter({ hasText: /.{70,}/ })
    .first();
  await p.scrollIntoViewIfNeeded();
  const box = await p.boundingBox();
  if (!box) throw new Error("no paragraph");
  await page.mouse.move(box.x + 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 8, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("e");
  const q = page.locator(".cm-q");
  await expect(q).toBeVisible({ timeout: 10_000 });
  const m = await q.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { client: el.clientHeight, scroll: el.scrollHeight, lh: Number.parseFloat(cs.lineHeight) };
  });
  // the quote is longer than its clamp, and its visible (padding-box) height is the two lines, not 2 lines + padding
  expect(m.scroll).toBeGreaterThan(m.client);
  expect(m.client).toBeLessThanOrEqual(Math.ceil(2 * m.lh) + 1);
});
