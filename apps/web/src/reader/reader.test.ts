import { describe, expect, test } from "bun:test";
import { type MarginCardInput, UI_THRESHOLDS } from "../contract.ts";
import { blockVisible, layoutMarginCards, permalinkText } from "./index.ts";
import { stepLevel } from "./levels.ts";

const card = (id: string, ideal: number, o: Partial<MarginCardInput> = {}): MarginCardInput => ({
  id,
  ideal,
  height: 96,
  active: false,
  collapsible: "open",
  age: 0,
  visible: true,
  ...o,
});

function overlaps(ps: { y: number; h: number }[]): boolean {
  const s = [...ps].sort((a, b) => a.y - b.y);
  return s.some((p, i) => i > 0 && p.y < (s[i - 1] as { y: number; h: number }).y + (s[i - 1] as { h: number }).h);
}

describe("AC-J25 layoutMarginCards (ux.md §6.3)", () => {
  test("non-overlapping push-down; ideal positions kept when there is room", () => {
    const out = layoutMarginCards([card("a", 0), card("b", 300), card("c", 310)]);
    expect(out.map((p) => p.y)).toEqual([0, 300, 408]);
  });

  test("the active card keeps its ideal position; cards above move up", () => {
    const out = layoutMarginCards([card("a", 100), card("b", 120, { active: true })]);
    expect(out.find((p) => p.id === "b")?.y).toBe(120);
    expect(out.find((p) => p.id === "a")?.y).toBe(120 - 12 - 96);
  });

  test("hidden anchors ⇒ hidden placement", () => {
    expect(layoutMarginCards([card("a", 10, { visible: false })])[0]).toEqual({ id: "a", y: 0, collapsed: false, hidden: true });
  });

  test("30 threads in one section: ≤ 8 expanded, none ≥ 480 px from its anchor, resolved collapse first", () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      card(`t${String(i).padStart(2, "0")}`, i * 40, { collapsible: i % 3 === 0 ? "resolved" : "open", age: 30 - i, active: i === 14 }),
    );
    const out = layoutMarginCards(cards);
    const expanded = out.filter((p) => !p.collapsed && !p.hidden);
    expect(expanded.length).toBeLessThanOrEqual(UI_THRESHOLDS.marginCardsMax);
    for (const p of out) {
      const c = cards.find((x) => x.id === p.id) as MarginCardInput;
      expect(Math.abs(p.y - c.ideal)).toBeLessThan(UI_THRESHOLDS.marginMaxDisplacePx);
    }
    expect(out.find((p) => p.id === "t14")?.collapsed).toBe(false);
    const placed = out.map((p) => ({ y: p.y, h: p.collapsed ? UI_THRESHOLDS.marginCollapsedPx : 96 }));
    expect(overlaps(placed)).toBe(false);
    // determinism
    expect(layoutMarginCards(cards)).toEqual(out);
  });
});

describe("READER_LEVEL_RULES as data", () => {
  test("blockVisible", () => {
    expect(blockVisible({ depth: "L3", kind: "prose" }, "newcomer")).toBe("hidden");
    expect(blockVisible({ depth: "L3", kind: "prose" }, "standard")).toBe("collapsed");
    expect(blockVisible({ depth: "L3", kind: "prose" }, "expert")).toBe("expanded");
    expect(blockVisible({ depth: "L1", kind: "why" }, "newcomer")).toBe("expanded");
    expect(blockVisible({ depth: "L1", kind: "why" }, "standard")).toBe("collapsed");
    expect(blockVisible({ depth: "L2", kind: "deepdive" }, "newcomer")).toBe("hidden");
    expect(blockVisible({ depth: "L0", kind: "prose" }, "newcomer")).toBe("expanded");
  });

  test("level keys step and clamp", () => {
    expect(stepLevel("standard", -1)).toBe("newcomer");
    expect(stepLevel("newcomer", -1)).toBe("newcomer");
    expect(stepLevel("expert", 1)).toBe("expert");
    expect(stepLevel("expert", 0)).toBe("standard");
  });

  test("permalinkText (Slack-friendly two lines)", () => {
    expect(permalinkText({ section: "s3/auth", title: "3.2 Auth flow", cite: "login.go:40-78", url: "mitori open doc_x#b_y" })).toBe(
      "§3.2 Auth flow — login.go:40-78\nmitori open doc_x#b_y",
    );
    expect(permalinkText({ section: "s4", title: "Quickstart", url: "u" })).toBe("§4 Quickstart\nu");
  });
});
