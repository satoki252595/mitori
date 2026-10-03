// Chrome tracing around a perf scenario (testing spec §6.6): `browser.startTracing` with the timeline / user-timing / v8 categories,
// kept as `trace.json` when the scenario fails or `MITORI_PERF_TRACE=1`, with the ten longest tasks and forced reflows summarised.
import { writeFileSync } from "node:fs";
import type { Browser, Page, TestInfo } from "@playwright/test";

// §6.6 names devtools.timeline / blink.user_timing / v8.execute; `RunTask` (long tasks) and the JS stack on a layout (forced
// reflows) live in the two disabled-by-default categories, measured with Chromium 153.
export const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.stack",
  "blink.user_timing",
  "v8.execute",
];
/** A main-thread task longer than this is a long task (the web platform's definition). */
export const LONG_TASK_US = 50_000;

export interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: { beginData?: { stackTrace?: unknown[] }; data?: { stackTrace?: unknown[] } } & Record<string, unknown>;
}

export interface TraceSummary {
  /** `RunTask` events over 50 ms, longest first (at most `top`). */
  longTasks: { atMs: number; durMs: number }[];
  /** Layout / style recalculations that carry a JS stack (a script forced them), longest first. */
  forcedReflows: { name: string; atMs: number; durMs: number }[];
}

/** Pure: pick the ten (default) worst long tasks and forced reflows out of a Chrome trace. Times are relative to the first event. */
export function summarizeTrace(events: readonly TraceEvent[], top = 10): TraceSummary {
  const complete = events.filter((e) => e.ph === "X" && typeof e.dur === "number");
  const t0 = events.reduce((m, e) => Math.min(m, e.ts), Number.POSITIVE_INFINITY);
  const rel = (ts: number) => (ts - t0) / 1000;
  const longTasks = complete
    .filter((e) => e.name === "RunTask" && (e.dur as number) > LONG_TASK_US)
    .sort((a, b) => (b.dur as number) - (a.dur as number))
    .slice(0, top)
    .map((e) => ({ atMs: rel(e.ts), durMs: (e.dur as number) / 1000 }));
  const forcedReflows = complete
    .filter(
      (e) =>
        (e.name === "UpdateLayoutTree" || e.name === "Layout") &&
        ((e.args?.beginData?.stackTrace?.length ?? 0) > 0 || (e.args?.data?.stackTrace?.length ?? 0) > 0),
    )
    .sort((a, b) => (b.dur as number) - (a.dur as number))
    .slice(0, top)
    .map((e) => ({ name: e.name, atMs: rel(e.ts), durMs: (e.dur as number) / 1000 }));
  return { longTasks, forcedReflows };
}

/**
 * Run `fn` under a Chrome trace of `page`. The trace is attached to the test (and written to `trace.json` in its output dir) when
 * `fn` throws or `MITORI_PERF_TRACE=1`. Chromium only: other browsers run `fn` untraced.
 */
export async function withPerfTrace<T>(browser: Browser, page: Page, testInfo: TestInfo, fn: () => Promise<T>): Promise<T> {
  if (browser.browserType().name() !== "chromium") return fn();
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  let failed = false;
  try {
    return await fn();
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    const buffer = await browser.stopTracing();
    if (failed || process.env.MITORI_PERF_TRACE === "1") {
      const file = testInfo.outputPath("trace.json");
      writeFileSync(file, buffer);
      await testInfo.attach("perf-trace", { path: file, contentType: "application/json" });
      const events = (JSON.parse(buffer.toString("utf8")) as { traceEvents: TraceEvent[] }).traceEvents;
      await testInfo.attach("perf-trace-summary", { body: JSON.stringify(summarizeTrace(events), null, 2), contentType: "application/json" });
    }
  }
}
