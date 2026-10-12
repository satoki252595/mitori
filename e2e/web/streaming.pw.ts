/**
 * @wp10a Generation streaming in the Reader (ux.md §4.3.9, AC-J48, budget ui.cls.gen ≤ 0.01 / target 0): the
 * not-yet-generated part of a section is ONE reserved region (H_est); confirmed blocks and the open partial fill it
 * without moving what is below; a finished section keeps the reservation while it is on screen. No run ⇒ no
 * reservation (the page shows placeholders only).
 */
import { expect, type Page, test } from "@playwright/test";
import { BASE, chromiumMetric, configure, emit, installCls, mockLog, WS, waitMark } from "./support/helpers.ts";

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const clsNow = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
const pagerTop = (page: Page) => page.evaluate(() => document.querySelector(".pager")?.getBoundingClientRect().top ?? null);

test("@wp10a no active run: a pending section shows placeholders, no 生成中 region", async ({ page }) => {
  await configure({ generated: false });
  await page.goto(`/w/${WS}/doc/s1`);
  await waitMark(page, "mitori:section:rendered");
  await expect(page.locator(".sec-body.mstream")).toHaveCount(0);
  await expect(page.locator(".stream-note")).toHaveCount(0);
  await expect(page.locator(".blk.ph-wrap").first()).toBeVisible();
});

