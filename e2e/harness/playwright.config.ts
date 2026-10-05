// Playwright configuration for every e2e spec (testing spec §5.1). Specs live in `e2e/<area>/*.spec.ts` (written by the
// feature WPs); this file and `fixtures.ts` are the harness (WP-12). Run through `bun run e2e` (e2e/harness/run.ts).
import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
/** `MITORI_E2E_CHANNEL=chrome` uses the installed Google Chrome instead of the bundled Chromium. */
const channel = process.env.MITORI_E2E_CHANNEL;
const desktop = { width: 1440, height: 900 };
const chromium = { ...devices["Desktop Chrome"], viewport: desktop, ...(channel ? { channel } : {}) };

export default defineConfig({
  testDir: "..",
  // `*.e2e.ts` is for the harness' own self-test: `bun test` collects every `*.spec.ts` and cannot run Playwright specs
  // (docs/design/cr-requests/WP-12.md asks the architect to add e2e/**/*.spec.ts to bunfig's pathIgnorePatterns)
  testMatch: ["**/*.spec.ts", "**/*.e2e.ts"],
  testIgnore: ["**/node_modules/**"],
  outputDir: "../../test-results",
  fullyParallel: true,
  workers: ci ? 2 : "50%",
  retries: ci ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // @live specs talk to a real engine: only with MITORI_LIVE=1
  ...(process.env.MITORI_LIVE === "1" ? {} : { grepInvert: /@live/ }),
  reporter: [["list"], ["json", { outputFile: "../../test-results/report.json" }]],
  use: {
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    viewport: desktop,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", testIgnore: ["**/node_modules/**", "**/perf/**"], use: chromium },
    { name: "firefox", testIgnore: ["**/node_modules/**", "**/perf/**"], use: { ...devices["Desktop Firefox"], viewport: desktop } },
    // Safari's IME order and content-visibility quirks (§5.1): M3 and release
    { name: "webkit", testIgnore: ["**/node_modules/**", "**/perf/**"], use: { ...devices["Desktop Safari"], viewport: desktop } },
    {
      name: "tablet",
      testIgnore: ["**/node_modules/**", "**/perf/**"],
      use: { ...devices["Desktop Safari"], viewport: { width: 1024, height: 1366 }, hasTouch: true },
    },
    // time budgets are judged here only; one worker, no retries (run.ts adds --workers=1)
    { name: "perf", testMatch: "**/perf/**/*.spec.ts", retries: 0, fullyParallel: false, use: chromium },
  ],
});
