/**
 * What a translation request covers (gen spec §12, D5): one block, or every text block of a section and its
 * sub-sections in document order, minus blocks already in `lang` and blocks whose cached translation is still fresh
 * (`DocStore.translation` compares the stored source hash with the current one) — so a second request costs 0 tokens.
 */
import type { Block, BlockId, DocLang, SectionId } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import { textBlock } from "../ondemand/plan.ts";

/** Blocks of `target` that still need a translation into `lang`; null when the target does not exist. */
export function translatable(doc: Pick<DocStore, "block" | "section" | "translation">, target: BlockId | SectionId, lang: DocLang): Block[] | null {
  let blocks: Block[];
  if (target.startsWith("b_")) {
    const b = doc.block(target as BlockId);
    if (!b) return null;
    blocks = [b];
  } else {
    const root = doc.section(target as SectionId);
    if (!root) return null;
    blocks = [];
    const walk = (id: SectionId) => {
      const s = doc.section(id);
      if (!s) return;
      blocks.push(...s.blocks);
      for (const child of s.node.children) walk(child);
    };
    walk(root.node.id);
  }
  return blocks.filter((b) => textBlock(b) && b.lang !== lang && doc.translation(b.id, lang) === null);
}
