/** Shared helpers of the WP-10a Playwright specs. */
import type { Page, TestInfo } from "@playwright/test";

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

/** Actual browser input → the existing paint mark; excludes Playwright transport and actionability waits. */
export async function inputToMark(page: Page, event: "click" | "keydown", action: () => Promise<unknown>, name: string): Promise<number> {
  const input = `mitori:test:input:${event}`;
  await page.evaluate(
    ([type, mark]) => {
      performance.clearMarks(mark);
      window.addEventListener(type, (e) => performance.mark(mark, { startTime: e.timeStamp, detail: { trusted: e.isTrusted } }), { once: true, capture: true });
    },
    [event, input] as const,
  );
  await action();
  const trigger = await page.evaluate((mark) => {
    const e = performance.getEntriesByName(mark, "mark").at(-1) as PerformanceMark | undefined;
    if (!e?.detail?.trusted) throw new Error("Trusted browser input was not observed");
    return e.startTime;
  }, input);
  return (await waitMark(page, name, trigger)) - trigger;
}

export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0;
}

/** The reference time budgets and Chromium-only probes are not baseline measurements for another engine. */
export function chromiumMetric(browserName: string, info: TestInfo, metric: string): boolean {
  if (browserName === "chromium") return true;
  info.annotations.push({ type: "skip-metric", description: `${metric}: Chromium only (${browserName})` });
  return false;
}

/** Cumulative layout shift observed so far (buffered), excluding shifts right after input. */
export async function installCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) throw new Error("layout-shift PerformanceObserver unavailable");
    (window as unknown as { __cls: number }).__cls = 0;
    (window as unknown as { __clsSources: unknown[] }).__clsSources = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
      })[]) {
        if (!e.hadRecentInput) {
          (window as unknown as { __cls: number }).__cls += e.value;
          (window as unknown as { __clsSources: unknown[] }).__clsSources.push({
            at: e.startTime,
            value: e.value,
            sources: e.sources.map((s) => ({
              node: `${s.node?.nodeName}.${(s.node as Element)?.className}`,
              previous: s.previousRect.toJSON(),
              current: s.currentRect.toJSON(),
            })),
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export const cls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
