/**
 * @wp10a in-app 「HTMLとして書き出す」 (ux.md §4.13, UXP-18): opened from ⌘K and from the settings page; every option
 * change re-runs `POST /ws/:ws/export` (debounced, the latest answer wins) and the summary describes the file that
 * answer is — its size, the code excerpts or 「コードは含みません」, the masked secrets; ダウンロード saves that very
 * result (no second request) as `<title>-mitori-<date>.html`.
 */
import { expect, test } from "@playwright/test";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

const exports = async () => (await mockLog()).filter((r) => r.method === "POST" && r.path.endsWith("/export"));
const lastBody = async <T>() => (await exports()).at(-1)?.body as T | undefined;

test("@wp10a export dialog from ⌘K: the summary follows the options, the download is the last answer", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".pal input").fill("書き出");
  await expect(page.locator(".pal-it", { hasText: "HTMLとして書き出す" }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  const dlg = page.locator("dialog.exp");
  await expect(dlg).toBeVisible();
  const facts = dlg.locator(".facts");
  await expect(facts).toContainText("1.08 MB");
  await expect(facts).toContainText("12");
  await expect(facts).toContainText("1件");
  // excerpts off → one more export, and the summary says the file has no code
  const before = (await exports()).length;
  await dlg.getByRole("checkbox", { name: /コードの抜粋/ }).uncheck();
  await expect(facts).toContainText("561 KB");
  await expect(facts).toContainText("コードは含みません");
  await expect.poll(async () => (await exports()).length).toBe(before + 1);
  expect((await lastBody<{ excerpts: boolean }>())?.excerpts).toBe(false);
  // two quick changes: the last state is what is exported (debounced; on a loaded machine both may go out — the
  // latest answer still wins)
  await dlg.locator("label", { hasText: "詳しい" }).click();
  await dlg.locator("label", { hasText: "初めて" }).click();
  await expect.poll(async () => (await lastBody<{ level: string }>())?.level).toBe("newcomer");
  await expect(dlg.locator(".upd")).toHaveCount(0);
  const n = (await exports()).length;
  const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "ダウンロード" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/-mitori-\d{4}-\d{2}-\d{2}\.html$/);
  expect((await exports()).length).toBe(n);
  await expect(dlg).toHaveCount(0);
});

test("@wp10a export dialog from the settings page; Escape closes it and returns focus to the button", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  const open = page.getByRole("button", { name: "HTMLとして書き出す…" });
  await open.click();
  const dlg = page.locator("dialog.exp");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".facts")).toContainText("1.08 MB");
  // the language option is the viewer's chrome: it says so — a newcomer must not expect a translated document
  const langGroup = dlg.getByRole("radiogroup", { name: "画面の言語" });
  await expect(langGroup).toBeVisible();
  await expect(langGroup).toHaveAccessibleDescription(/翻訳はしません/);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(open).toBeFocused();
});
