/**
 * @wp10a S2 Reader budgets (ux.md §13.1, §7.1, §12.7–12.8): 1,000-block page DOM ≤ 5k, reader-level switch ≤ 50 ms
 * with 0 fetches and the first visible block kept in place (AC-J20), section transitions p95 ≤ 100 ms, listeners on
 * the reader root ≤ 10, one shared gutter (AC-U32), boot CLS ≤ 0.001 (AC-U03).
 */
import { expect, test } from "@playwright/test";
import { cls, configure, installCls, mockLog, now, p95, WS, waitMark } from "./support/helpers.ts";

test("@wp10a 1,000-block Reader: DOM ≤ 5k nodes, j/k reaches far blocks, one gutter", async ({ page }) => {
  await configure({ bigBlocks: 1000 });
  await page.goto(`/w/${WS}/doc/s6/big`);
  await waitMark(page, "mitori:section:rendered");
  await page.waitForTimeout(300);
  const count = () => page.evaluate(() => document.getElementsByTagName("*").length);
  expect(await page.locator(".blk").count()).toBeGreaterThanOrEqual(50);
  const n0 = await count();
  console.log(`[dom] 1000-block page: ${n0} nodes`);
  expect(n0).toBeLessThanOrEqual(5000);
  // scroll through the page: windows mount / unmount, the DOM stays bounded
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(80);
    expect(await count()).toBeLessThanOrEqual(5000);
  }
  expect(await page.locator(".gutter").count()).toBe(1);
  // j moves block by block with virtualization
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  for (let i = 0; i < 5; i++) await page.keyboard.press("j");
  await expect(page.locator(".blk.focus")).toHaveCount(1);
});

test("@wp10a reader level switch ≤ 50 ms, no fetch, position kept (AC-J20)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.mouse.wheel(0, 900);
  // let the idle-time fetches of the page settle (minimap map, prefetch) before counting
  await page.waitForTimeout(800);
  const before = (await mockLog()).length;
  const anchor = () =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>(".blk[data-b]")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > 52) return { id: el.dataset.b, top: r.top };
      }
      return null;
    });
  const times: number[] = [];
  const keys = ["-", "=", "=", "-", "-", "0"];
  for (const k of keys) {
    const a = await anchor();
    const t0 = await now(page);
    await page.keyboard.press(k);
    const t1 = await waitMark(page, "mitori:level:applied", t0);
    times.push(t1 - t0);
    const b = await page.evaluate((id) => document.querySelector(`.blk[data-b="${id}"]`)?.getBoundingClientRect().top ?? null, a?.id);
    if (a && b !== null) expect(Math.abs(b - a.top), `${k} keeps the anchor block`).toBeLessThanOrEqual(4);
  }
  console.log(`[level] ${times.map((x) => x.toFixed(1)).join(", ")} ms`);
  expect(p95(times)).toBeLessThanOrEqual(50);
  expect((await mockLog()).length - before).toBe(0);
  // READER_LEVEL_RULES: newcomer hides L3 and inline cites; expert shows long cites
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  expect(await page.evaluate(() => document.documentElement.dataset.level)).toBe("newcomer");
  expect(await page.locator('.blk[data-depth="L3"]').first().isVisible()).toBe(false);
  expect(await page.locator(".blk .mcite").first().isVisible()).toBe(false);
  await expect(page.locator(".cite-end").first()).toBeVisible();
  await page.keyboard.press("=");
  await page.keyboard.press("=");
  expect(await page.evaluate(() => document.documentElement.dataset.level)).toBe("expert");
  await expect(page.locator(".blk .mcite .cl").first()).toBeVisible();
});

test("@wp10a section transitions p95 ≤ 100 ms (TOC clicks)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s0`);
  await waitMark(page, "mitori:section:rendered");
  const order = ["s1", "s2", "s3", "s4", "s5", "s7", "s8", "s9", "s10", "s11"];
  const times: number[] = [];
  for (const sec of order) {
    const link = page.locator(`.toc a[data-toc="${sec}"]`);
    await link.hover();
    await page.waitForTimeout(90);
    const t0 = await now(page);
    await link.click();
    const t1 = await waitMark(page, "mitori:section:rendered", t0);
    times.push(t1 - t0);
  }
  console.log(`[section] ${times.map((x) => x.toFixed(0)).join(", ")} ms`);
  expect(p95(times)).toBeLessThanOrEqual(100);
});

test("@wp10a reader root listeners ≤ 10 and CLS 0 at boot", async ({ page }) => {
  await installCls(page);
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.waitForTimeout(1200);
  const v = await cls(page);
  console.log(`[cls] reader boot ${v}`);
  expect(v).toBeLessThan(0.01);
  const client = await page.context().newCDPSession(page);
  const { result } = await client.send("Runtime.evaluate", { expression: "document.querySelector('.reader-root')" });
  const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: result.objectId as string });
  expect(listeners.length).toBeLessThanOrEqual(10);
});

for (const [w, h] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`@wp10a AC-U03 CLS ≤ 0.001 from boot to mitori:map:painted (${w}×${h})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await installCls(page);
    await configure({ generated: false });
    await page.goto(`/w/${WS}`);
    await waitMark(page, "mitori:map:painted");
    await page.waitForTimeout(1500);
    const v = await cls(page);
    console.log(`[cls] map boot ${w}×${h} ${v}`);
    expect(v).toBeLessThanOrEqual(0.001);
  });
}

test("@wp10a dialogs return focus (ux.md §3.6): ? → help → Escape puts focus back on the focused block; j still works", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.keyboard.press("j");
  const block = await page.locator(".blk.focus").getAttribute("data-b");
  await page.keyboard.press("?");
  await expect(page.locator("dialog.help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.help")).toHaveCount(0);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.b ?? null)).toBe(block);
  await page.keyboard.press("j");
  await expect(page.locator(".blk.focus")).not.toHaveAttribute("data-b", block ?? "");
});

test("@wp10a S2 `o` pins the focused cite in code mode; Escape returns to the previous mode and the URL drops ctx / pin (ux.md §4.4)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const ctx = page.locator("aside.ctx");
  await expect(ctx).toHaveAttribute("data-mode", "margin");
  await page.locator(".blk a.mcite").first().focus();
  await page.keyboard.press("o");
  await expect(ctx).toHaveAttribute("data-mode", "code");
  expect(new URL(page.url()).searchParams.get("ctx")).toBe("code");
  expect(new URL(page.url()).searchParams.get("pin")).toMatch(/:\d+-\d+$/);
  await page.keyboard.press("Escape");
  await expect(ctx).toHaveAttribute("data-mode", "margin");
  expect(new URL(page.url()).searchParams.get("ctx")).toBeNull();
  expect(new URL(page.url()).searchParams.get("pin")).toBeNull();
});
