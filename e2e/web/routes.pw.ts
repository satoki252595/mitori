/** @wp10a redirect routes (ux.md §2.2 + R1 §2.3): /review → oldest ready job or Inbox, /glossary → §12. */
import { expect, test } from "@playwright/test";
import { configure, WS } from "./support/helpers.ts";

test("@wp10a /w/:ws/review deep link waits for the jobs, then opens the oldest ready one", async ({ page }) => {
  await configure({ readyJob: true });
  await page.goto(`/w/${WS}/review`);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/review/j_000000000001$`));
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
