/** ux.md §4.2.1 / §4.3.8 / §7.2: the tab's reading path (sessionStorage `mitori:path:<ws>`), none before generation. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocOutline, WorkspaceKey } from "@mitori/core";
import { choosePath, selectedPath } from "./reading.ts";

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
