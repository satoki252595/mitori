/** Shared helpers of the WP-10a Playwright specs. */
import type { Page } from "@playwright/test";

export const WS = "ws_cr1t00000000";
export const BASE = `http://127.0.0.1:${process.env.MOCK_PORT ?? 4318}`;

export interface MockOptions {
  generated?: boolean;
  bigBlocks?: number;
  engine?: "ok" | "notInstalled" | "notLoggedIn" | "capabilityLost";
  billing?: "subscription-window" | "metered-api" | "overage" | "unknown";
  calibrated?: boolean;
  plan?: "pro" | "max5" | "unknown";
  policyAcked?: boolean;
  paletteItems?: number;
  utilization?: number;
  readyJob?: boolean;
  fiveMinStops?: number;
}

export async function configure(o: MockOptions = {}): Promise<void> {
  await fetch(`${BASE}/__mock/configure`, { method: "POST", body: JSON.stringify(o), headers: { "content-type": "application/json" } });
}

export async function mockLog(): Promise<{ method: string; path: string; body?: unknown; at: number }[]> {
  return (await (await fetch(`${BASE}/__mock/log`)).json()) as { method: string; path: string; body?: unknown; at: number }[];
}

export async function emit(e: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/__mock/emit`, { method: "POST", body: JSON.stringify(e), headers: { "content-type": "application/json" } });
}

/** Wait until a performance mark exists (optionally newer than `after`) and return its startTime. */
export async function waitMark(page: Page, name: string, after = 0, timeout = 10_000): Promise<number> {
  const h = await page.waitForFunction(
    ([n, a]) => {
      const m = performance.getEntriesByName(n as string, "mark").filter((x) => x.startTime > (a as number));
      return m.length ? m[m.length - 1]?.startTime : null;
    },
    [name, after] as const,
    { timeout, polling: 16 },
  );
  return (await h.jsonValue()) as number;
}

export const now = (page: Page) => page.evaluate(() => performance.now());

export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0;
}

/** Cumulative layout shift observed so far (buffered), excluding shifts right after input. */
export async function installCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export const cls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
