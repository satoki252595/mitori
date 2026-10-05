/**
 * @wp10a IME guard (ux.md §8.6, IME_RULES; MILESTONES WP-10a): trusted key events through CDP.
 *   - keyCode 229 on the page (IME on, no editable focus): no shortcut fires, the one-time hint toast appears.
 *   - Enter / Escape while a composition is active in the ⌘K input: nothing runs, the palette stays open;
 *     after the commit the same Enter opens the item.
 */
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

test.skip(({ browserName }) => browserName !== "chromium", "Trusted IME automation requires Chromium CDP; other engines run DOM event replay.");

async function key(cdp: CDPSession, type: "keyDown" | "keyUp" | "rawKeyDown", key: string, code: string, keyCode: number) {
  await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

async function reader(page: Page) {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  return page.context().newCDPSession(page);
}

test("@wp10a IME: keyCode 229 fires no single-key shortcut and shows the IME hint once", async ({ page }) => {
  const cdp = await reader(page);
  const url = page.url();
  // j / g m / - would move focus, navigate or change the level — all as keyCode 229 (IME processing)
  for (const [k, c] of [
    ["j", "KeyJ"],
    ["g", "KeyG"],
    ["m", "KeyM"],
    ["-", "Minus"],
  ] as const) {
    await key(cdp, "rawKeyDown", k, c, 229);
    await key(cdp, "keyUp", k, c, 229);
  }
  await page.waitForTimeout(150);
  await expect(page.locator(".blk.focus")).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => document.documentElement.dataset.level)).toBe("standard");
  const hint = page.locator(".toast", { hasText: "日本語入力がオンのため" });
  await expect(hint).toHaveCount(1);
  // once per session
  await key(cdp, "rawKeyDown", "j", "KeyJ", 229);
  await page.waitForTimeout(100);
  await expect(hint).toHaveCount(1);
  // IME off again: the same key works
  await page.keyboard.press("j");
  await expect(page.locator(".blk.focus")).toHaveCount(1);
});

test("@wp10a IME: Enter / Escape during composition in ⌘K do nothing; Enter after the commit opens the item", async ({ page }) => {
  const cdp = await reader(page);
  const url = page.url();
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator(".pal input[role=combobox]");
  await expect(input).toBeFocused();
  // composing 「もちこし」: the list previews while composing (input events)
  await cdp.send("Input.imeSetComposition", { text: "もちこし", selectionStart: 4, selectionEnd: 4 });
  await expect(page.locator(".pal-it").first()).toContainText("持ち越し");
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe("もちこし");
  // Enter while composing (Chromium sends keyCode 229 + isComposing): no navigation, palette stays
  await key(cdp, "rawKeyDown", "Enter", "Enter", 229);
  await key(cdp, "keyUp", "Enter", "Enter", 13);
  await page.waitForTimeout(150);
  await expect(page.locator(".pal")).toHaveCount(1);
  expect(page.url()).toBe(url);
  // Escape while composing cancels the composition only
  await key(cdp, "rawKeyDown", "Escape", "Escape", 229);
  await key(cdp, "keyUp", "Escape", "Escape", 27);
  await page.waitForTimeout(150);
  await expect(page.locator(".pal")).toHaveCount(1);
  // commit, then a real Enter runs the top item (glossary → §12)
  await cdp.send("Input.insertText", { text: "もちこし" });
  await expect(page.locator(".pal-it").first()).toContainText("持ち越し");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pal")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s12`));
});
