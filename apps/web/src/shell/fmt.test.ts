import { beforeEach, describe, expect, test } from "bun:test";
import { useCatalog } from "./__tests__/catalog.ts";
import { ellipsizeMiddle, fmtClock, fmtInt, fmtLocShort, fmtRelative } from "./fmt.ts";
import { fmtDelta, fmtDuration, fmtTokens, fmtUsd } from "./index.ts";

describe("WEB-U fmt (ux.md §9.3, JUDGEMENT §6.17) — table driven", () => {
  beforeEach(() => useCatalog("ja"));
  test.each([
    [0, {}, "0"],
    [999, {}, "999"],
    [1000, {}, "1k"],
    [2500, {}, "2.5k"],
    [21_400, {}, "21.4k"],
    [52_000, {}, "52k"],
    [120_000, { approx: true }, "≈0.12M"],
    [380_000, {}, "0.38M"],
    [400_000, { main: true }, "約0.4M"],
    [1_100_000, { approx: true }, "≈1.1M"],
  ])("fmtTokens(%p, %p) = %p", (n, opts, out) => {
    expect(fmtTokens(n, opts)).toBe(out);
  });

  test.each([
    [0.0183, "job", "$0.018"],
    [1.333, "day", "$1.33"],
    [1.27, "gen", "$1.27"],
    [1.31, "genMain", "$1.3"],
    [0.0004, "job", "<$0.001"],
  ] as const)("fmtUsd(%p, %p) = %p", (n, ctx, out) => {
    expect(fmtUsd(n, ctx)).toBe(out);
  });

  test("fmtDuration (words from the catalog of `lang`)", () => {
    expect(fmtDuration(5100, "job", "ja")).toBe("5.1秒");
    expect(fmtDuration(372_000, "job", "ja")).toBe("6分12秒");
    expect(fmtDuration(360_000, "gen", "ja")).toBe("約6分");
    useCatalog("en");
    expect(fmtDuration(5100, "job", "en")).toBe("5.1s");
    expect(fmtDuration(372_000, "job", "en")).toBe("6m 12s");
    expect(fmtDuration(1_020_000, "gen", "en")).toBe("~17 min");
    expect(fmtTokens(400_000, { main: true })).toBe("~0.4M");
    expect(fmtClock(156_000)).toBe("2:36");
  });

  test("contract signatures keep `lang` (fmtTokens opts.lang, fmtDuration 3rd arg): a loaded catalog other than the active one is used", () => {
    useCatalog("ja");
    useCatalog("en");
    // active = en, ja loaded earlier
    expect(fmtTokens(400_000, { main: true, lang: "ja" })).toBe("約0.4M");
    expect(fmtTokens(400_000, { main: true, lang: "en" })).toBe("~0.4M");
    expect(fmtDuration(360_000, "gen", "ja")).toBe("約6分");
    expect(fmtDuration(360_000, "gen", "en")).toBe("~6 min");
  });

  test("fmtDelta uses U+2212", () => {
    expect(fmtDelta(3900, 3980)).toBe("−2%");
    expect(fmtDelta(105, 100)).toBe("+5%");
    expect(fmtDelta(100, 100)).toBe("±0%");
    expect(fmtDelta(1, 0)).toBe("±0%");
  });

  test("paths shortened in the middle (S0 card root)", () => {
    expect(ellipsizeMiddle("/Users/me/repo", 40)).toBe("/Users/me/repo");
    const s = ellipsizeMiddle("/Users/satoki252595/work/20261002_aiAgentTool/.claude/worktrees/x/crit", 32);
    expect([...s].length).toBe(32);
    expect(s.startsWith("/Users/sato")).toBe(true);
    expect(s.endsWith("worktrees/x/crit")).toBe(true);
    expect(s).toContain("…");
  });

  test("LOC and integers", () => {
    expect(fmtLocShort(45_672)).toBe("45.7k");
    expect(fmtInt(45_672, "ja")).toBe("45,672");
  });

  test("relative time in ja has no space between digits and kana", () => {
    const now = Date.parse("2026-10-03T00:00:00Z");
    const s = fmtRelative("2026-09-30T00:00:00Z", now, "ja");
    expect(s).not.toMatch(/\d[   ]/);
    expect(fmtRelative("2026-09-30T00:00:00Z", now, "en")).toBe("3 days ago");
  });
});
