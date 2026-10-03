/**
 * Reader popovers (cite peek, term card, claim check — ux.md §4.3.5–4.3.7): fixed boxes touching their anchor,
 * below it, above when there is no room; they follow the anchor while the page scrolls or resizes (a fixed box
 * would otherwise float away from its chip).
 */

export interface Rect {
  left: number;
  top: number;
  bottom: number;
}

/**
 * Position of a `w` × `h` popover for an anchor rect in a `vw` × `vh` viewport (pure): below when it fits, else
 * above when it fits, else on the roomier side with `maxH` (the box scrolls inside) — never over the anchor.
 */
export function popoverPos(a: Rect, w: number, h: number, vw: number, vh: number, minTop = 60): { left: number; top: number; maxH: number | null } {
  const left = Math.max(16, Math.min(a.left, vw - w - 16));
  const roomBelow = vh - 30 - (a.bottom + 6);
  const roomAbove = a.top - 6 - minTop;
  if (h <= roomBelow) return { left, top: a.bottom + 6, maxH: null };
  if (h <= roomAbove) return { left, top: a.top - 6 - h, maxH: null };
  if (roomBelow >= roomAbove) return { left, top: a.bottom + 6, maxH: Math.max(80, roomBelow) };
  const maxH = Math.max(80, roomAbove);
  return { left, top: a.top - 6 - maxH, maxH };
}

/** Place now and on every scroll / resize / own content resize (rAF-batched). Returns the cleanup. */
export function followAnchor(place: () => void, el?: Element | null): () => void {
  place();
  let raf = 0;
  const on = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(place);
  };
  window.addEventListener("scroll", on, { passive: true, capture: true });
  window.addEventListener("resize", on, { passive: true });
  // the box can grow after mount (code lines, fonts): measured above the chip, it would then cover it
  const ro = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
  if (el) ro?.observe(el);
  return () => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
    window.removeEventListener("scroll", on, { capture: true });
    window.removeEventListener("resize", on);
  };
}
