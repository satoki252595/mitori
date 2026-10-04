/**
 * F6 / F7 a 10,000-block section in the Reader (the size complete-effort S8 notes can reach): first paint, the
 * DOM stays bounded while scrolling (virtual windows), the JS heap after GC, the ⌘K full-text index over it, and a
 * jump to a far block. Measurements are printed (`[big]`) and recorded as annotations; the hard limits are the
 * structural ones (ux.md §13.3: DOM ≤ 15k nodes) and a heap ceiling with wide headroom (timings are not asserted
 * here — the machine is shared; bench cases own them).
 */

import type { DocOutline } from "@mitori/core";
import { expect, test } from "@playwright/test";
import { configure, emit, WS, waitMark } from "./support/helpers.ts";

const N = Number(process.env.MITORI_BIG_BLOCKS ?? 10_000);

test("@wp10a F6 a far anchor has HTML at first paint and idle fetches omit the repeated outline", async ({ page }) => {
  await configure({ generated: true, bigBlocks: 1000 });
  const outline = (await (await page.request.get(`/api/v1/ws/${WS}/doc`)).json()) as DocOutline;
  const block = outline.blocks.filter((b) => b[1] === "s6/big")[900]?.[0];
  expect(block).toBeTruthy();
  const queries: URLSearchParams[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.endsWith("/doc/sections/s6%2Fbig")) queries.push(url.searchParams);
  });
  await page.goto(`/w/${WS}/doc/s6/big#${block}`);
  await waitMark(page, "mitori:section:rendered");
  const paragraph = page.locator(`.blk[data-b="${block}"] > .mb`);
  await expect(paragraph).toBeAttached();
  expect(queries[0]?.get("from")).toBe("850");
  expect(queries[0]?.get("limit")).toBe("150");
  await expect.poll(() => queries.some((q) => q.get("outline") === "false")).toBe(true);
  await emit({ type: "doc.freshness", blocks: [block], freshness: "stale" });
  await expect(paragraph).toHaveAttribute("data-fresh", "stale");
});

test(`@wp10a F6/F7 ${N}-block section: DOM bounded, heap measured, ⌘K full text over it`, async ({ page }, info) => {
  test.setTimeout(180_000);
  await configure({ generated: true, bigBlocks: N });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const u = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number; totalSize: number };
    return Math.round(u.usedSize / 1e5) / 10; // MB
  };
  await page.goto(`/w/${WS}/doc/s0`);
  await waitMark(page, "mitori:section:rendered");
  const heap0 = await heap();
  const t0 = await page.evaluate(() => performance.now());
  await page.goto(`/w/${WS}/doc/s6/big`);
  const painted = await waitMark(page, "mitori:section:rendered", 0, 60_000);
  const firstPaintMs = Math.round(painted - (await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.startTime ?? 0)));
  void t0;
  await page.waitForTimeout(500);
  const nodes = () => page.evaluate(() => document.getElementsByTagName("*").length);
  const n0 = await nodes();
  let maxNodes = n0;
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 9000);
    await page.waitForTimeout(60);
    maxNodes = Math.max(maxNodes, await nodes());
  }
  const heapReader = await heap();
  // ⌘K: the doc text index builds over every section, the 10k-block one included
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.locator(".pal input").waitFor();
  const ti = await page.evaluate(() => performance.now());
  await page.keyboard.type("セッション");
  await page.locator(".pal-it.txt").first().waitFor({ timeout: 60_000 });
  const textMs = Math.round((await page.evaluate(() => performance.now())) - ti);
  await page.waitForFunction(() => !/索引中|indexing/.test(document.querySelector(".pal-foot")?.textContent ?? ""), null, { timeout: 60_000 });
  const heapIndexed = await heap();
  await page.keyboard.press("Escape");
  const m = {
    blocks: N,
    firstPaintMs,
    nodesAtPaint: n0,
    maxNodes,
    heapMb: { s0: heap0, reader: heapReader, withTextIndex: heapIndexed },
    fullTextFirstHitMs: textMs,
  };
  console.log(`[big] ${JSON.stringify(m)}`);
  info.annotations.push({ type: "big-section", description: JSON.stringify(m) });
  expect(maxNodes).toBeLessThanOrEqual(15_000);
  // ≈ 2 KB of HTML per mock block: the section alone is ~20 MB of strings; the ceiling only catches a leak (×2)
  expect(heapIndexed).toBeLessThan(heap0 + N * 0.006 + 80);
});
