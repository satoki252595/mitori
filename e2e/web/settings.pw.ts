/** @wp10a S9 settings (ux.md §2.2, §4.3.6 ⇧O, §8.5): changes are saved with one debounced PATCH /settings. */
import { expect, test } from "@playwright/test";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

test("@wp10a settings: editor (⇧O target) and single-key switch are saved in one debounced PATCH", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  await page.getByLabel("エディタ（⇧Oで開く）").selectOption("vscode");
  await page.getByLabel("1文字のショートカットを使う").uncheck();
  await expect.poll(async () => (await mockLog()).filter((r) => r.method === "PATCH" && r.path.endsWith("/settings")).length, { timeout: 4000 }).toBe(1);
  const patch = (await mockLog()).find((r) => r.method === "PATCH")?.body as { patch: { ui: Record<string, unknown> } };
  expect(patch.patch.ui).toEqual({ editor: "vscode", singleKeyShortcuts: false });
});
