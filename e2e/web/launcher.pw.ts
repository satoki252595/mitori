/**
 * @wp10a S0 Launcher (ux.md §4.1): recent workspaces newest first as one Tab stop with ↑↓ / Home / End, Enter opens;
 * open errors under the input (role="alert") with the clone hint's command copy.
 */
import { expect, test } from "@playwright/test";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

test("@wp10a S0 cards: last opened first, one Tab stop, ↑↓ / Home / End move, Enter opens the map", async ({ page }) => {
  await configure({});
  await page.goto("/");
  await waitMark(page, "mitori:section:rendered");
  const cards = page.locator("a.wcard");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("crit");
  await expect(cards.nth(1)).toContainText("hono");
  await expect(page.locator('a.wcard[tabindex="0"]')).toHaveCount(1);
  // long roots are shortened in the middle, the full path stays in the title
  const root = cards.nth(1).locator(".root");
  await expect(root).toContainText("…");
  expect(await root.getAttribute("title")).toBe("/Users/me/src/github.com/honojs/hono/packages/hono-base/a/very/long/nested/checkout/path");
  await cards.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(cards.nth(1)).toBeFocused();
  await expect(page.locator('a.wcard[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${WS}$`));
  await waitMark(page, "mitori:map:painted");
});

test("@wp10a S0 open errors: not found / clone failed (command copy) under the input; a valid path opens the map", async ({ page }) => {
  await configure({});
  await page.goto("/");
  await waitMark(page, "mitori:section:rendered");
  const input = page.locator("#ws-target");
  await input.fill("/nowhere");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("そのパスは見つかりません");
  await input.fill("https://github.com/nope/repo");
  await page.keyboard.press("Enter");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("cloneできませんでした");
  await expect(alert.getByRole("button", { name: "コマンドをコピー" })).toBeVisible();
  await input.fill("/Users/me/src/crit");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${WS}$`));
  const posts = (await mockLog()).filter((r) => r.method === "POST" && r.path.endsWith("/workspaces"));
  expect(posts.length).toBe(3);
});
