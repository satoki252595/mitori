/**
 * Page assembly (ux.md §2.3-1): a page = a section whose file differs from its parent's, drawn with its same-file
 * descendants. Blocks may arrive in the page's view (server includes descendants) or in each child's view; both
 * are accepted. Pure.
 */
import type { BlockId, BlockView, GenRun, SectionId, SectionNode, SectionView } from "@mitori/core";
import { type OutlineIndex, pageSections } from "./outline.ts";

/**
 * The note under a chapter head about its generation (EX-11): a paused run says so on the pages it has not written
 * (budget, or the 5h window, with 再開する); with no run at work, an ungenerated doc says so; a written page
 * (`generated` / `static_only`) never claims to be ungenerated. null = no note.
 */
export function genNoteOf(
  run: Pick<GenRun, "state" | "paused"> | null,
  node: Pick<SectionNode, "state">,
  docGenerated: boolean,
): "paused" | "pausedBudget" | "notGenerated" | null {
  const written = node.state === "generated" || node.state === "static_only";
  if (run?.state === "paused" && !written) return run.paused?.reason === "budget" ? "pausedBudget" : "paused";
  if (!docGenerated && run?.state !== "running" && !written) return "notGenerated";
  return null;
}

export interface PagePart {
  node: SectionNode;
  num: string;
  /** true for the page's own section (chapter head), false for same-file sub-sections. */
  top: boolean;
  blocks: BlockView[];
  loaded: boolean;
  /**
   * The doc's own heading block of this section (`# 4. 動かしてみる`): the page header shows the title once, so
   * the block is not rendered again (CR m1-103); kept here for anchors / permalinks.
   */
  titleBlock?: BlockId;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();

/** The section's title heading: the first block, a heading whose text ends with the section title. */
export function isTitleBlock(b: Pick<BlockView, "kind" | "html">, node: Pick<SectionNode, "title">): boolean {
  if (b.kind !== "heading") return false;
  const title = node.title.replace(/\s+/g, " ").trim();
  return title.length > 0 && plain(b.html).endsWith(title);
}

export interface PageModel {
  page: SectionId;
  parts: PagePart[];
  /** All blocks in reading order (j/k, windowing). */
  order: BlockId[];
  total: number;
}

/** NC-19: a model tag describes this page's actual AI text, never a global manifest model. */
export function pageProvenance(parts: readonly Pick<PagePart, "blocks">[]) {
  const content = parts.flatMap((p) => p.blocks).filter((b) => b.kind !== "heading" && b.status !== "placeholder");
  return {
    staticOnly: content.length > 0 && content.every((b) => b.origin === "static" && (!b.htmlLang || b.htmlLang === b.lang)),
    models: [
      ...new Set(content.filter((b) => b.origin === "ai" && b.gen && (!b.htmlLang || b.htmlLang === b.lang)).map((b) => b.gen?.servedBy ?? b.gen?.model)),
    ]
      .filter((m): m is string => !!m)
      .sort(),
  };
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
    const first = blocks[0];
    const titleBlock = first && isTitleBlock(first, node) ? first.id : undefined;
    if (titleBlock) blocks = blocks.slice(1);
    for (const b of blocks) order.push(b.id);
    parts.push({ node, num: ix.numbers.get(id) ?? "", top: id === page, blocks, loaded, ...(titleBlock ? { titleBlock } : {}) });
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
