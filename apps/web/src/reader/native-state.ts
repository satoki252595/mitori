import type { AnchorInput, BlockId, SectionId, WorkspaceKey } from "@mitori/core";
import type { Anchor } from "./scroll-anchor.ts";
import type { WindowRange } from "./virtual.ts";

/** Browser state handed from the canonical server-rendered reader to the full editor. */
export interface NativeReaderState {
  page: SectionId;
  ws: WorkspaceKey;
  focused: BlockId | null;
  forced: BlockId[];
  scrollY: number;
  anchor: Anchor | null;
  window?: WindowRange;
  /** Visible streaming regions keep their reservation through an SSE refresh or full editor hand-off. */
  reservations?: { section: SectionId; height: number }[];
  /** Uncommitted streamed text remains plain text during a same-page refresh or editor hand-off. */
  partials?: { section: SectionId; text: string; reservedPx: number }[];
  selection: { block: BlockId; start: number; end: number; anchor: AnchorInput } | null;
}

/** The same block-count windows as BlockHost: keep one neighbour on each side of an anchor. */
export function initialReaderWindow(order: readonly BlockId[], focused: BlockId | null, size: number): WindowRange {
  const count = Math.max(1, Math.ceil(order.length / size));
  const index = focused ? order.indexOf(focused) : -1;
  const at = index < 0 ? 0 : Math.floor(index / size);
  return { first: Math.max(0, at - 1), last: Math.min(count - 1, at + (index < 0 ? 2 : 1)) };
}
