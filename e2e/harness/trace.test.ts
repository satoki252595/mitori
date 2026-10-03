import { describe, expect, test } from "bun:test";
import { LONG_TASK_US, summarizeTrace, TRACE_CATEGORIES, type TraceEvent } from "./trace.ts";

const task = (ts: number, dur: number): TraceEvent => ({ name: "RunTask", ph: "X", ts, dur });
const layout = (ts: number, dur: number, stack: boolean, name = "Layout"): TraceEvent => ({
  name,
  ph: "X",
  ts,
  dur,
  args: { beginData: { stackTrace: stack ? [{ functionName: "f" }] : [] } },
});

describe("E2EH-U-04 trace summary (testing spec §6.6)", () => {
  test("long tasks are RunTask events over 50 ms, longest first, times relative to the first event", () => {
    const s = summarizeTrace([task(1_000_000, 10_000), task(1_100_000, LONG_TASK_US + 1), task(1_300_000, 200_000), task(1_600_000, LONG_TASK_US)]);
    expect(s.longTasks).toEqual([
      { atMs: 300, durMs: 200 },
      { atMs: 100, durMs: LONG_TASK_US / 1000 + 0.001 },
    ]);
  });

  test("only layouts that carry a JS stack count as forced reflows", () => {
    const s = summarizeTrace([layout(0, 5_000, true), layout(10_000, 9_000, false), layout(20_000, 7_000, true, "UpdateLayoutTree")]);
    expect(s.forcedReflows).toEqual([
      { name: "UpdateLayoutTree", atMs: 20, durMs: 7 },
      { name: "Layout", atMs: 0, durMs: 5 },
    ]);
  });

  test("at most `top` entries each; instant and unrelated events are ignored", () => {
    const events: TraceEvent[] = [
      ...Array.from({ length: 15 }, (_, i) => task(i * 1_000_000, 60_000 + i * 1000)),
      { name: "RunTask", ph: "B", ts: 5 },
      { name: "TimeStamp", ph: "X", ts: 9, dur: 999_999 },
    ];
    const s = summarizeTrace(events);
    expect(s.longTasks).toHaveLength(10);
    expect(s.longTasks[0]?.durMs).toBe(74);
    expect(summarizeTrace(events, 3).longTasks).toHaveLength(3);
    expect(summarizeTrace([]).longTasks).toEqual([]);
  });

  test("the categories include the two disabled-by-default ones that carry RunTask and the layout stacks", () => {
    expect(TRACE_CATEGORIES).toContain("disabled-by-default-devtools.timeline");
    expect(TRACE_CATEGORIES).toContain("disabled-by-default-devtools.timeline.stack");
    expect(TRACE_CATEGORIES).toContain("blink.user_timing");
  });
});