test("@wp10a streaming: blocks and the partial fill the reserved region; the content below never moves (CLS 0)", async ({ page, browserName }, info) => {
  const measureCLS = chromiumMetric(browserName, info, "streaming layout-shift");
  if (measureCLS) await installCls(page);
  await configure({ generated: false });
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.goto(`/w/${WS}/doc/s1`);
  await waitMark(page, "mitori:section:rendered");
  await post("/__mock/gen", { state: "running" });
  const region = page.locator('.sec-body.mstream[data-section="s1"]');
  await expect(region).toBeVisible();
  await expect(page.locator(".stream-note")).toContainText("生成中");
  // H_est for est.outTokens 3,000 (ja): clamp(3000 × 1.25 / 37 × 30.4, 120, 2400) = 2400 px
  expect((await region.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(2400);
  await page.waitForTimeout(200);
  const top0 = await pagerTop(page);
  expect(top0).not.toBeNull();
  const cls0 = measureCLS ? await clsNow(page) : null;
  for (let i = 0; i < 4; i++) {
    await post("/__mock/stream", { section: "s1", ord: 20 + i, partial: "デーモンは準備が整うまで、セッションに依存する" });
    await page.waitForTimeout(60);
    await post("/__mock/stream", { section: "s1", ord: 20 + i });
    await page.waitForTimeout(60);
  }
  await expect(page.locator(`.blk[data-b]`, { hasText: "" }).last()).toBeVisible();
  expect(await pagerTop(page)).toBe(top0);
  if (cls0 !== null) {
    const delta = (await clsNow(page)) - cls0;
    console.log(`[cls] streaming 4 blocks: ${delta}`);
    expect(delta).toBeLessThanOrEqual(0.001);
  }
  // done while the region is on screen: the reservation is held, nothing moves
  await post("/__mock/section", { section: "s1", state: "generated" });
  await post("/__mock/gen", { state: "done" });
  await page.waitForTimeout(300);
  expect(await pagerTop(page)).toBe(top0);
  await expect(page.locator(".stream-note:not(.held)")).toHaveCount(0);
  if (cls0 !== null) expect((await clsNow(page)) - cls0).toBeLessThanOrEqual(0.001);
  // still on screen: held (only a navigation or scrolling it out of view lets it go)
  await expect(page.locator('.sec-body.mstream[data-section="s1"]')).toHaveCount(1);
});

test("@wp5 generating Reader: partials and task/usage/job events never refetch /ui; confirmed blocks land throttled (~2 s)", async ({ page }) => {
  await configure({ generated: false });
  await page.goto(`/w/${WS}/doc/s1`);
  await waitMark(page, "mitori:section:rendered");
  await post("/__mock/gen", { state: "running" });
  await expect(page.locator('.sec-body.mstream[data-section="s1"]')).toBeVisible();
  const uiReads = async () => (await mockLog()).filter((r) => r.method === "GET" && /\/ui\?/.test(r.path)).length;
  // The run start refetches /ui throttled (~2 s), so under load it can land after a fixed
  // sleep. Wait until the /ui count stops changing before taking the baseline (no long sleep).
  const waitForUiSettled = async (stableMs = 2500, timeoutMs = 15000, pollMs = 250) => {
    let last = await uiReads();
    let settledSince = Date.now();
    const start = settledSince;
    for (;;) {
      await page.waitForTimeout(pollMs);
      const cur = await uiReads();
      const at = Date.now();
      if (cur !== last) {
        last = cur;
        settledSince = at;
      }
      if (at - settledSince >= stableMs) return last;
      if (at - start >= timeoutMs) return last;
    }
  };
  const before = await waitForUiSettled();
  // partials and task/usage/job events alone never refetch
  for (let i = 0; i < 3; i++) {
    await post("/__mock/stream", { section: "s1", ord: 40 + i, partial: "途中経過のテキスト" });
    await page.waitForTimeout(60);
    await emit({
      type: "gen.task",
      task: { id: `gt_wp5000${i}`, stage: "S5", target: { kind: "module", id: "md_wp5" }, state: "running", priority: 0, attempt: 1, blocks: [] },
    });
    await emit({
      type: "usage.updated",
      today: { calls: 5, in: 19000, cacheWrite: 1000, cacheRead: 2000, out: 500, apiUsd: 0.15 },
    });
    await emit({
      type: "job.upsert",
      job: { id: "j_0000000001", ws: WS, kind: "fix", state: "running", threads: [], createdAt: "2026-10-03T00:00:00Z" },
    });
    await page.waitForTimeout(150);
  }
  expect(await uiReads()).toBe(before);
  // a burst of confirmed blocks is throttled to ~one fetch per 2 s window, and the blocks still land mid-run
  // (placeholders carry .ph-wrap and skeletons aria-busy; confirmed blocks carry neither)
  const done = page.locator(".blk[data-b]:not(.ph-wrap):not([aria-busy])");
  const have = await done.count();
  const burst = await waitForUiSettled();
  for (let i = 0; i < 4; i++) {
    await post("/__mock/stream", { section: "s1", ord: 40 + i });
    await page.waitForTimeout(150);
  }
  // ~0.6 s of upserts: at most one throttled fetch so far
  expect(await uiReads()).toBeLessThanOrEqual(burst + 1);
  // confirmed blocks land within ~2 s of the last change
  await expect(done).toHaveCount(have + 4, { timeout: 8000 });
  expect(await uiReads()).toBeLessThanOrEqual(burst + 2);
  // the section flip and the run end still land
  await post("/__mock/section", { section: "s1", state: "generated" });
  await post("/__mock/gen", { state: "done" });
  await expect(page.locator(".stream-note:not(.held)")).toHaveCount(0, { timeout: 8000 });
});

test("@wp10a streaming: a finished section held on screen lets its reservation go once scrolled out of view; the reading position stays", async ({ page }) => {
  await configure({ generated: false });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await post("/__mock/gen", { state: "running" });
  const first = page.locator('.sec-body.mstream[data-section="s3"]');
  await expect(first).toBeVisible();
  await post("/__mock/section", { section: "s3", state: "generated" });
  await page.waitForTimeout(300);
  await expect(first).toHaveCount(1); // on screen at the top: held
  // read on: §3.2 at the top of the viewport; §3's region is above, out of view => released with compensation
  const story = page.locator('[data-sec="s3/story"]');
  await story.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(100);
  const anchor = page.locator('[data-sec="s3/story"] .blk').first();
  const before = (await anchor.boundingBox())?.y ?? 0;
  await expect(first).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(Math.abs(((await anchor.boundingBox())?.y ?? 0) - before)).toBeLessThanOrEqual(4);
});
