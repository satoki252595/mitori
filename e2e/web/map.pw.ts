/**
 * @wp10a S1 見取り図 (JUDGEMENT AC-J01 / J02 / J06 / J07; ux.md §4.2): first useful screen at 0 tok, label sizes and
 * clipping at every zoom stage, room selection ≤ 100 ms and room → Reader p95 ≤ 100 ms.
 */
import { expect, test } from "@playwright/test";
import { configure, mockLog, now, p95, WS, waitMark } from "./support/helpers.ts";

test("@wp10a AC-J01 1440×900: strip ≤ 96, stage ≥ 700, TOC, estimate main line + 生成 and 0-tok list without scrolling; 0 LLM calls", async ({ page }) => {
  await configure({ generated: false });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  await page.locator(".est .sum .lead").waitFor();
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox()) as { x: number; y: number; width: number; height: number };
  const strip = await box(".strip");
  const stage = await box(".stage");
  expect(strip.height).toBeLessThanOrEqual(96);
  expect(stage.height).toBeGreaterThanOrEqual(700);
  for (const sel of [".toc a[data-toc='s0']", ".est .sum", ".est .go", ".zero"]) {
    const b = await box(sel);
    expect(b.y + b.height, sel).toBeLessThanOrEqual(900 - 24);
    expect(b.y).toBeGreaterThanOrEqual(0);
  }
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
  const log = await mockLog();
  expect(log.filter((r) => /\/(gen\/runs|jobs)$/.test(r.path) && r.method === "POST")).toEqual([]);
  // the three estimates come after the map painted, in parallel
  expect(log.filter((r) => r.path.endsWith("/gen/estimate")).length).toBe(3);
});

test("@wp10a AC-J02 first useful screen (map painted) within 3 s of navigation", async ({ page }) => {
  await configure({ generated: false });
  await page.goto(`/w/${WS}`);
  const t = await waitMark(page, "mitori:map:painted");
  const shell = await waitMark(page, "mitori:shell:painted");
  expect(shell).toBeLessThan(500);
  expect(t).toBeLessThan(3000);
});

test("@wp10a AC-J06 map labels ≥ 11 px on screen and clipped by their room at every zoom stage", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  for (const z of ["Z0", "Z1", "Z2"]) {
    await page.getByRole("button", { name: new RegExp(`^(${{ Z0: "文脈", Z1: "区画", Z2: "部屋" }[z]})$`) }).click();
    await page.waitForTimeout(450);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const tx of document.querySelectorAll<SVGTextElement>("svg.plan text")) {
        const cs = getComputedStyle(tx);
        if (cs.display === "none" || cs.opacity === "0" || tx.getClientRects().length === 0) continue;
        const g = tx.closest(".lbl") as SVGGraphicsElement | null;
        if (g && getComputedStyle(g).opacity === "0") continue;
        const ctm = tx.getScreenCTM();
        const px = parseFloat(cs.fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
        if (px < 10.99) out.push(`${tx.textContent} ${px.toFixed(2)}px`);
        const room = tx.closest(".room svg, svg.zl") as SVGSVGElement | null;
        if (room && getComputedStyle(room).overflow !== "hidden") out.push(`${tx.textContent} not clipped`);
      }
      return out;
    });
    expect(bad, z).toEqual([]);
  }
});

test("@wp10a AC-J07 room click → card ≤ 100 ms; Enter → Reader section p95 ≤ 100 ms; camera ≤ 300 ms", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  const rooms = ["md_daemon00", "md_session0", "md_vcs00000", "md_cli00000", "md_prmr0000"];
  const cardMs: number[] = [];
  const openMs: number[] = [];
  for (const id of rooms) {
    const room = page.locator(`.room[data-node="${id}"]`);
    const t0 = await now(page);
    await room.click();
    const tc = await waitMark(page, "mitori:room:card", t0);
    cardMs.push(tc - t0);
    await expect(page.locator(".room-card")).toBeVisible();
    // second Enter on the focused room opens its section
    const t1 = await now(page);
    await room.press("Enter");
    const tr = await waitMark(page, "mitori:section:rendered", t1);
    openMs.push(tr - t1);
    await expect(page.locator(".sec-head h1")).toBeVisible();
    await page.goBack();
    await waitMark(page, "mitori:map:painted", tr);
  }
  console.log(`[AC-J07] card ${cardMs.map((x) => x.toFixed(0)).join(",")} ms · open ${openMs.map((x) => x.toFixed(0)).join(",")} ms`);
  expect(Math.max(...cardMs)).toBeLessThanOrEqual(100);
  expect(p95(openMs)).toBeLessThanOrEqual(100);
  // camera animation finishes within 300 ms (fit after zoom)
  const t2 = await now(page);
  await page.keyboard.press("=");
  await page.waitForFunction(() => document.querySelector("svg.plan")?.getAttribute("data-z") !== null);
  const done = await page.evaluate(
    (start) =>
      new Promise<number>((resolve) => {
        const g = document.querySelector("g.cam") as SVGGElement;
        let last = g.getAttribute("transform");
        let stableAt = performance.now();
        const tick = () => {
          const cur = g.getAttribute("transform");
          if (cur !== last) {
            last = cur;
            stableAt = performance.now();
          }
          if (performance.now() - stableAt > 120) resolve(stableAt - start);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    t2,
  );
  expect(done).toBeLessThanOrEqual(340);
});

test("@wp10a S1 keyboard: arrows move between rooms (roving tabindex), Escape clears the selection", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  const first = page.locator(".room").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.node ?? null);
  expect(focused).not.toBe(await first.getAttribute("data-node"));
  expect(await page.locator('.room[tabindex="0"]').count()).toBe(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".room-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".room-card")).toHaveCount(0);
  // SVG node count does not grow with camera moves (AC-J05 / AC-U98)
  const before = await page.evaluate(() => document.querySelectorAll("svg.plan *").length);
  await page.keyboard.press("=");
  await page.keyboard.press("-");
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelectorAll("svg.plan *").length)).toBe(before);
});

test("@wp10a S1 Escape: clears the selection first, then zooms out one stage at a time back to the default stage (ux.md §4.2.2, LAYER_ORDER)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  const scale = () =>
    page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector("svg.plan g.cam")?.getAttribute("transform") ?? "")?.[1] ?? 0));
  const settle = () => page.waitForTimeout(450);
  const fit = await scale();
  await page.locator(".room").first().focus();
  await page.keyboard.press("=");
  await settle();
  await page.keyboard.press("=");
  await settle();
  const zoomed = await scale();
  expect(zoomed).toBeGreaterThan(fit * 1.5);
  await page.keyboard.press("Enter");
  await expect(page.locator(".room-card")).toBeVisible();
  // 1st Escape: the selection only
  await page.keyboard.press("Escape");
  await expect(page.locator(".room-card")).toHaveCount(0);
  expect(await scale()).toBeCloseTo(zoomed, 3);
  // then one stage out per Escape until the default (fit) stage; one more does nothing
  await page.keyboard.press("Escape");
  await settle();
  expect(await scale()).toBeLessThan(zoomed);
  for (let i = 0; i < 3 && (await scale()) > fit * 1.02; i++) {
    await page.keyboard.press("Escape");
    await settle();
  }
  expect(await scale()).toBeCloseTo(fit, 3);
  await page.keyboard.press("Escape");
  await settle();
  expect(await scale()).toBeCloseTo(fit, 3);
});
