/**
 * Scroll compensation shared by SSE block mutations and reader-level switches (ux.md §4.3.9-5, §7.1, AC-J20):
 * remember the first block visible below the sticky header and its top; after the DOM change (same frame),
 * scroll by the difference. Safari has no `overflow-anchor`, and `.prose` disables it elsewhere so both engines
 * behave the same.
 */
export interface Anchor {
  id: string;
  top: number;
}

const HEADER = 52;

export function captureAnchor(root: ParentNode): Anchor | null {
  const blocks = root.querySelectorAll<HTMLElement>(".blk[data-b]");
  let fallback: Anchor | null = null;
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    if (r.bottom > HEADER) return { id: el.dataset.b ?? "", top: r.top };
    fallback = { id: el.dataset.b ?? "", top: r.top };
  }
  return fallback;
}

/** Scroll so the anchor block is where it was; if it vanished, the nearest previous visible block is used. */
export function restoreAnchor(root: ParentNode, a: Anchor | null, order?: readonly string[]): void {
  if (!a) return;
  let el = root.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(a.id)}"]`);
  if ((!el || el.getBoundingClientRect().height === 0) && order) {
    const i = order.indexOf(a.id);
    for (let k = i - 1; k >= 0; k--) {
      const c = root.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(order[k] as string)}"]`);
      if (c && c.getBoundingClientRect().height > 0) {
        el = c;
        break;
      }
    }
  }
  if (!el) return;
  const d = el.getBoundingClientRect().top - a.top;
  if (Math.abs(d) >= 0.5) window.scrollBy(0, d);
}
