/**
 * Reader popovers (ux.md §3.6 / §4.3.5–4.3.7 / §4.3.12):
 *  - NC-17 one layer: a term card and the cite peek never stack; Escape closes the open one.
 *  - CitePeek line numbers: a numbered gutter (::before), no blank rows between the lines.
 *  - NC-18 term card: reading / English name, never the romaji.
 *  - EX-10 the block history (詳しい gutter) and the paragraph's human check ✓✓ from the history and from the peek.
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

async function openS3(page: Page) {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
}

test("@wp10a NC-17 one reader popover at a time: the peek replaces the term card; Escape closes the open one", async ({ page }) => {
  await openS3(page);
  const term = page.locator(".blk abbr.mterm:visible").first();
  await term.scrollIntoViewIfNeeded();
  await term.hover();
  await expect(page.locator(".pop.termcard")).toBeVisible();
  // a cite chip next: the peek opens, the term card goes
  await page.keyboard.press("Tab");
  await page.locator(".blk a.mcite").first().focus();
  await expect(page.locator(".pop.peek")).toBeVisible();
  await expect(page.locator(".pop.termcard")).toHaveCount(0);
  await expect(page.locator(".pop")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".pop")).toHaveCount(0);
  // the term card is a layer too: Escape closes it (the pointer leaves and comes back: a new hover)
  await page.mouse.move(5, 300);
  await term.hover();
  await expect(page.locator(".pop.termcard")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pop.termcard")).toHaveCount(0);
});

test("@wp10a CitePeek: numbered lines (gutter), no blank rows between them; the term card shows no romaji", async ({ page }) => {
  await openS3(page);
  await page.keyboard.press("Tab");
  await page.locator(".blk a.mcite").first().focus();
  const peek = page.locator(".pop.peek");
  await expect(peek).toBeVisible();
  const m = await peek.evaluate((el) => {
    const lines = [...el.querySelectorAll<HTMLElement>("[data-line]")];
    const first = lines[0] as HTMLElement;
    const lh = Number.parseFloat(getComputedStyle(first).lineHeight);
    const pre = el.querySelector("pre") as HTMLElement;
    return {
      n: lines.length,
      before: getComputedStyle(first, "::before").content,
      num: first.dataset.line,
      text: first.textContent ?? "",
      height: pre.scrollHeight,
      lh,
    };
  });
  expect(m.n).toBeGreaterThan(3);
  expect(m.before).toBe(`"${m.num}"`);
  expect(m.text).not.toMatch(new RegExp(`^\\s*${m.num}\\b`));
  // one row per line (a newline between the line spans must not add a blank row)
  expect(m.height).toBeLessThanOrEqual(m.n * m.lh + 20);
  await page.keyboard.press("Escape");
  const term = page.locator(".blk abbr.mterm:visible").first();
  await term.scrollIntoViewIfNeeded();
  await term.hover();
  const card = page.locator(".pop.termcard");
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("sesshonki");
  await expect(card).toContainText("session key");
});

test("@wp10a EX-10 block history at 詳しい: revisions newest first; ✓✓ marks the paragraph checked (one POST verify)", async ({ page }) => {
  await openS3(page);
  await page.keyboard.press("=");
  await expect(page.locator("html")).toHaveAttribute("data-level", "expert");
  const blk = page.locator(".blk:has(.mc[data-claim]):visible").first();
  await blk.scrollIntoViewIfNeeded();
  await blk.hover();
  const btn = page.locator(".gutter button.hist");
  await expect(btn).toBeVisible();
  await btn.click();
  const pop = page.locator(".pop.hist");
  await expect(pop).toBeVisible();
  await expect(pop.locator("li")).toHaveCount(3);
  await expect(pop.locator("li").first()).toContainText("修正を採用");
  await expect(pop.locator("li").first()).toContainText("現在の版");
  await pop.getByRole("button", { name: /確かめた/ }).click();
  await expect.poll(async () => (await mockLog()).filter((r) => r.method === "POST" && r.path.endsWith("/verify")).length).toBe(1);
  await expect(pop).toContainText("確かめました");
  await expect(blk.locator(".mc[data-claim]").first()).toHaveAttribute("data-verdict", "human-verified");
});

test("@wp10a EX-10 every claim can be checked: the peek of a cited claim offers ✓✓ for its paragraph", async ({ page }) => {
  await openS3(page);
  await page.keyboard.press("Tab");
  const chip = page.locator(".blk .mc[data-claim] a.mcite").first();
  await chip.focus();
  const peek = page.locator(".pop.peek");
  await expect(peek).toBeVisible();
  const ver = peek.locator("button.ver");
  await expect(ver).toBeVisible();
  await ver.click();
  await expect.poll(async () => (await mockLog()).filter((r) => r.method === "POST" && r.path.endsWith("/verify")).length).toBe(1);
  const body = (await mockLog()).find((r) => r.path.endsWith("/verify"))?.body as { verified: boolean };
  expect(body.verified).toBe(true);
});
