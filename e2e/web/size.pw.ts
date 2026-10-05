/**
 * @wp10a asset budgets on SERVED bytes (ux.md §13.1, BUNDLE_BUDGETS): initial JS per route ≤ 60 KiB gz,
 * CSS ≤ 25 KiB gz, 0 web fonts, CM6 never requested before Review.
 */
import { expect, test } from "@playwright/test";
import { configure, WS, waitMark } from "./support/helpers.ts";

const ROUTES = [
  { name: "S1", path: `/w/${WS}`, mark: "mitori:map:painted" },
  { name: "S2", path: `/w/${WS}/doc/s3`, mark: "mitori:section:rendered" },
];

for (const r of ROUTES) {
  test(`@wp10a asset budget ${r.name}: initial JS ≤ 60 KiB gz, CSS ≤ 25 KiB, no fonts, no cm6`, async ({ page, browserName }, info) => {
    test.skip(browserName !== "chromium", "Served-byte performance budgets use the Chromium reference probe.");
    await configure({});
    const fonts: string[] = [];
    page.on("request", (req) => {
      if (/\.woff2?($|\?)/.test(req.url()) || req.resourceType() === "font") fonts.push(req.url());
    });
    page.on("response", (res) => {
      if ((res.headers()["content-type"] ?? "").startsWith("font/")) fonts.push(res.url());
    });
    await page.goto(r.path);
    const at = await waitMark(page, r.mark);
    const sizes = await page.evaluate((t) => {
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const js = res.filter((e) => e.name.endsWith(".js") && e.responseEnd <= t + 1);
      const css = res.filter((e) => e.name.endsWith(".css"));
      return {
        js: js.reduce((n, e) => n + e.encodedBodySize, 0),
        css: css.reduce((n, e) => n + e.encodedBodySize, 0),
        files: js.map((e) => `${e.name.split("/").pop()} ${e.encodedBodySize}`),
        all: res.map((e) => e.name.split("/").pop() ?? ""),
      };
    }, at);
    expect(sizes.js, "the served-byte probe must observe loaded JavaScript").toBeGreaterThan(0);
    info.annotations.push({ type: "initial-js-gz", description: `${(sizes.js / 1024).toFixed(1)} KB · ${sizes.files.join(", ")}` });
    info.annotations.push({ type: "css-gz", description: `${(sizes.css / 1024).toFixed(1)} KB` });
    console.log(`[size] ${r.name} initial JS ${(sizes.js / 1024).toFixed(1)} KB gz, CSS ${(sizes.css / 1024).toFixed(1)} KB gz :: ${sizes.files.join(", ")}`);
    expect(sizes.js).toBeLessThanOrEqual(60 * 1024);
    expect(sizes.css).toBeLessThanOrEqual(25 * 1024);
    expect(fonts).toEqual([]);
    expect(sizes.all.some((n) => /^(cm6|merge)-/.test(n))).toBe(false);
  });
}
