/** ux.md §4.2.1 / §4.3.8 / §7.2: the tab's reading path (sessionStorage `mitori:path:<ws>`), none before generation. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocOutline, WorkspaceKey } from "@mitori/core";
import { choosePath, plannedPath, selectedPath } from "./reading.ts";

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
