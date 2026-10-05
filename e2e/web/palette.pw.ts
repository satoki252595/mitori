/**
 * @wp10a ⌘K palette (ux.md §4.10, JUDGEMENT AC-J46, AC-J46b, AC-U70): 50,000 items in the worker, ≤ 16 ms of
 * matching per keystroke, romaji / kana / alias queries all put 「持ち越し」 first with the reason badge, a trailing
 * incomplete romaji still matches, Escape returns focus and the next single-key shortcut works.
 */
import { expect, type Page, test } from "@playwright/test";
import { chromiumMetric, configure, now, p95, WS, waitMark } from "./support/helpers.ts";

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator(".pal input[role=combobox]");
  await expect(input).toBeFocused();
  return input;
}

/** Type one character at a time; per keystroke: worker matching ms (data-ms) and key → results painted. */
async function typeTimed(page: Page, text: string): Promise<{ worker: number[]; e2e: number[] }> {
  const worker: number[] = [];
  const e2e: number[] = [];
  for (const ch of text) {
    const t0 = await now(page);
    await page.keyboard.type(ch);
    const t1 = await waitMark(page, "mitori:palette:results", t0);
    e2e.push(t1 - t0);
    worker.push(Number(await page.locator(".pal-foot [data-ms]").getAttribute("data-ms")));
  }
  return { worker, e2e };
}

test("@wp10a AC-J46 50k items: mochi / mochikoshi / motikosi / もちこし / carry → 持ち越し first, ≤ 16 ms per keystroke", async ({
  page,
  browserName,
}, info) => {
  const timing = chromiumMetric(browserName, info, "50k palette worker matching ≤ 16ms");
  test.setTimeout(120_000);
  await configure({ paletteItems: 50_000 });
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const input = await openPalette(page);
  // the index load (50k) happens once; wait until the worker answered a first query
  await input.fill("a");
  await waitMark(page, "mitori:palette:results");
  const all: number[] = [];
  for (const q of ["mochi", "mochikoshi", "motikosi", "もちこし", "carry"]) {
    await input.fill("");
    const kana = [...q].some((c) => (c.codePointAt(0) ?? 0) > 0x7f);
    if (kana) {
      // kana arrives as one committed IME string (insertText), not per keystroke
      const t0 = await now(page);
      await page.keyboard.insertText(q);
      await waitMark(page, "mitori:palette:results", t0);
      all.push(Number(await page.locator(".pal-foot [data-ms]").getAttribute("data-ms")));
    } else {
      const { worker } = await typeTimed(page, q);
      all.push(...worker);
    }
    const first = page.locator(".pal-it").first();
    await expect(first, q).toContainText("持ち越し");
    if (!kana) await expect(first.locator(".via"), `${q} shows why it matched`).toBeVisible();
  }
  console.log(`[palette] worker ms p95 ${p95(all)} (n=${all.length}, max ${Math.max(...all)})`);
  if (timing) expect(p95(all)).toBeLessThanOrEqual(16);
  // symbols tied to the term are found through it (via)
  await input.fill("");
  await page.keyboard.insertText("持ち越し");
  await expect(page.locator(".pal-it", { hasText: "carryForwardComments" }).locator(".via")).toBeVisible();
});

test("@wp10a AC-J46b trailing incomplete romaji matches; labels are not romaji-converted; AC-U70 ninshou / にんしょう → 認証", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const input = await openPalette(page);
  for (const [q, want] of [
    ["mochikos", "持ち越し"],
    ["mochiko", "持ち越し"],
    ["ninshou", "認証"],
    ["にんしょう", "認証"],
  ] as const) {
    await input.fill(q);
    await expect(page.locator(".pal-it").first(), q).toContainText(want);
  }
  // a Latin label is matched as typed: "route" finds route / routeTable, not kana-converted labels
  await input.fill("route");
  await expect(page.locator(".pal-it").first()).toContainText("route");
  // the result count reaches the polite live region once typing pauses (ux.md §11.2)
  await expect(page.locator("#live-polite")).toHaveText(/^\d+件の結果/u);
});

test("@wp10a palette: Escape returns focus to where it was and the next single-key shortcut works", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  await page.keyboard.press("j");
  await expect(page.locator(".blk.focus")).toHaveCount(1);
  const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
  const input = await openPalette(page);
  await input.fill("mochi");
  await expect(page.locator(".pal-it").first()).toContainText("持ち越し");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pal")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "")).toBe(before);
  const focused = await page.locator(".blk.focus").getAttribute("data-b");
  await page.keyboard.press("j");
  await expect(page.locator(".blk.focus")).not.toHaveAttribute("data-b", focused ?? "");
});

test("@wp10a palette: ↓ / ↵ opens the selected item (section) and records it in recents", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  const input = await openPalette(page);
  await input.fill("§7");
  await expect(page.locator(".pal-it").first()).toContainText("§7");
  const t0 = await now(page);
  await page.keyboard.press("Enter");
  await waitMark(page, "mitori:section:rendered", t0);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s7$`));
  await openPalette(page);
  await expect(page.locator(".pal-it").first()).toContainText("§7");
});

test("@wp10a palette actions: >次に読む opens the first unread step of the reading path (ux.md §7.2)", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/doc/s7`);
  await waitMark(page, "mitori:section:rendered");
  const input = await openPalette(page);
  await input.fill(">次に読む");
  await expect(page.locator(".pal-it").first()).toContainText("次に読む");
  const t0 = await now(page);
  await page.keyboard.press("Enter");
  await waitMark(page, "mitori:section:rendered", t0);
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/doc/s0$`));
});
