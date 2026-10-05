/** @wp10a redirect routes (ux.md §2.2 + R1 §2.3): /review → oldest ready job or Inbox, /glossary → §12. */
import type { InboxItem, Iso8601 } from "@mitori/core";
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

test("@wp10a Inbox follows 200-item cursors to render all 500 rows", async ({ page }) => {
  await configure({});
  const items: InboxItem[] = Array.from({ length: 500 }, (_, i) => ({
    kind: "thread",
    id: `th_${String(i).padStart(12, "0")}`,
    title: `Pagination row ${i + 1}`,
    state: "open",
    tags: ["mine"],
    intent: "note",
    updatedAt: "2026-10-05T00:00:00Z" as Iso8601,
    href: `/w/${WS}/doc/s3`,
  }));
  const cursors = new Set<string>();
  await page.route(`**/api/v1/ws/${WS}/inbox?*`, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("limit")).toBe("200");
    const cursor = query.get("cursor") ?? "";
    cursors.add(cursor);
    const from = Number(cursor || 0);
    await route.fulfill({ json: { items: items.slice(from, from + 200), next: from + 200 < items.length ? String(from + 200) : null } });
  });
  await page.goto(`/w/${WS}/inbox?f=all`);
  const rows = page.locator("[role='listbox'] [data-id^='th_']");
  await expect(rows).toHaveCount(500);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toContainText("Pagination row 500");
  expect([...cursors]).toEqual(["", "200", "400"]);
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
