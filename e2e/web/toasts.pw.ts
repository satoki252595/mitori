/**
 * @wp10a toasts (ux.md §3.5-5, WCAG 2.2.1): the lifetime stops while the pointer OR the focus is inside and runs
 * again only when both have left; the overage notice appears once per session (§3.4).
 */
import { expect, test } from "@playwright/test";
import { configure, WS } from "./support/helpers.ts";

test("@wp10a a warn toast stays while focused even after the pointer leaves; it expires once focus leaves too", async ({ page }) => {
  await page.clock.install();
  await configure({ billing: "overage" });
  await page.goto(`/w/${WS}`);
  const toast = page.locator(".toast", { hasText: "従量で課金されます" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button").focus();
  await toast.hover();
  await page.mouse.move(5, 300);
  await page.clock.runFor(9000);
  await expect(toast).toBeVisible();
  await page.locator(".brand").focus();
  await page.clock.runFor(9000);
  await expect(toast).toHaveCount(0);
  // once per session
  await page.reload();
  await page.clock.runFor(1000);
  await expect(page.locator(".toast", { hasText: "従量で課金されます" })).toHaveCount(0);
});
