/** Canonical SSR is the default test harness, including fixed dry cost disclosure before the useful mark. */
import { expect, test } from "@playwright/test";
import { configure, emit, mockLog, WS, waitMark } from "./support/helpers.ts";

test("native facts mark observes the rendered canonical map tiles and stays absent on Reader", async ({ page }) => {
  await configure({ generated: false });
  await page.addInitScript(() => {
    const result = window as unknown as { __factsPaint: { tiles: number; hasSize: boolean; values: string[] } | null };
    result.__factsPaint = null;
    new PerformanceObserver((list) => {
      if (!list.getEntries().some((entry) => entry.name === "mitori:facts:painted")) return;
      const grid = document.querySelector(".facts .grid");
      const rect = grid?.getBoundingClientRect();
      result.__factsPaint = {
        tiles: grid?.querySelectorAll(".fact").length ?? 0,
        hasSize: !!rect && rect.width > 0 && rect.height > 0,
        values: [...(grid?.querySelectorAll(".fact .n") ?? [])].map((el) => el.textContent ?? ""),
      };
    }).observe({ type: "mark", buffered: true });
  });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:facts:painted");
  const painted = await page.evaluate(() => (window as unknown as { __factsPaint: { tiles: number; hasSize: boolean; values: string[] } }).__factsPaint);
  expect(painted.tiles).toBeGreaterThan(0);
  expect(painted.hasSize).toBe(true);
  expect(painted.values.every((value) => value.trim() !== "" && value !== "–")).toBe(true);
  await expect(page.locator(".facts .grid")).toBeVisible();
  await page.goto(`/w/${WS}/doc/s3`);
  await waitMark(page, "mitori:section:rendered");
  expect(await page.evaluate(() => performance.getEntriesByName("mitori:facts:painted", "mark").length)).toBe(0);
});

test("initial renderer rejects malformed state; initial estimates remain dry and their identities survive first use", async ({ page, request }) => {
  await configure({ generated: false });
  const url = `/w/${WS}`;
  for (const query of [{ width: "0" }, { width: "1440", ui: "{" }, { ui: JSON.stringify({ read: { "../x": "today" } }) }]) {
    const response = await request.get(`/api/v1/ws/${WS}/ui`, { params: { url, ...query } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("E_INVALID_INPUT");
  }
  await page.goto(url);
  await waitMark(page, "mitori:map:painted");
  await expect(page.locator(".est .sum .lead")).toBeVisible();
  const initial = (await mockLog()).filter((r) => r.path.endsWith("/gen/estimate"));
  expect(initial.map((r) => (r.body as { effort: string }).effort).sort()).toEqual(["complete", "overview", "standard"]);
  await page.locator(".est .eff input").last().check();
  await expect(page.locator(".est .sum .lead")).toBeVisible();
  expect((await mockLog()).filter((r) => r.path.endsWith("/gen/estimate")).length).toBe(3);
  expect((await mockLog()).filter((r) => /\/(gen\/runs|jobs)$/.test(r.path) && r.method === "POST")).toEqual([]);
});

test("visible disclosure time survives first-use enhancement without implicit acknowledgement", async ({ page }) => {
  await configure({ generated: false, policyAcked: false });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:map:painted");
  await expect(page.getByTestId("disclosure")).toBeVisible();
  // The product requires an actual second of visibility, not elapsed time since rendering.
  await page.waitForTimeout(1100);
  expect((await mockLog()).some((r) => r.method === "PATCH")).toBe(false);
  await page.locator(".est .go").click();
  await expect.poll(async () => (await mockLog()).filter((r) => r.path.endsWith("/gen/runs")).length).toBe(1);
  const consent = (await mockLog()).find((r) => r.method === "PATCH" && (r.body as { patch?: { privacy?: unknown } })?.patch?.privacy);
  expect(consent).toBeDefined();
});

test("a delayed canonical refresh preserves the reader level chosen while it was pending", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s3`);
  const before = await waitMark(page, "mitori:section:rendered");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  let heldOnce = false;
  await page.route("**/api/v1/ws/*/ui?**", async (route) => {
    if (heldOnce) return route.continue();
    heldOnce = true;
    const response = await route.fetch();
    requested = true;
    await held;
    await route.fulfill({ response });
  });
  await emit({ type: "doc.outline", outlineRev: "outline_pending" });
  await expect.poll(() => requested).toBe(true);
  await page.keyboard.press("-");
  await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
  release();
  await waitMark(page, "mitori:section:rendered", before);
  await expect(page.locator("html")).toHaveAttribute("data-level", "newcomer");
  await expect(page.locator('input[name="mitori-level"][value="newcomer"]')).toBeChecked();
});
