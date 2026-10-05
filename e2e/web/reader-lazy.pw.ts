import { expect, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

test("@wp10a Reader first-use tools stay cold; o works while a peek chunk waits and does not revive it", async ({ page }) => {
  await configure({ generated: true });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/ReaderTools-*.js", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await expect(page.locator(".ctx .margin-empty")).toBeVisible();
  expect(requests.some((url) => /\/(ReaderTools|ContextCode|CodePane)-/.test(url))).toBe(false);

  await page.keyboard.press("Tab");
  const chip = page.locator(".blk a.mcite").first();
  await chip.focus();
  await expect.poll(() => requests.filter((url) => /\/ReaderTools-[^/]+\.js$/.test(url)).length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctx")).toHaveAttribute("data-mode", "margin");
  await page.keyboard.press("o");
  await expect(page.locator(".ctx")).toHaveAttribute("data-mode", "code");
  await expect(page.locator(".ctx .cpane")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctx")).toHaveAttribute("data-mode", "margin");
  const response = page.waitForResponse((res) => /\/ReaderTools-[^/]+\.js$/.test(res.url()));
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator(".pop")).toHaveCount(0);
  expect(errors).toEqual([]);
});
