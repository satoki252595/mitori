/** ux.md §4.2.1 / §4.3.8 / §7.2: the tab's reading path (sessionStorage `mitori:path:<ws>`), none before generation. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocOutline, WorkspaceKey } from "@mitori/core";
import { choosePath, courseName, markRead, nextPathAfter, pathName, pathProgress, plannedPath, readMapOf, selectedPath } from "./reading.ts";

const WS = "ws_cr1t00000000" as WorkspaceKey;
const paths = [
  { id: "5min", title: "5分コース", steps: [] },
  { id: "30min", title: "30分コース", steps: [] },
  { id: "reviewer", title: "レビュアー", steps: [] },
] as unknown as DocOutline["readingPaths"];
const outline = (generatedAt: string | null) => ({ manifest: { generatedAt } as DocOutline["manifest"], readingPaths: paths });

describe("selectedPath", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  test("default 30min; the chosen path wins; an unknown id falls back to the first path", () => {
    expect(selectedPath(outline("2026-10-02T00:00:00Z"), WS)?.id).toBe("30min");
    choosePath(WS, "reviewer");
    expect(selectedPath(outline("2026-10-02T00:00:00Z"), WS)?.id).toBe("reviewer");
    choosePath(WS, "gone");
    expect(selectedPath(outline("2026-10-02T00:00:00Z"), WS)?.id).toBe("5min");
  });

  test("no path before generation (the rail shows 「生成すると30分コースが使えます」)", () => {
    expect(selectedPath(outline(null), WS)).toBeNull();
    expect(selectedPath(null, WS)).toBeNull();
  });
});

describe("CR m1-103 the 30-minute path before generation: 0 / n · 残り約30分", () => {
  test("planned from the outline's default path; null once generated or without the path", () => {
    const o = (generatedAt: string | null, readingSec = 0) =>
      ({
        manifest: { generatedAt },
        readingPaths: [{ id: "30min", title: "", steps: [{ section: "s0" }, { section: "s1" }], readingSec }],
      }) as unknown as DocOutline;
    expect(plannedPath(o(null))).toEqual({ steps: 2, minutes: 30, first: "s0" });
    expect(plannedPath(o(null, 45 * 60))?.minutes).toBe(45);
    expect(plannedPath(o("2026-10-03T00:00:00Z"))).toBeNull();
    expect(plannedPath({ manifest: { generatedAt: null }, readingPaths: [] } as unknown as DocOutline)).toBeNull();
  });
});

describe("NC-15 progress, names, completion", () => {
  const sec: Record<string, number> = { s0: 60, s1: 120, s2: 90, s3: 180 };
  const five = {
    id: "5min",
    title: "5 分コース",
    steps: [{ section: "s0" }, { section: "s1" }, { section: "s2" }, { section: "s3" }],
  } as unknown as DocOutline["readingPaths"][number];
  const t = (k: string, p?: Record<string, string | number>) => `${k}${p ? JSON.stringify(p) : ""}`;
  const at = (id: string) => sec[id] ?? 0;

  test("the time left shrinks as stops are read; done = 0 left and no next stop", () => {
    const a = pathProgress(five, {}, at);
    expect([a.read, a.total, a.leftMin, a.totalMin, a.next, a.done]).toEqual([0, 4, 8, 8, "s0", false]);
    const b = pathProgress(five, { s0: "x", s1: "x" }, at);
    expect([b.read, b.leftMin, b.next]).toEqual([2, 5, "s2"]);
    const c = pathProgress(five, { s0: "x", s1: "x", s2: "x", s3: "x" }, at);
    expect([c.done, c.leftMin, c.next]).toEqual([true, 0, null]);
    expect(c.stops.map((s) => s.read)).toEqual([true, true, true, true]);
  });

  test("names follow the UI language; a course far from its nominal time is named by the real time", () => {
    const has = (k: string) => k.startsWith("rail.pathName.");
    expect(pathName(five, 6, t, has)).toBe("rail.pathName.5min");
    expect(pathName({ id: "30min", title: "30 分コース" }, 11, t, has)).toBe('rail.pathName.timed{"min":11}');
    expect(pathName({ id: "custom", title: "Onboarding" }, 11, t, () => false)).toBe("Onboarding");
  });

  test("one name everywhere: the map card, ⌘K and the rail call the 5-minute course by the same (real-time) name", () => {
    const has = (k: string) => k.startsWith("rail.pathName.");
    const long = (id: string) => ({ s0: 120, s1: 240, s2: 420, s3: 180 })[id] ?? 0;
    // 16 minutes of stops: named by the real time, exactly as the rail card names it
    expect(courseName([five], "5min", long, t, has)).toBe('rail.pathName.timed{"min":16}');
    expect(courseName([five], "5min", long, t, has)).toBe(pathName(five, pathProgress(five, {}, long).totalMin, t, has));
    // close to its nominal time: the nominal name; no such course: null
    expect(courseName([five], "5min", (id) => (id === "s0" ? 300 : 0), t, has)).toBe("rail.pathName.5min");
    expect(courseName([five], "30min", at, t, has)).toBeNull();
  });

  test("after a course, the next unread one in course order", () => {
    const p = (id: string) => ({ id, title: id, steps: [{ section: "s0" }] }) as unknown as DocOutline["readingPaths"][number];
    const all = [p("5min"), p("30min"), p("reviewer"), p("pm")];
    expect(nextPathAfter(all, "5min", () => false)?.id).toBe("30min");
    expect(nextPathAfter(all, "5min", (x) => x.id === "30min")?.id).toBe("reviewer");
    expect(nextPathAfter(all, "pm", () => false)?.id).toBe("5min");
    expect(nextPathAfter(all, "5min", () => true)).toBeNull();
  });

  test("a section read counts for every course that stops there (one ws-wide map, merged with the old per-path ones)", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    try {
      store.set(`mitori:read:${WS}:30min`, JSON.stringify({ s4: "old" }));
      expect(markRead(WS, "s0", "now")).toBe(true);
      expect(markRead(WS, "s0", "later")).toBe(false);
      expect(readMapOf(WS, "5min")).toEqual({ s0: "now" });
      expect(readMapOf(WS, "30min")).toEqual({ s4: "old", s0: "now" });
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
