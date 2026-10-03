/**
 * Composer targets from the Reader: a text selection (floating toolbar), a focused block or a claim (`c` / `e` /
 * `f`, the gutter, the claim popover — the Reader's `mitori:compose` event). Adds what the DOM does not know:
 * the section and the block hash from the doc store.
 */
import type { Anchor, BlockId, BlockView, SectionId } from "@mitori/core";
import type { Stores } from "../stores/app.svelte.ts";
import { anchorFromBlock, type BlockAnchor } from "../threads/dom-anchor.ts";
import type { ComposerTarget } from "./session.svelte.ts";

export function blockView(s: Stores, id: BlockId): { view: BlockView; section: SectionId } | null {
  const ix = s.doc.index;
  const sec = ix?.blockSection.get(id);
  if (!sec) return null;
  const page = ix?.pageOf.get(sec) ?? sec;
  for (const at of [sec, page]) {
    const v = s.doc.section(at)?.blocks.find((b) => b.id === id);
    if (v) return { view: v, section: sec };
  }
  return null;
}

export function targetOf(s: Stores, a: BlockAnchor): ComposerTarget | null {
  const b = blockView(s, a.block);
  if (!b) return null;
  return {
    block: a.block,
    section: b.section,
    anchor: a.anchor,
    text: a.text,
    quote: a.quote,
    fileLine: a.fileLine,
    blockHash: b.view.hash,
    key: `${a.block}:${a.start}-${a.end}`,
    wholeBlock: a.wholeBlock,
  };
}

/** A block (+ optional claim) on the current page. */
export function targetOfBlock(s: Stores, block: BlockId, claim: string | null): ComposerTarget | null {
  const el = document.querySelector<HTMLElement>(`.blk[data-b="${CSS.escape(block)}"]`);
  const a = el ? anchorFromBlock(el, claim) : null;
  return a ? targetOf(s, a) : null;
}

/** Full `Anchor` for routes that take one (copy-as-prompt): the client knows the block hash and the quote. */
export function anchorOfTarget(t: ComposerTarget): Anchor {
  const q = t.anchor.doc?.quote;
  return { primary: "doc", doc: { block: t.block, blockHash: t.blockHash, ...(q ? { quote: q } : {}), offset: t.anchor.doc?.selStart ?? 0 } };
}
