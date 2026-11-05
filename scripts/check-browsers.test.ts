import { describe, expect, test } from "bun:test";
import { BROWSER_GATE_RE, BROWSER_LAUNCH_RE, browserScanned, checkBrowserGates } from "./check-browsers.ts";

describe("WP40g-3 browser-launch gate check", () => {
  test("a launch without the gate is reported, a gated launch is not", () => {
    const problems = checkBrowserGates([
      { path: "x.test.ts", text: `const b = await chromium.launch({ channel: "chrome" });` },
      { path: "y.test.ts", text: `if (!browsersAllowed()) return;\nconst b = await webkit.launch();` },
      { path: "z.test.ts", text: `if (process.env.MITORI_NO_BROWSERS === "1") process.exit(77);\nawait firefox.launch();` },
      { path: "plain.test.ts", text: `expect(1).toBe(1);` },
    ]);
    expect(problems.map((p) => p.file)).toEqual(["x.test.ts"]);
    expect(problems[0]?.rule).toBe("browser-gate");
    expect(problems[0]?.line).toBe(1);
  });

  test("the launch and gate patterns match the real call shapes", () => {
    for (const src of [`chromium.launch()`, `webkit.launch()`, `firefox.launch()`, `channel: "chrome"`, `channel: 'chrome'`])
      expect(BROWSER_LAUNCH_RE.test(src)).toBe(true);
    for (const src of [`browsersAllowed()`, `MITORI_NO_BROWSERS`]) expect(BROWSER_GATE_RE.test(src)).toBe(true);
  });

  test("shots drivers are scanned, playwright-run specs are not", () => {
    expect(browserScanned("test/int/shots/live.ts")).toBe(true);
    expect(browserScanned("test/int/live-ui.test.ts")).toBe(true);
    expect(browserScanned("e2e/web/some.spec.ts")).toBe(false);
    expect(browserScanned("bench/ui.bench.ts")).toBe(false);
  });
});
