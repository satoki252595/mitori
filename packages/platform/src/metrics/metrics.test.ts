import { describe, expect, test } from "bun:test";
import { systemClock } from "../clock/index.ts";
import { createMetrics, noopMetrics } from "./index.ts";

describe("PLAT-U Metrics", () => {
  test("counters and timer aggregates; snapshot is a sorted copy; reset clears", () => {
    const m = createMetrics();
    m.inc("idx.parse.calls");
    m.inc("idx.parse.calls", 4);
    m.inc("agent.spawns");
    m.observe("doc.flush.ms", 3);
    m.observe("doc.flush.ms", 1);
    const s = m.snapshot();
    expect(Object.keys(s.counters)).toEqual(["agent.spawns", "idx.parse.calls"]);
    expect(s.counters["idx.parse.calls"]).toBe(5);
    expect(s.timers["doc.flush.ms"]).toEqual({ n: 2, sum: 4, min: 1, max: 3 });
    m.observe("doc.flush.ms", 9);
    expect(s.timers["doc.flush.ms"]?.n).toBe(2);
    m.reset();
    expect(m.snapshot()).toEqual({ counters: {}, timers: {} });
  });

  test("noopMetrics accepts calls", () => {
    noopMetrics.inc("srv.sse.events");
    noopMetrics.observe("loop.bundle.ms", 1);
  });
});

describe("PLAT-U Clock", () => {
  test("systemClock now/iso agree", () => {
    const a = systemClock.now();
    const iso = systemClock.iso();
    expect(Math.abs(Date.parse(iso) - a)).toBeLessThan(1000);
    expect(iso).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
});
