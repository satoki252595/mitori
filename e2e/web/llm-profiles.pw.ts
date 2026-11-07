/** @wp41 Composer の「使うLLM」select: 初期値は既定のLLM、選ぶと estimate に載る。 */
import { expect, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

test("@wp41 composer shows the LLM select with the default LLM first", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const p = page
    .locator(".blk p")
    .filter({ hasText: /.{70,}/ })
    .first();
  await p.scrollIntoViewIfNeeded();
  const box = await p.boundingBox();
  if (!box) throw new Error("no paragraph");
  await page.mouse.move(box.x + 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 8, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("e");
  const llm = page.getByRole("combobox", { name: "使うLLM", exact: true });
  await expect(llm).toBeVisible({ timeout: 10_000 });
  await expect(llm).toHaveValue("claude-cli");
});
