/**
 * @wp10a IME guard on WebKit (ux.md §8.6 I2 / I3 / I8 / I12, M3 gate "IME e2e chromium + webkit"). WebKit has no
 * IME automation, so the Safari event orders are replayed as DOM events in the page — the registry (one capture
 * listener on window) and `isComposing` handle them exactly like native ones:
 *   I2  compositionend → keydown Enter keyCode 229            ⇒ nothing runs
 *   I3  compositionend → keydown Enter keyCode 13 (same task) ⇒ nothing runs (rule 3); the next task's Enter runs
 *   I8  keyCode 229 / key "Process" on the page               ⇒ no shortcut, one hint
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

/** Dispatch a keydown with the legacy fields WebKit really sends (keyCode / isComposing are not settable via init). */
async function keydown(page: Page, init: { key: string; code: string; keyCode: number; isComposing?: boolean; composedFirst?: boolean }) {
  await page.evaluate((o) => {
    const target = document.activeElement ?? document.body;
    if (o.composedFirst) target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "もちこし" }));
    const e = new KeyboardEvent("keydown", { key: o.key, code: o.code, bubbles: true, cancelable: true, isComposing: !!o.isComposing });
    Object.defineProperty(e, "keyCode", { value: o.keyCode });
    Object.defineProperty(e, "which", { value: o.keyCode });
    target.dispatchEvent(e);
  }, init);
}

test("@wp10a IME (webkit): keyCode 229 on the page fires nothing and shows the hint once (I8)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await keydown(page, { key: "Process", code: "KeyJ", keyCode: 229 });
  await keydown(page, { key: "j", code: "KeyJ", keyCode: 229 });
  await page.waitForTimeout(100);
  await expect(page.locator(".blk.focus")).toHaveCount(0);
  await expect(page.locator(".toast", { hasText: "日本語入力がオンのため" })).toHaveCount(1);
  await keydown(page, { key: "j", code: "KeyJ", keyCode: 74 });
  await expect(page.locator(".blk.focus")).toHaveCount(1);
});

test("@wp10a IME (webkit): Safari orders in ⌘K — compositionend + Enter (229 or 13, same task) do nothing; the next Enter opens (I2, I3, I12)", async ({
  page,
}) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const url = page.url();
  await page.keyboard.press("Meta+k");
  const input = page.locator(".pal input[role=combobox]");
  await expect(input).toBeFocused();
  await input.fill("もちこし");
  await expect(page.locator(".pal-it").first()).toContainText("持ち越し");
  // I2: keyCode 229 after compositionend
  await keydown(page, { key: "Enter", code: "Enter", keyCode: 229, composedFirst: true });
  // I3: keyCode 13 in the same task as compositionend
  await keydown(page, { key: "Enter", code: "Enter", keyCode: 13, composedFirst: true });
  // composing Escape: only the composition is cancelled
  await keydown(page, { key: "Escape", code: "Escape", keyCode: 229, isComposing: true });
  await page.waitForTimeout(100);
  await expect(page.locator(".pal")).toHaveCount(1);
  expect(page.url()).toBe(url);
  // a later task: the Enter runs the top item (glossary → §12)
  await keydown(page, { key: "Enter", code: "Enter", keyCode: 13 });
  await expect(page.locator(".pal")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s12`));
});
