/** Canonical SSR + native Reader + full editor hand-off, using the same production asset snapshot. */
import { expect, test } from "@playwright/test";
import { BASE, configure, WS, waitMark } from "./support/helpers.ts";

test("native canonical Reader keeps tools cold through j/k, level, far hash and TOC", async ({ page }) => {
  await configure({ bigBlocks: 1000 });
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/w/${WS}/doc/s6/big`);
  await waitMark(page, "mitori:section:rendered");
  expect(await page.locator(".blk").count()).toBeLessThanOrEqual(150);
  await expect(page.locator("template[data-reader-window]").first()).toBeAttached();
  await page.keyboard.press("j");
  const first = await page.locator(".blk.focus").getAttribute("data-b");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(page.locator(".blk.focus")).toHaveAttribute("data-b", first!);
  await page.keyboard.press("-");
  await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
  await page.keyboard.press("=");
  await expect(page.locator("html")).toHaveAttribute("data-level", "standard");
  const section = (await (await fetch(`${BASE}/api/v1/ws/${WS}/doc/sections/s6%2Fbig`)).json()) as { blocks: { id: string }[] };
  const far = section.blocks[850]!.id;
  const initialResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/ws/${WS}/ui`);
  await page.goto(`/w/${WS}/doc/s6/big#${far}`);
  const initial = (await (await initialResponse).json()) as { html: string };
  const serverCounts = await page.evaluate((html) => {
    const rendered = new DOMParser().parseFromString(html, "text/html");
    return { windows: rendered.querySelectorAll(".bwin").length, blocks: rendered.querySelectorAll(".blk").length };
  }, initial.html);
  expect(serverCounts.windows).toBe(3);
  expect(serverCounts.blocks).toBeLessThanOrEqual(150);
  await waitMark(page, "mitori:section:rendered");
  await expect(page.locator(".blk.focus")).toHaveAttribute("data-b", far);
  await expect(page.locator(`.blk[data-b="${far}"]`)).toBeVisible();
  // The existing window policy includes the viewport and one neighbour on each side; a window boundary can
  // show two windows. Its real hard budget is DOM <= 5k, not an invented always-three-windows restriction.
  expect(await page.locator(".bwin").count()).toBeLessThanOrEqual(4);
  expect(await page.evaluate(() => document.getElementsByTagName("*").length)).toBeLessThanOrEqual(5000);
  await page.locator('.toc a[data-toc="s3"]').click();
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s3$`));
  await expect(page.locator(".reader-root .blk").first()).toBeVisible();
  expect(scripts.filter((url) => /\/(main|ReaderTools|Composer|loop)-[^/]+\.js$/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test("native first selection e survives a pending full chunk and opens the exact Composer quote", async ({ page }) => {
  await configure({ generated: true });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/main-*.js", async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const selected = await page
    .locator(".blk .mb p")
    .first()
    .evaluate((p) => {
      const text = p.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(14, text.textContent!.length));
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return { quote: selection.toString().normalize("NFC"), block: p.closest<HTMLElement>(".blk")!.dataset.b! };
    });
  await page.keyboard.press("e");
  await expect.poll(() => requested).toBe(true);
  await page.keyboard.press("j");
  await page.evaluate(() => window.scrollTo(0, 100));
  release();
  await expect(page.locator(".cm-q mark")).toHaveText(selected.quote);
  await expect(page.locator(".composer textarea").first()).toBeFocused();
  await expect(page.locator(".pop")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("native Escape cancels a pending citation; the next selection action still wins", async ({ page }) => {
  await configure({ generated: true });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/main-*.js", async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const chip = page.locator(".blk a.mcite").first();
  await page.keyboard.press("Tab");
  await chip.focus();
  await expect.poll(() => requested).toBe(true);
  await page.keyboard.press("Escape");
  const complete = page.waitForResponse((response) => /\/main-[^/]+\.js$/.test(response.url()));
  release();
  await (await complete).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator(".pop")).toHaveCount(0);
  await page.locator("h1").focus();
  await page
    .locator(".blk .mb p")
    .first()
    .evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    });
  await page.keyboard.press("e");
  await expect(page.locator(".cm-q")).toBeVisible();
  await expect(page.locator(".pop")).toHaveCount(0);
});

test("native citation keyboard focus remains valid when only the pointer leaves during first-use loading", async ({ page }) => {
  await configure({ generated: true });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/main-*.js", async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.keyboard.press("Tab");
  const chip = page.locator(".blk a.mcite").first();
  await chip.focus();
  await expect.poll(() => requested).toBe(true);
  await chip.dispatchEvent("pointerout", { relatedTarget: null });
  await expect(chip).toBeFocused();
  release();
  await expect(page.locator(".pop.peek")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pop")).toHaveCount(0);
});
