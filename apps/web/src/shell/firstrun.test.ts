/** NC-08: a first visit reads at 「初めて」 (and so the 5-minute course); a level chosen anywhere is kept. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DocOutline, WorkspaceKey } from "@mitori/core";
import { firstRunLevel } from "./firstrun.ts";
import { defaultPathId, selectedPath } from "./reading.ts";

describe("NC-08 first run", () => {
  test("only an untouched default on a browser that never showed mitori becomes 初めて, once", () => {
    expect(firstRunLevel({ cookieHasLevel: false, seen: false, current: "standard" })).toBe("newcomer");
    // the server already says 詳しい (chosen in another browser): kept
    expect(firstRunLevel({ cookieHasLevel: false, seen: false, current: "expert" })).toBeNull();
    // a returning browser (the cookie carries its level) or a second visit: nothing changes
    expect(firstRunLevel({ cookieHasLevel: true, seen: false, current: "standard" })).toBeNull();
    expect(firstRunLevel({ cookieHasLevel: false, seen: true, current: "standard" })).toBeNull();
  });

  describe("the course follows the level when none was chosen", () => {
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
    const o = {
      manifest: { generatedAt: "2026-10-04T00:00:00Z" },
      readingPaths: [
        { id: "5min", title: "5分コース", steps: [] },
        { id: "30min", title: "30分コース", steps: [] },
      ],
    } as unknown as DocOutline;
    const WS = "ws_first0000000" as WorkspaceKey;
    test("初めて → 5 minutes, otherwise 30", () => {
      expect(defaultPathId("newcomer")).toBe("5min");
      expect(selectedPath(o, WS, "newcomer")?.id).toBe("5min");
      expect(selectedPath(o, WS, "standard")?.id).toBe("30min");
      expect(selectedPath(o, WS)?.id).toBe("30min");
    });
  });
});
