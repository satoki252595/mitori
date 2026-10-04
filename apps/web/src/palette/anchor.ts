/** ⌘K 「AI に聞く」 (NC-09): where a question without a text hit is asked — the doc's own summary. Pure. */
import type { BlockId, DocOutline, SectionId } from "@mitori/core";

export interface AskAnchor {
  section: SectionId;
  block: BlockId;
}

/** The first readable block of §0 (not a heading, not a placeholder-only section) — the doc's own summary. */
export function summaryAnchor(o: Pick<DocOutline, "blocks"> | null): AskAnchor | null {
  if (!o) return null;
  const pick = (sec: string) => o.blocks.find(([, s, , kind]) => s === sec && kind !== "heading" && kind !== "placeholder");
  const b = pick("s0") ?? o.blocks.find(([, , , kind]) => kind !== "heading" && kind !== "placeholder");
  return b ? { section: b[1], block: b[0] } : null;
}
