/**
 * @mitori/web — `reader/` (owner: WP-10a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { BlockView, ReaderLevel, SectionId } from "@mitori/core";
import type { MarginCardInput, MarginCardPlacement } from "../contract.ts";
import { blockVisibleImpl, permalinkTextImpl } from "./levels.ts";
import { layoutMarginCardsImpl } from "./margin.ts";

/** Algorithm in ux.md §6.3 (deterministic; unit-tested with 30-thread fixtures). */
export function layoutMarginCards(cards: readonly MarginCardInput[]): MarginCardPlacement[] {
  return layoutMarginCardsImpl(cards);
}

/**
 * Permalink copy format (`y`): `§3.2 認証フロー — login.go:40-78\n<url>` (Slack-friendly). R1 [UXP-13]: `<url>`
 * is PORTABLE — GitHub blob URL of the committed doc file `#L<mdLine>` when `.mitori/` is committed and
 * origin is GitHub, else `mitori open <docId>#<block>`; the local URL only via ⌘K 「ローカルURLをコピー」.
 */
export function permalinkText(opts: { section: SectionId; title: string; cite?: string; url: string }): string {
  return permalinkTextImpl(opts);
}

/** Selected block view helper: is a block visible at a reader level (READER_LEVEL_RULES)? Pure. */
export function blockVisible(block: Pick<BlockView, "depth" | "kind">, level: ReaderLevel): "expanded" | "collapsed" | "hidden" {
  return blockVisibleImpl(block, level);
}
