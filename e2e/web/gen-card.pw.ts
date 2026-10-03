/**
 * @wp10a S1 generation estimate card (ux.md §4.2.4 + R1): data-policy disclosure and its ≥ 1 s acknowledgement
 * (AC-U-DP), billing state on the main line (AC-U-B01), the 5h window line / default tile while uncalibrated
 * (AC-G-W01), engine problem cards (AC-U-EN).
 */
import { expect, type Page, test } from "@playwright/test";
import { configure, type MockOptions, mockLog, WS, waitMark } from "./support/helpers.ts";

async function openMap(page: Page, o: MockOptions) {
  await configure({ generated: false, ...o });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
}

const posts = async (path: RegExp, method = "POST") => (await mockLog()).filter((r) => r.method === method && path.test(r.path));

test("@wp10a AC-U-DP disclosure above the main line; a click before it was visible 1 s does nothing; the next one acks + starts", async ({ page }) => {
  await openMap(page, { policyAcked: false });
  const disc = page.getByTestId("disclosure");
  await expect(disc).toBeVisible();
  await expect(disc).toContainText("送信先: Anthropic");
  await expect(disc).toContainText("393");
  // above the main line, not collapsible
  const d = await disc.boundingBox();
  const m = await page.locator(".est .main").boundingBox();
  expect(d && m && d.y + d.height <= m.y).toBe(true);
  expect(await disc.locator("xpath=ancestor-or-self::details").count()).toBe(0);
  // too early: nudges, no request
  await page.locator(".est .go").click();
  await expect(disc).toHaveClass(/nudge/);
  expect(await posts(/\/gen\/runs$/)).toEqual([]);
  expect(await posts(/\/settings$/, "PATCH")).toEqual([]);
  await page.waitForTimeout(1100);
  await page.locator(".est .go").click();
  await expect.poll(async () => (await posts(/\/gen\/runs$/)).length).toBe(1);
  const log = await mockLog();
  const patch = log.findIndex((r) => r.method === "PATCH" && r.path.endsWith("/settings"));
  const run = log.findIndex((r) => r.method === "POST" && r.path.endsWith("/gen/runs"));
  expect(patch).toBeGreaterThanOrEqual(0);
  expect(patch).toBeLessThan(run);
  type AckBody = { patch: { privacy: { dataPolicyAck: Record<string, { at: string; shownAt: string; plan: string }> } } };
  const ack = (log[patch]?.body as AckBody | undefined)?.patch.privacy.dataPolicyAck["claude-cli"];
  expect(ack?.plan).toBe("max5");
  expect(Date.parse(ack?.at ?? "") - Date.parse(ack?.shownAt ?? "")).toBeGreaterThanOrEqual(1000);
});

test("@wp10a AC-U-DP acknowledged engine: no disclosure row, one click starts", async ({ page }) => {
  await openMap(page, { policyAcked: true });
  await page.locator(".est .sum .lead").waitFor();
  await expect(page.getByTestId("disclosure")).toHaveCount(0);
  await page.locator(".est .go").click();
  await expect.poll(async () => (await posts(/\/gen\/runs$/)).length).toBe(1);
  expect(await posts(/\/settings$/, "PATCH")).toEqual([]);
});

for (const [billing, text, tone] of [
  ["subscription-window", "サブスクの枠内（追加料金なし）", "ok"],
  ["metered-api", "約$1.3が課金されます", "warn"],
  ["overage", "約$1.3が課金されます（従量）", "warn"],
  ["unknown", "課金の扱いは未確認", "muted"],
] as const) {
  test(`@wp10a AC-U-B01 main line = API-equivalent $ + billing state on the same line (${billing})`, async ({ page }) => {
    await openMap(page, { billing });
    const sum = page.locator(".est .sum");
    await expect(sum.locator(".lead")).toContainText("API換算$1.3");
    const bill = sum.locator(".bill");
    await expect(bill).toHaveText(text);
    await expect(bill).toHaveAttribute("data-tone", tone);
    if (billing === "overage") {
      // billing_overage: the start button needs the explicit acknowledgement checkbox first
      const go = page.locator(".est .go");
      await expect(go).toHaveAttribute("aria-disabled", "true");
      await go.click({ force: true });
      expect(await posts(/\/gen\/runs$/)).toEqual([]);
      await page.locator(".est .ovg input").check();
      await expect(go).toHaveAttribute("aria-disabled", "false");
    }
  });
}

test("@wp10a AC-G-W01 uncalibrated + Pro: default tile 概要, 5h line as a range with the plan prior, ranges on the main line", async ({ page }) => {
  await openMap(page, { calibrated: false, plan: "pro" });
  await expect(page.locator(".est .eff label.sel")).toContainText("概要");
  const sup = page.locator(".est p.sub").last();
  await expect(sup).toContainText(/5h枠23% → 推定\+\d+〜\d+%（未較正・Proプランの目安）/u);
  await expect(page.locator(".est .sum .lead")).toContainText("〜");
  await expect(page.locator(".est .sum .unc")).toHaveText("（未較正）");
});

test("@wp10a AC-G-W01 calibrated + Max: default tile 標準 and a point 5h estimate", async ({ page }) => {
  await openMap(page, { calibrated: true, plan: "max5" });
  await expect(page.locator(".est .eff label.sel")).toContainText("標準");
  await expect(page.locator(".est p.sub").last()).toContainText(/5h枠23% → 推定\d+%/u);
  await expect(page.locator(".est .sum .unc")).toHaveCount(0);
  // switching the tile re-renders from the already fetched estimates (fetch 0)
  const before = (await posts(/\/gen\/estimate$/)).length;
  await page.locator(".est .eff label", { hasText: "完全" }).click();
  await expect(page.locator(".est .sum .lead")).toContainText("完全");
  expect((await posts(/\/gen\/estimate$/)).length).toBe(before);
});

for (const [engine, title] of [
  ["notInstalled", "見つかりません"],
  ["notLoggedIn", "ログインしていません"],
  ["capabilityLost", "必要な機能が使えません"],
] as const) {
  test(`@wp10a AC-U-EN engine card instead of the estimate (${engine}); 再検出 re-reads GET /engines`, async ({ page }) => {
    await openMap(page, { engine });
    const card = page.getByTestId("engine-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-problem", engine);
    await expect(card).toContainText(title);
    await expect(page.locator(".est .go")).toHaveCount(0);
    const n = (await posts(/\/engines$/, "GET")).length;
    await card.getByRole("button", { name: "再検出" }).click();
    await expect.poll(async () => (await posts(/\/engines$/, "GET")).length).toBe(n + 1);
  });
}
