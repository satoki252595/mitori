/**
 * @wp10a S2 Reader budgets (ux.md §13.1, §7.1, §12.7–12.8): 1,000-block page DOM ≤ 5k, reader-level switch ≤ 50 ms
 * with 0 fetches and the first visible block kept in place (AC-J20), section transitions p95 ≤ 100 ms, listeners on
 * the reader root ≤ 10, one shared gutter (AC-U32), boot CLS ≤ 0.001 (AC-U03).
 */
import { expect, test } from "@playwright/test";
import { cls, configure, emit, installCls, mockLog, now, p95, WS, waitMark } from "./support/helpers.ts";

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
  // AC-U03: the minimap's box is held while the map view loads, the header usage box is fixed, the margin tip sits
  // above the stats that grow with the page (was 0.0142: the path card + TOC dropped 142 px when the minimap came)
  expect(v).toBeLessThanOrEqual(0.001);
  const client = await page.context().newCDPSession(page);
  const { result } = await client.send("Runtime.evaluate", { expression: "document.querySelector('.reader-root')" });
  const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: result.objectId as string });
  expect(listeners.length).toBeLessThanOrEqual(10);
});

test("@wp10a the empty margin (「この節について」) stays once the loop UI is installed on a page without threads", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await expect(page.locator(".ctx .margin-empty .about")).toBeVisible();
  // the loop extension arrives after the first paint; its margin has nothing to show here — the about card must not vanish
  await expect(page.locator("#mitori-loop")).toBeAttached();
  await expect(page.locator(".ctx .margin-host")).toBeAttached();
  await page.waitForTimeout(300);
  await expect(page.locator(".ctx .margin-empty .about")).toBeVisible();
  await expect(page.locator(".rail .mini")).toHaveAttribute("href", /\/w\//);
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
    if (v > 0.001) console.log(`[cls-sources] ${JSON.stringify(await page.evaluate(() => (window as unknown as { __clsSources: unknown[] }).__clsSources))}`);
    expect(v).toBeLessThanOrEqual(0.001);
  });
}

test("@wp10a AC-U03 a returning browser draws the project chip as last shown: no reserved width, CLS ≤ 0.001 (1280×800)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installCls(page);
  await configure({ generated: false });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  // the first visit holds the usual width; the chip it showed is remembered
  await expect(page.locator(".hdr .proj.reserve")).toHaveCount(1);
  await expect(page.locator(".hdr .proj-name")).not.toHaveText("");
  await page.waitForTimeout(300);
  await page.reload();
  await waitMark(page, "mitori:map:painted");
  await page.waitForTimeout(1500);
  await expect(page.locator(".hdr .proj.reserve")).toHaveCount(0);
  const v = await cls(page);
  console.log(`[cls] map second boot 1280×800 ${v}`);
  expect(v).toBeLessThanOrEqual(0.001);
});

test("@wp10a TOC thread badges (ux.md §4.3.2-3): an open thread on a §3.1 block counts on §3.1 and its chapter §3; resolved ones do not", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3/review-cycle`);
  await waitMark(page, "mitori:section:rendered");
  const block = await page.locator('[data-sec="s3/review-cycle"] .blk').first().getAttribute("data-b");
  const thread = (id: string, state: string) => ({
    id,
    state,
    intent: "note",
    anchor: { doc: { block } },
    title: "",
    messages: 1,
    updatedAt: "2026-10-03T00:00:00Z",
  });
  await emit({ type: "thread.upsert", rev: 900, thread: thread("th_000000000001", "open") });
  await emit({ type: "thread.upsert", rev: 901, thread: thread("th_000000000002", "resolved") });
  await expect(page.locator('.toc a[data-toc="s3/review-cycle"] .tb')).toHaveText("●1");
  await expect(page.locator('.toc a[data-toc="s3"] .tb')).toHaveText("●1");
  await expect(page.locator('.toc a[data-toc="s4"] .tb')).toHaveCount(0);
});

test("@wp10a cite peek (ux.md §4.3.6): keyboard focus on a chip opens it touching the chip; it follows the chip when the page scrolls", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const chip = page.locator(".blk a.mcite").nth(2);
  await chip.scrollIntoViewIfNeeded();
  await page.keyboard.press("Tab"); // keyboard modality, so the chip's focus is :focus-visible
  await chip.focus();
  const peek = page.locator(".pop.peek");
  await expect(peek).toBeVisible();
  const gap = async () => {
    const c = await chip.boundingBox();
    const p = await peek.boundingBox();
    return c && p ? Math.min(Math.abs(p.y - (c.y + c.height)), Math.abs(c.y - (p.y + p.height))) : 999;
  };
  // the pop-in animation and the focus scroll settle within a few frames
  await expect.poll(gap, { timeout: 2000 }).toBeLessThanOrEqual(8);
  await page.mouse.wheel(0, 120);
  await expect.poll(gap, { timeout: 2000 }).toBeLessThanOrEqual(8);
  // re-placing a capped peek keeps it capped (it was measured at its capped height, un-capped and grew over the chip)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(120);
    expect(await gap()).toBeLessThanOrEqual(8);
  }
});

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

test("@wp10a NC-05 「この章で分かること」: inline code and terms stay in the line (no one-character columns)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const items = page.locator('.blk[data-kind="learn"] li');
  await expect(items.first()).toBeVisible();
  const m = await page.evaluate(() => {
    const out: { code: string; h: number; w: number; lh: number; liH: number }[] = [];
    for (const li of document.querySelectorAll<HTMLElement>('.blk[data-kind="learn"] li')) {
      const lh = Number.parseFloat(getComputedStyle(li).lineHeight);
      for (const c of li.querySelectorAll<HTMLElement>("code, abbr")) {
        const r = c.getBoundingClientRect();
        out.push({ code: c.textContent ?? "", h: r.height, w: r.width, lh, liH: li.getBoundingClientRect().height });
      }
    }
    return out;
  });
  expect(m.length).toBeGreaterThanOrEqual(3);
  for (const x of m) {
    // one line: the inline box is not taller than the line, and wider than one character
    expect(x.h, `${x.code} is one line`).toBeLessThanOrEqual(x.lh + 1);
    expect(x.w, `${x.code} is not squeezed into the number column`).toBeGreaterThan(14);
    expect(x.liH, `the item holding ${x.code} is at most two lines`).toBeLessThanOrEqual(x.lh * 2 + 6);
  }
});
