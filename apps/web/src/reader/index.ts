/**
 * @mitori/web — `reader/` (owner: WP-10a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type BlockView, type ReaderLevel, type SectionId, unsupported } from "@mitori/core";
import type { MarginCardInput, MarginCardPlacement } from "../contract.ts";

/** Algorithm in ux.md §6.3 (deterministic; unit-tested with 30-thread fixtures). */
export function layoutMarginCards(cards: readonly MarginCardInput[]): MarginCardPlacement[] {
  return unsupported("web.layoutMarginCards", cards);
}

/**
 * Permalink copy format (`y`): `§3.2 認証フロー — login.go:40-78\n<url>` (Slack-friendly). R1 [UXP-13]: `<url>`
 * is PORTABLE — GitHub blob URL of the committed doc file `#L<mdLine>` when `.mitori/` is committed and
 * origin is GitHub, else `mitori open <docId>#<block>`; the local URL only via ⌘K 「ローカルURLをコピー」.
 */
export function permalinkText(opts: { section: SectionId; title: string; cite?: string; url: string }): string {
  return unsupported("web.permalinkText", opts);
}

/** Selected block view helper: is a block visible at a reader level (READER_LEVEL_RULES)? Pure. */
export function blockVisible(block: Pick<BlockView, "depth" | "kind">, level: ReaderLevel): "expanded" | "collapsed" | "hidden" {
  return unsupported("web.blockVisible", block, level);
}
