/**
 * EX-08 the context column (code mode) after an accepted Fix or its Undo: SSE `index.changed` for the open file
 * makes the pane re-read it at once (no version that is gone stays on screen), and when the file is no longer the
 * version the cite was made against, the pane says so instead of silently marking other lines.
 */
import { expect, test } from "@playwright/test";
import { configure, emit, mockLog, WS, waitMark } from "./support/helpers.ts";

test("@wp10a EX-08 code column re-reads the file on index.changed and flags a cite of another version", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const chip = page.locator(".blk a.mcite").first();
  await chip.focus();
  await page.keyboard.press("o");
  const ctx = page.locator("aside.ctx");
  await expect(ctx).toHaveAttribute("data-mode", "code");
  await expect(ctx.locator(".cpane [data-line]").first()).toBeVisible();
  // same version as the cite: no band
  await expect(ctx.locator(".cpane .other")).toHaveCount(0);
  const path = (await chip.getAttribute("data-cite"))?.split(":")[0] ?? "";
  const reads = async () => (await mockLog()).filter((r) => r.method === "GET" && r.path.includes("/files/content")).length;
  const before = await reads();
  await emit({ type: "index.changed", paths: [path], ifaceChanged: false });
  await expect.poll(reads, { timeout: 4000 }).toBeGreaterThan(before);
  await expect(ctx.locator(".cpane .other")).toBeVisible();
  await expect(ctx.locator(".cpane .meta")).toContainText("c0ffee1");
});
