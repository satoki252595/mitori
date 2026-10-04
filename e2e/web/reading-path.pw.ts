/**
 * Reading paths (ux.md §4.3.2 「30分コース ▾」, §4.3.8, §7.2; NC-08 / NC-15):
 *  - the rail card names the course whole in the 248 px rail — also 「約13分コース 10/12」 — and its ▾ menu lists the
 *    course's stops and the other courses; a pick switches; Escape and a press outside close it.
 *  - one name everywhere: a 5-minute course that really takes much longer is 「約N分コース」 in the rail, on §0's
 *    welcome card, in ⌘K's suggestions and on the map's card — never 「5分コース」 in one place and 「約N分」 in another.
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

const truncated = (page: Page, sel: string) => page.locator(sel).evaluate((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 0.5);

test("@wp10a rail course card: the name fits whole; ▾ lists the stops and the courses; a pick switches; Escape / outside close", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s0`);
  await waitMark(page, "mitori:section:rendered");
  const title = page.locator(".rail .path-t");
  await expect(title).toBeVisible();
  expect(await truncated(page, ".rail .path-t .pt-name"), "the course name is cut").toBe(false);
  // the longest realistic name and count still fit the rail (it used to read 「約13分コー…」)
  await page.evaluate(() => {
    (document.querySelector(".rail .path-t .pt-name") as HTMLElement).textContent = "約13分コース";
    (document.querySelector(".rail .path-t .cnt") as HTMLElement).innerHTML = '10<span class="sl">/</span>12';
  });
  expect(await truncated(page, ".rail .path-t .pt-name"), "「約13分コース 10/12」 is cut").toBe(false);
  await page.reload();
  await waitMark(page, "mitori:section:rendered");

  // ▾: the stops, then the other courses (no separate <select> in the footer: the next stop has the whole row)
  await expect(page.locator(".rail .path-f select")).toHaveCount(0);
  await title.click();
  const menu = page.locator("#path-stops");
  await expect(menu).toBeVisible();
  await expect(menu.locator("ol li")).toHaveCount(7);
  const courses = menu.locator(".others button");
  await expect(courses).toHaveCount(2);
  await expect(courses.filter({ hasText: "5分コース" })).toHaveAttribute("aria-pressed", "false");
  await courses.filter({ hasText: "5分コース" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".rail .path-t .pt-name")).toHaveText("5分コース");
  // (§0's end may already be in view: it counts as read)
  await expect(page.locator(".rail .path-t .cnt")).toHaveText(/^\d\/3$/);
  // Escape closes; so does a press outside the card
  await title.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await title.click();
  await expect(menu).toBeVisible();
  await page.locator(".reader-root h1").first().click();
  await expect(menu).toHaveCount(0);
});

test.describe("first visit", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("@wp10a a long 「5分コース」 is called by its real time everywhere: rail, §0 card, ⌘K, the map's card", async ({ page }) => {
    // seven stops ≈ 12 minutes: ≥ 1.5 × 5, so the course is named by its real time
    await configure({ generated: true, fiveMinStops: 7 });
    await page.goto(`/w/${WS}/doc/s0`);
    await waitMark(page, "mitori:section:rendered");
    await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
    const name = (await page.locator(".rail .path-t .pt-name").innerText()).trim();
    expect(name).toMatch(/^約\d+分コース$/);
    await expect(page.locator(".welcome")).toContainText(`はじめての方へ — ${name}`);
    await expect(page.locator(".welcome .btn-pri")).toHaveText(`${name}で読む`);
    // ⌘K's empty state suggests the same course
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".pal-it", { hasText: `${name}で読む` })).toBeVisible();
    await page.keyboard.press("Escape");
    // the map's 「設計書（生成済み）」 card
    await page.locator(".hdr .tab").first().click();
    await waitMark(page, "mitori:map:painted");
    await expect(page.locator(".side .done .btn-pri")).toHaveText(`${name}で読む`);
  });
});
