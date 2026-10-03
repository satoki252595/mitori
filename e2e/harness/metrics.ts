// What the e2e specs measure (testing spec §5.2, §6.4, §6.6): INP from event timing, request counts, the bytes of the initial
// JavaScript, app mark latencies and budget assertions. Plain TypeScript: it runs under Playwright's Node worker as well as Bun.

import { type BudgetEntry, budget } from "@mitori/testkit";
import type { Page, Request } from "@playwright/test";

/* ---------------------------------------------------------------------- statistics */

/** Nearest-rank percentile, `p` in (0, 100]. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length))) - 1] as number;
}

/** Event Timing reports only interactions of 16 ms or more; a scenario that performed `performed` of them pads the rest with 16 ms. */
export const EVENT_TIMING_FLOOR_MS = 16;

export interface InpSummary {
  /** Interactions the scenario performed. */
  count: number;
  /** Interactions the browser reported (≥ 16 ms). */
  reported: number;
  p75: number;
  p98: number;
  max: number;
}

/**
 * INP-equivalent of a scenario (§6.6): the duration of every interaction (its longest event-timing entry), padded to
 * `performed` with the 16 ms floor, summarised as p75 and p98.
 */
export function inpSummary(interactions: readonly { duration: number }[], performed: number = interactions.length): InpSummary {
  const durations = interactions.map((i) => i.duration);
  const padded = [...durations, ...Array.from({ length: Math.max(0, performed - durations.length) }, () => EVENT_TIMING_FLOOR_MS)];
  return {
    count: padded.length,
    reported: durations.length,
    p75: percentile(padded, 75),
    p98: percentile(padded, 98),
    max: padded.length ? Math.max(...padded) : 0,
  };
}

/** Median of per-run p75 values (§6.6: five repetitions, the median of the p75s). */
export function medianOfRuns(runs: readonly InpSummary[], pick: "p75" | "p98" = "p75"): number {
  return percentile(
    runs.map((r) => r[pick]),
    50,
  );
}

/* ------------------------------------------------------------------------ requests */

export interface RequestLog {
  /** Requests made so far (data: and blob: URLs excluded). */
  readonly count: number;
  readonly urls: readonly string[];
  /** Requests whose URL matches. */
  matching(pattern: RegExp): string[];
  /** Forget everything recorded so far (e.g. after the page is loaded, before the interaction under test). */
  reset(): void;
  stop(): void;
}

/** `page.on("request")` as a counter: `ui.fetch.readerOpen`, `ui.fetch.levelSwitch` (§6.4). */
export function trackRequests(page: Page): RequestLog {
  const urls: string[] = [];
  const on = (req: Request) => {
    const url = req.url();
    if (!/^(data|blob):/.test(url)) urls.push(url);
  };
  page.on("request", on);
  return {
    get count() {
      return urls.length;
    },
    urls,
    matching: (pattern) => urls.filter((u) => pattern.test(u)),
    reset: () => {
      urls.length = 0;
    },
    stop: () => void page.off("request", on),
  };
}

export interface InitialJs {
  /** Σ response body bytes of every JavaScript response of the cold load (what went over the wire, compressed). */
  bytes: number;
  files: { url: string; bytes: number }[];
}

/**
 * Initial JavaScript of a cold load (§6.5-3): the response body bytes of JS requests made before `until` — a `mitori:*`
 * mark (e.g. `mitori:map:painted`) or the `load` event. Playwright's `request.sizes().responseBodySize` is the compressed body.
 */
export async function initialJs(page: Page, url: string, until: "load" | `mitori:${string}` = "load"): Promise<InitialJs> {
  const pending: Request[] = [];
  const on = (req: Request) => {
    if (req.resourceType() === "script" || /\.m?js(?:$|\?)/.test(req.url())) pending.push(req);
  };
  page.on("requestfinished", on);
  try {
    await page.goto(url, { waitUntil: until === "load" ? "load" : "commit" });
    if (until !== "load") await page.waitForFunction((name) => performance.getEntriesByName(name, "mark").length > 0, until, { timeout: 15_000 });
    const files = await Promise.all(pending.map(async (r) => ({ url: r.url(), bytes: (await r.sizes()).responseBodySize })));
    return { bytes: files.reduce((s, f) => s + f.bytes, 0), files };
  } finally {
    page.off("requestfinished", on);
  }
}

/* --------------------------------------------------------------------- app marks */

/**
 * Latency of a performance mark that carries `detail.trigger` (= `event.timeStamp` of the user input behind it):
 * `mark.startTime − trigger` (§6.6 — `PERF_MARKS`). One value per mark occurrence.
 */
export async function markLatencies(page: Page, name: string): Promise<number[]> {
  return page.evaluate((n) => {
    return performance
      .getEntriesByName(n, "mark")
      .map((m) => {
        const d = (m as PerformanceMark).detail as { trigger?: number } | null;
        return d && typeof d.trigger === "number" ? m.startTime - d.trigger : null;
      })
      .filter((x): x is number => x !== null);
  }, name);
}

/* ------------------------------------------------------------------------ budgets */

export interface BudgetCheck {
  id: string;
  value: number;
  entry: BudgetEntry;
  /** Beyond the limit: the spec fails. */
  failed: boolean;
  /** Beyond the target but within the limit: a warning annotation. */
  warned: boolean;
}

/** Compare a measured value with `bench/budgets.json` (direction aware). The caller asserts `failed` and annotates `warned`. */
export function checkBudget(id: string, value: number): BudgetCheck {
  const entry = budget(id);
  const beyond = (bound: number) => (entry.dir === "max" ? value > bound : value < bound);
  return { id, value, entry, failed: beyond(entry.limit), warned: !beyond(entry.limit) && beyond(entry.target) };
}
