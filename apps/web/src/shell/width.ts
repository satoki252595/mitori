/**
 * Column widths from the grid CONTAINER's clientWidth (ResizeObserver; never 100vw, so a 17 px scrollbar or a
 * narrowed window is accounted for) — ux.md R1 §3.1 / §4.4, UXP-03, AC-U-W01:
 *  - S2: container < rail + 672 + margin ⇒ rail becomes a drawer; < 672 + 640 ⇒ review is a right overlay
 *    (`min(640, container − 48)`); code mode < 1,092 ⇒ bottom sheet.
 *  - < 1024: drawer + bottom sheets everywhere; < 600: phone.
 */
import type { CtxMode } from "../contract.ts";

export const PROSE_MIN = 672;
export const REVIEW_W = 640;

export type ViewForLayout = "map" | "doc" | "code" | "inbox" | "other";

export interface Layout {
  width: number;
  tier: "wide" | "laptop" | "tablet" | "phone";
  rail: number;
  railMode: "inline" | "drawer";
  /** Right column width in px (0 when hidden / sheet / overlay). */
  ctx: number;
  ctxPlacement: "column" | "overlay" | "sheet" | "none";
  /** Map right column. */
  mapRight: number;
}

/** Toast width (`--toast-w`) and the gap to the edge of what it sits beside. */
export const TOAST_W = 420;
const TOAST_GAP = 20;

/**
 * Right offset of the toast stack (EX-11): beside the context column / the map's card column, never over it (their
 * footers carry 送信 · 採用 · 却下 · 生成する). When the page area left of the column is narrower than a toast (a
 * tablet sheet, an overlay), the stack keeps the page edge.
 */
export function toastRight(l: Pick<Layout, "width" | "ctx" | "ctxPlacement" | "mapRight">, view: ViewForLayout): number {
  const beside = l.ctxPlacement === "column" ? l.ctx : view === "map" ? l.mapRight : 0;
  if (beside <= 0) return TOAST_GAP;
  const right = beside + TOAST_GAP;
  return l.width - right >= TOAST_W + TOAST_GAP ? right : TOAST_GAP;
}

export function computeLayout(width: number, view: ViewForLayout, mode: CtxMode, codeWidth: number, railCollapsed: boolean): Layout {
  const tier = width >= 1281 ? "wide" : width >= 1024 ? "laptop" : width >= 600 ? "tablet" : "phone";
  const railW = tier === "wide" ? 248 : 228;
  const margin = tier === "wide" ? 368 : 332;
  const mapRight = tier === "wide" ? 400 : 360;
  const base: Layout = { width, tier, rail: railW, railMode: "inline", ctx: 0, ctxPlacement: "none", mapRight };
  if (tier === "tablet" || tier === "phone")
    return { ...base, rail: 0, railMode: "drawer", ctxPlacement: view === "doc" || view === "code" ? "sheet" : "none", mapRight: 0 };
  const rail = railCollapsed ? 0 : railW;
  if (view === "map") return { ...base, rail, railMode: railCollapsed ? "drawer" : "inline" };
  if (view !== "doc" && view !== "code") return { ...base, rail, railMode: railCollapsed ? "drawer" : "inline" };
  if (view === "code") return { ...base, rail, ctx: margin, ctxPlacement: "column" };
  if (mode === "review") {
    // review folds the rail to 0; below 672 + 640 it becomes an overlay of the same component
    if (width < PROSE_MIN + REVIEW_W) return { ...base, rail: 0, railMode: "drawer", ctx: Math.min(REVIEW_W, width - 48), ctxPlacement: "overlay" };
    return { ...base, rail: 0, railMode: "drawer", ctx: REVIEW_W, ctxPlacement: "column" };
  }
  if (mode === "code") {
    if (width < 1092) return { ...base, rail: 0, railMode: "drawer", ctx: 0, ctxPlacement: "sheet" };
    let r = rail;
    let room = width - r - PROSE_MIN;
    if (room < 420) {
      r = 0;
      room = width - PROSE_MIN;
    }
    const ctx = Math.max(420, Math.min(900, Math.min(codeWidth, room)));
    return { ...base, rail: r, railMode: r === 0 ? "drawer" : "inline", ctx, ctxPlacement: "column" };
  }
  // margin
  const fits = width >= rail + PROSE_MIN + margin;
  return { ...base, rail: fits ? rail : 0, railMode: fits && rail > 0 ? "inline" : "drawer", ctx: margin, ctxPlacement: "column" };
}
