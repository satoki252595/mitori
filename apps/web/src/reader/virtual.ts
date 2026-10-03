/**
 * Block windowing for long pages (ux.md §12.8: > `virtualizeBlocks` blocks ⇒ windows of `blockWindow`, viewport
 * ± 1 window mounted, the rest are spacers of measured or estimated height). Pure arithmetic.
 */
export interface WindowRange {
  first: number;
  last: number;
}

/** Estimated block height from its reading time (ux.md §4.3.16): ceil(readingSec × 8.33 / 37) × 30.4 + 14 px. */
export function estimateBlockPx(readingSec: number): number {
  return Math.ceil(Math.max(1, readingSec) * (8.33 / 37)) * 30.4 + 14;
}

/** Windows covering [top − one window, bottom + one window] given window heights and the viewport. */
export function visibleWindows(heights: readonly number[], offsetTop: number, viewTop: number, viewBottom: number): WindowRange {
  const n = heights.length;
  if (n === 0) return { first: 0, last: -1 };
  let y = offsetTop;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const h = heights[i] as number;
    if (y + h >= viewTop && y <= viewBottom) {
      if (first < 0) first = i;
      last = i;
    }
    y += h;
  }
  if (first < 0) {
    // viewport beyond the content: keep the last window
    first = viewTop < offsetTop ? 0 : n - 1;
    last = first;
  }
  return { first: Math.max(0, first - 1), last: Math.min(n - 1, last + 1) };
}

export function sum(a: readonly number[], from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] ?? 0;
  return s;
}

/** Window index of a block index. */
export function windowOf(blockIndex: number, size: number): number {
  return Math.floor(blockIndex / size);
}
