/**
 * WP-10a web e2e (tag @wp10a). Self-contained until the WP-12 harness lands: builds apps/web once (global setup),
 * starts the typed mock daemon (support/mock-server.ts) and runs `*.pw.ts` serially (the mock has one state).
 *   scripts/nd bunx playwright test -c e2e/web/playwright.config.ts --grep @wp10a
 * Specs use `.pw.ts` so `bun test` (which also collects `*.spec.ts`) never picks them up.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.MOCK_PORT ?? 4318);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.pw\.ts$/,
  workers: 1,
  fullyParallel: false,
  timeout: Number(process.env.MITORI_PW_TIMEOUT ?? 90_000),
  reporter: [["list"]],
  globalSetup: "./support/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    locale: "ja-JP",
    // a returning browser: the first visit's 「初めて」 + 5-minute course (NC-08) has its own spec (first-run.pw.ts)
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${PORT}`, localStorage: [{ name: "mitori:firstRun", value: "2026-10-01" }] }] },
  },
  projects: [
    { name: "chromium", testIgnore: /\.webkit\.pw\.ts$/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    // All engines run the functional suite; CDP-only measurements explicitly skip outside Chromium.
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `bun support/mock-server.ts ${PORT}`,
    // a mock endpoint, not `/`: the server starts before global setup has built apps/web/dist
    url: `http://127.0.0.1:${PORT}/__mock/log`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30_000,
  },
});
