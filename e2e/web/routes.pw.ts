/** @wp10a redirect routes (ux.md §2.2 + R1 §2.3): /review → oldest ready job or Inbox, /glossary → §12. */
import { expect, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

test("@wp10a /w/:ws/review deep link waits for the jobs, then opens the oldest ready one", async ({ page }) => {
  await configure({ readyJob: true });
  await page.goto(`/w/${WS}/review`);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/review/j_0000000001$`));
});

test("@wp10a /w/:ws/review without a ready job goes to the Inbox (mine)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/review`);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/inbox\\?f=mine$`));
});

test("@wp10a /w/:ws/glossary is §12 in the MVP", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/glossary`);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s12$`));
});

test("@wp10a /w/:ws/threads/:th (permalink) resolves to the anchored block once the outline is known", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/threads/th_00000001`);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s3/review-cycle\\?th=th_00000001#b_[0-9a-z]{8}$`));
});

test("@wp10a back / forward restore the scroll position and the focused block (ux.md §2.3-4)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  for (let i = 0; i < 6; i++) await page.keyboard.press("j");
  const block = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.b ?? null);
  const y = await page.evaluate(() => window.scrollY);
  expect(block).not.toBeNull();
  await page.locator('.toc a[data-toc="s4"]').click();
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s4$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s3#${block}$`));
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.b ?? null)).toBe(block);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(4);
});
