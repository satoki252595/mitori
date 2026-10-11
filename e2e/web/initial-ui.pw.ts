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
  for (const query of [
    { width: "0" },
    { width: "1440", ui: "{" },
    { ui: JSON.stringify({ read: { "../x": "today" } }) },
    { ui: JSON.stringify({ firstRun: "yes" }) },
  ]) {
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

test("canonical state accepts read progress for the appendix", async ({ request }) => {
  await configure({ generated: true });
  const response = await request.get(`/api/v1/ws/${WS}/ui`, {
    params: { url: `/w/${WS}/doc/s0`, ui: JSON.stringify({ read: { appendix: "2026-10-11" } }) },
  });
  expect(response.status()).toBe(200);
});

test("the first cold map paints the completed scan summary without a second UI request", async ({ page }) => {
  await configure({ generated: false, coldScan: true, engine: "notLoggedIn" });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/v1/ws/${WS}/ui`) requests.push(r.url());
  });
  await page.goto(`/w/${WS}`);
  await waitMark(page, "mitori:scan:summary");
  await expect(page.locator(".facts .grid")).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("Reader uses daemon engine status without rerunning login probes; map still detects live", async ({ request }) => {
  await configure({ generated: true, engine: "notLoggedIn" });
  const reader = await request.get(`/api/v1/ws/${WS}/ui`, { params: { url: `/w/${WS}/doc/s0` } });
  expect(reader.status()).toBe(200);
  expect((await reader.json()).snapshot.engines[0].auth).toBe("none");
  expect(await (await request.get("/__mock/initial-reads")).json()).not.toContain("/engines");
  const map = await request.get(`/api/v1/ws/${WS}/ui`, { params: { url: `/w/${WS}` } });
  expect(map.status()).toBe(200);
  expect(await (await request.get("/__mock/initial-reads")).json()).toContain("/engines");
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
