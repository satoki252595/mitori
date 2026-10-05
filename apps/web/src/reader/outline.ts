/**
 * Outline helpers (pure): section tree, display numbers (`3`, `3.1`, `A`), pages (ux.md §2.3-1: a page is a
 * section whose file differs from its parent's), TOC state glyphs, per-section verdict / freshness counters
 * from the compact `OutlineBlock` tuples.
 */
import type { BlockId, DocOutline, Freshness, SectionId, SectionNode, Verdict } from "@mitori/core";

export interface OutlineIndex {
  nodes: Map<SectionId, SectionNode>;
  parent: Map<SectionId, SectionId>;
  roots: SectionId[];
  numbers: Map<SectionId, string>;
  /** Reading (TOC) order of every section. */
  order: SectionId[];
  /** Page of each section. */
  pageOf: Map<SectionId, SectionId>;
  /** Pages in TOC order (`read.chapter` 1–9 = the n-th page, §0 = 1; UXP-34). */
  pages: SectionId[];
  /** Block id → section. */
  blockSection: Map<BlockId, SectionId>;
  stats: Map<SectionId, SectionStats>;
}

export interface SectionStats {
  blocks: number;
  verified: number;
  inferred: number;
  stale: number;
  unsupported: number;
  /** Actual non-heading provenance, independent of the section's scheduling state. */
  authored: number;
  static: number;
}

export function indexOutline(o: DocOutline): OutlineIndex {
  const nodes = new Map(o.sections.map((s) => [s.id, s]));
  const parent = new Map<SectionId, SectionId>();
  for (const s of o.sections) for (const c of s.children) parent.set(c, s.id);
  const roots = o.sections.filter((s) => !parent.has(s.id)).map((s) => s.id);
  const numbers = new Map<SectionId, string>();
  const order: SectionId[] = [];
  const pageOf = new Map<SectionId, SectionId>();
  const pages: SectionId[] = [];
  const walk = (id: SectionId, num: string, page: SectionId | null) => {
    const n = nodes.get(id);
    if (!n) return;
    numbers.set(id, num);
    order.push(id);
    const p = parent.get(id);
    const isPage = page === null || !p || nodes.get(p)?.file !== n.file;
    const pg = isPage ? id : page;
    if (isPage) pages.push(id);
    pageOf.set(id, pg as SectionId);
    n.children.forEach((c, i) => {
      walk(c, `${num}.${i + 1}`, pg);
    });
  };
  for (const r of roots) walk(r, r === "appendix" ? "A" : r.replace(/^s/, ""), null);
  const blockSection = new Map<BlockId, SectionId>();
  const stats = new Map<SectionId, SectionStats>();
  for (const [id, sec, , kind, verdict, , fresh, origin] of o.blocks) {
    blockSection.set(id, sec);
    let st = stats.get(sec);
    if (!st) {
      st = { blocks: 0, verified: 0, inferred: 0, stale: 0, unsupported: 0, authored: 0, static: 0 };
      stats.set(sec, st);
    }
    st.blocks++;
    if (kind !== "heading") {
      if (origin === "ai" || origin === "human") st.authored++;
      else if (origin === "static") st.static++;
    }
    countVerdict(st, verdict, fresh);
  }
  return { nodes, parent, roots, numbers, order, pageOf, pages, blockSection, stats };
}

function countVerdict(st: SectionStats, v: Verdict | null, fresh: Freshness): void {
  if (v === "verified" || v === "human-verified") st.verified++;
  else if (v === "inferred") st.inferred++;
  else if (v === "unsupported") st.unsupported++;
  if (v === "stale" || fresh === "stale") st.stale++;
}

/** Stats of a section and all its descendants. */
export function subtreeStats(ix: OutlineIndex, id: SectionId): SectionStats {
  const acc: SectionStats = { blocks: 0, verified: 0, inferred: 0, stale: 0, unsupported: 0, authored: 0, static: 0 };
  const visit = (s: SectionId) => {
    const st = ix.stats.get(s);
    if (st) {
      acc.blocks += st.blocks;
      acc.verified += st.verified;
      acc.inferred += st.inferred;
      acc.stale += st.stale;
      acc.unsupported += st.unsupported;
      acc.authored += st.authored;
      acc.static += st.static;
    }
    for (const c of ix.nodes.get(s)?.children ?? []) visit(c);
  };
  visit(id);
  return acc;
}

export type TocState = "generated" | "generating" | "pending" | "static" | "stale";

export function tocState(n: SectionNode, stats: SectionStats | undefined): TocState {
  if (stats && stats.stale > 0) return "stale";
  switch (n.state) {
    case "generating":
    case "partial":
      return "generating";
    case "pending":
      return "pending";
    case "static_only":
      return stats && (stats.authored > 0 || (stats.blocks > 0 && stats.static === 0)) ? "generated" : "static";
    default:
      return "generated";
  }
}

/** Sections drawn on one page: the page and its same-file descendants, in TOC order. */
export function pageSections(ix: OutlineIndex, page: SectionId): SectionId[] {
  return ix.order.filter((s) => ix.pageOf.get(s) === page);
}

export function readingMinutes(sec: number): number {
  return Math.max(1, Math.round(sec / 60));
}
