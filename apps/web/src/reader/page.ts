/**
 * Page assembly (ux.md §2.3-1): a page = a section whose file differs from its parent's, drawn with its same-file
 * descendants. Blocks may arrive in the page's view (server includes descendants) or in each child's view; both
 * are accepted. Pure.
 */
import type { BlockId, BlockView, SectionId, SectionNode, SectionView } from "@mitori/core";
import { type OutlineIndex, pageSections } from "./outline.ts";

export interface PagePart {
  node: SectionNode;
  num: string;
  /** true for the page's own section (chapter head), false for same-file sub-sections. */
  top: boolean;
  blocks: BlockView[];
  loaded: boolean;
}

export interface PageModel {
  page: SectionId;
  parts: PagePart[];
  /** All blocks in reading order (j/k, windowing). */
  order: BlockId[];
  total: number;
}

export function sectionsToFetch(ix: OutlineIndex, page: SectionId, have: (id: SectionId) => SectionView | undefined): SectionId[] {
  const pv = have(page);
  const out: SectionId[] = [];
  for (const id of pageSections(ix, page)) {
    if (id === page) continue;
    if (pv?.blocks.some((b) => b.section === id)) continue;
    if (!have(id)) out.push(id);
  }
  return out;
}

export function buildPage(ix: OutlineIndex, page: SectionId, have: (id: SectionId) => SectionView | undefined): PageModel {
  const pv = have(page);
  const parts: PagePart[] = [];
  const order: BlockId[] = [];
  for (const id of pageSections(ix, page)) {
    const node = ix.nodes.get(id);
    if (!node) continue;
    let blocks: BlockView[] = [];
    let loaded = false;
    const own = have(id);
    if (id === page && pv) {
      blocks = pv.blocks.filter((b) => b.section === id || !ix.nodes.has(b.section) || ix.pageOf.get(b.section) !== page);
      loaded = true;
    } else if (pv?.blocks.some((b) => b.section === id)) {
      blocks = pv.blocks.filter((b) => b.section === id);
      loaded = true;
    } else if (own) {
      blocks = own.blocks.filter((b) => b.section === id);
      loaded = true;
    }
    blocks = [...blocks].sort((a, b) => a.ord - b.ord);
    for (const b of blocks) order.push(b.id);
    parts.push({ node, num: ix.numbers.get(id) ?? "", top: id === page, blocks, loaded });
  }
  return { page, parts, order, total: order.length };
}

/** Runs of consecutive L3 blocks (for the newcomer "詳しく（n）" chips): first block id → run length. */
export function l3Runs(blocks: readonly BlockView[]): Map<BlockId, number> {
  const out = new Map<BlockId, number>();
  let start: BlockId | null = null;
  let n = 0;
  for (const b of blocks) {
    const l3 = b.depth === "L3" || b.kind === "deepdive";
    if (l3) {
      if (start === null) start = b.id;
      n++;
    } else if (start !== null) {
      out.set(start, n);
      start = null;
      n = 0;
    }
  }
  if (start !== null) out.set(start, n);
  return out;
}

/** Next/previous visible block for j/k (blocks hidden at this level are skipped). */
export function stepBlock(order: readonly BlockId[], from: BlockId | null, dir: 1 | -1, visible: (id: BlockId) => boolean): BlockId | null {
  let i = from === null ? (dir > 0 ? -1 : order.length) : order.indexOf(from);
  for (;;) {
    i += dir;
    if (i < 0 || i >= order.length) return null;
    const id = order[i] as BlockId;
    if (visible(id)) return id;
  }
}
