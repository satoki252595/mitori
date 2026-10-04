/**
 * AC-U-W01 / UXP-03 container-width layout (ux.md §3.1 / §4.4): widths come from the grid container, the rail turns
 * into a drawer below rail + 672 + margin, review folds the rail and overlays below 672 + 640, code mode becomes a
 * bottom sheet below 1,092 px, and the prose column never drops under 672 px while a column is shown.
 */
import { describe, expect, test } from "bun:test";
import { computeLayout, PROSE_MIN, REVIEW_W, TOAST_W, toastRight } from "./width.ts";

/** The AC-U-W01 matrix with a 17 px classic scrollbar (container = viewport − 17). */
const WIDTHS = [1024, 1180, 1194, 1280, 1366, 1440].map((w) => w - 17);

describe("computeLayout", () => {
  test.each(WIDTHS)("S2 margin at %i: prose ≥ 672 or the context column is not a column", (w) => {
    const l = computeLayout(w, "doc", "margin", 520, false);
    const prose = w - l.rail - (l.ctxPlacement === "column" ? l.ctx : 0);
    expect(prose).toBeGreaterThanOrEqual(PROSE_MIN);
    expect(l.railMode).toBe(w >= l.rail + PROSE_MIN + l.ctx && l.rail > 0 ? "inline" : "drawer");
  });

  test("tiers: wide ≥ 1281 (248 / 368 / 400), laptop 1024–1280 (228 / 332 / 360), tablet drawer + sheet", () => {
    expect(computeLayout(1440, "doc", "margin", 520, false)).toMatchObject({ tier: "wide", rail: 248, ctx: 368, railMode: "inline" });
    expect(computeLayout(1280, "doc", "margin", 520, false)).toMatchObject({ tier: "laptop", rail: 228, ctx: 332, railMode: "inline" });
    expect(computeLayout(1100, "doc", "margin", 520, false)).toMatchObject({ rail: 0, railMode: "drawer", ctx: 332, ctxPlacement: "column" });
    expect(computeLayout(900, "doc", "margin", 520, false)).toMatchObject({ tier: "tablet", rail: 0, railMode: "drawer", ctxPlacement: "sheet" });
    expect(computeLayout(1440, "map", "margin", 520, false).mapRight).toBe(400);
    expect(computeLayout(1280, "map", "margin", 520, false).mapRight).toBe(360);
  });

  test("review folds the rail; below 672 + 640 it overlays at min(640, width − 48)", () => {
    expect(computeLayout(1423, "doc", "review", 520, false)).toMatchObject({ rail: 0, ctx: REVIEW_W, ctxPlacement: "column" });
    expect(computeLayout(1200, "doc", "review", 520, false)).toMatchObject({ rail: 0, ctx: REVIEW_W, ctxPlacement: "overlay" });
    expect(computeLayout(1100, "doc", "review", 520, false).ctx).toBe(Math.min(REVIEW_W, 1100 - 48));
  });

  test("code mode: bottom sheet under 1,092; otherwise 420–900 px wide, user width honoured", () => {
    expect(computeLayout(1091, "doc", "code", 520, false).ctxPlacement).toBe("sheet");
    expect(computeLayout(1500, "doc", "code", 520, false)).toMatchObject({ ctxPlacement: "column", ctx: 520 });
    // the user width yields to the prose minimum (1423 − 248 − 672 = 503)
    expect(computeLayout(1423, "doc", "code", 520, false)).toMatchObject({ ctxPlacement: "column", ctx: 503 });
    expect(computeLayout(1423, "doc", "code", 2000, false).ctx).toBeLessThanOrEqual(900);
    expect(computeLayout(1423, "doc", "code", 100, false).ctx).toBeGreaterThanOrEqual(420);
    const tight = computeLayout(1200, "doc", "code", 900, false);
    expect(1200 - tight.rail - tight.ctx).toBeGreaterThanOrEqual(PROSE_MIN);
  });

  test("a collapsed rail is a drawer everywhere", () => {
    expect(computeLayout(1440, "doc", "margin", 520, true)).toMatchObject({ rail: 0, railMode: "drawer" });
    expect(computeLayout(1440, "map", "margin", 520, true)).toMatchObject({ rail: 0, railMode: "drawer" });
  });
});

describe("EX-11 toasts never cover the context column", () => {
  test.each(WIDTHS)("at %i the stack sits left of the margin / review / code column (or the map's card column)", (w) => {
    for (const [view, mode] of [
      ["doc", "margin"],
      ["doc", "review"],
      ["doc", "code"],
      ["map", "margin"],
    ] as const) {
      const l = computeLayout(w, view, mode, 520, false);
      const right = toastRight(l, view);
      const column = l.ctxPlacement === "column" ? l.ctx : view === "map" ? l.mapRight : 0;
      // the toast's left edge stays inside the page, its right edge left of the column — or it keeps the page edge
      // only when the page beside the column is narrower than a toast
      if (w - column - 20 >= TOAST_W + 20) expect(right).toBe(column + 20);
      else expect(right).toBe(20);
      expect(w - right - TOAST_W).toBeGreaterThanOrEqual(0);
    }
  });
  test("tablet: the code sheet / no column ⇒ the page edge", () => {
    expect(toastRight(computeLayout(900, "doc", "margin", 520, false), "doc")).toBe(20);
  });
});
