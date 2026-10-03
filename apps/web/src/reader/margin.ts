/**
 * Margin card placement (ux.md §6.3; Editorial §4.1 + JUDGEMENT X14): push-down layout around the active card,
 * then collapse the oldest resolved (then open) cards while more than `marginCardsMax` are expanded or a card sits
 * ≥ `marginMaxDisplacePx` from its anchor. Deterministic and pure.
 */
import { type MarginCardInput, type MarginCardPlacement, UI_THRESHOLDS } from "../contract.ts";

const GAP = UI_THRESHOLDS.marginGapPx;
const COLLAPSED = UI_THRESHOLDS.marginCollapsedPx;

interface Work {
  c: MarginCardInput;
  h: number;
  y: number;
  collapsed: boolean;
}

function place(list: Work[]): number {
  const n = list.length;
  if (n === 0) return 0;
  const a = list.findIndex((w) => w.c.active);
  if (a >= 0) {
    const act = list[a] as Work;
    act.y = act.c.ideal;
    for (let i = a - 1; i >= 0; i--) {
      const w = list[i] as Work;
      const below = list[i + 1] as Work;
      w.y = Math.min(w.c.ideal, below.y - GAP - w.h);
    }
    for (let i = a + 1; i < n; i++) {
      const w = list[i] as Work;
      const above = list[i - 1] as Work;
      w.y = Math.max(w.c.ideal, above.y + above.h + GAP);
    }
  } else {
    (list[0] as Work).y = Math.max(0, (list[0] as Work).c.ideal);
    for (let i = 1; i < n; i++) {
      const w = list[i] as Work;
      const above = list[i - 1] as Work;
      w.y = Math.max(w.c.ideal, above.y + above.h + GAP);
    }
  }
  // y ≥ 0 and no overlap, top-down
  let displace = 0;
  for (let i = 0; i < n; i++) {
    const w = list[i] as Work;
    const floor = i === 0 ? 0 : (list[i - 1] as Work).y + (list[i - 1] as Work).h + GAP;
    w.y = Math.max(w.y, floor);
    displace = Math.max(displace, Math.abs(w.y - w.c.ideal));
  }
  return displace;
}

/** Next card to collapse: non-active `resolved` cards oldest first, then `open` oldest first. */
function nextToCollapse(list: Work[]): Work | null {
  for (const kind of ["resolved", "open"] as const) {
    let best: Work | null = null;
    for (const w of list) {
      if (w.collapsed || w.c.active || w.c.collapsible !== kind) continue;
      if (!best || w.c.age > best.c.age || (w.c.age === best.c.age && w.c.id < best.c.id)) best = w;
    }
    if (best) return best;
  }
  return null;
}

export function layoutMarginCardsImpl(cards: readonly MarginCardInput[]): MarginCardPlacement[] {
  const list: Work[] = cards
    .filter((c) => c.visible)
    .map((c) => ({ c, h: c.height, y: c.ideal, collapsed: false }))
    .sort((p, q) => p.c.ideal - q.c.ideal || Number(q.c.active) - Number(p.c.active) || (p.c.id < q.c.id ? -1 : p.c.id > q.c.id ? 1 : 0));
  let displace = place(list);
  let expanded = list.length;
  while (expanded > UI_THRESHOLDS.marginCardsMax || displace >= UI_THRESHOLDS.marginMaxDisplacePx) {
    const w = nextToCollapse(list);
    if (!w) break;
    w.collapsed = true;
    w.h = COLLAPSED;
    expanded--;
    displace = place(list);
  }
  const byId = new Map(list.map((w) => [w.c.id, w]));
  return cards.map((c) => {
    const w = byId.get(c.id);
    if (!w) return { id: c.id, y: 0, collapsed: false, hidden: true };
    return { id: c.id, y: Math.round(w.y), collapsed: w.collapsed, hidden: false };
  });
}
