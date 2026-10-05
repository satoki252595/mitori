/**
 * DOM side of doc anchors (ux.md §6.1): walk a block's `.mb` text nodes per ANCHOR_TEXT_RULES (skipping
 * `.mcite`, `[data-mx]` and code gutters), turn a selection Range / a claim span / the whole block into the
 * `AnchorInput` offsets of the normalized block text, and clip a multi-block selection to its first block.
 */
import type { AnchorInput, BlockId } from "@mitori/core";
import { CLIENT_ANCHOR_TEXT, displayQuote, normalize, normalizedRange, quoteOf } from "./anchor-text.ts";

const EXCLUDE = [...CLIENT_ANCHOR_TEXT.excludeSelectors, CLIENT_ANCHOR_TEXT.codeGutterSelector].join(",");

interface Walked {
  raw: string;
  nodes: { node: Text; at: number }[];
}

/** Text nodes of a block body in document order with their raw offsets (code lines keep their own `\n` nodes). */
export function walkBlock(mb: Element): Walked {
  const walker = mb.ownerDocument.createTreeWalker(mb, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const ex = n.parentElement?.closest(EXCLUDE);
      return ex && mb.contains(ex) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Walked["nodes"] = [];
  let raw = "";
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, at: raw.length });
    raw += n.data;
  }
  return { raw, nodes };
}

/** Raw offset of a Range boundary inside the walked text (points inside excluded nodes snap forward). */
function rawOffset(w: Walked, container: Node, offset: number, range: Range, edge: "start" | "end"): number {
  for (const { node, at } of w.nodes) if (node === container) return at + Math.min(offset, node.data.length);
  if (edge === "start") {
    for (const { node, at } of w.nodes) if (range.comparePoint(node, 0) >= 0) return at;
    return w.raw.length;
  }
  let best = 0;
  for (const { node, at } of w.nodes) if (range.comparePoint(node, node.data.length) <= 0) best = at + node.data.length;
  return best;
}

export interface BlockAnchor {
  block: BlockId;
  anchor: AnchorInput;
  text: string;
  quote: { before: string; mark: string; after: string };
  fileLine: string | null;
  start: number;
  end: number;
  wholeBlock: boolean;
}

function fileLineOf(scope: Element | null): string | null {
  const cs = scope?.querySelector("a.mcite .cs");
  return cs?.textContent?.trim() || null;
}

/** The text unit a selection belongs to: a table cell, a list item, a paragraph / heading (else the whole block). */
const SEGMENT = "td,th,li,dt,dd,caption,figcaption,p,h1,h2,h3,h4,h5,h6,blockquote,pre";

/** Normalized [start, end) of `el`'s text inside the walked block (null when it has no text node of its own). */
function segmentBounds(w: Walked, n: ReturnType<typeof normalize>, el: Element): { start: number; end: number; cell: boolean } | null {
  const inside = w.nodes.filter(({ node }) => el.contains(node));
  const first = inside[0];
  const last = inside[inside.length - 1];
  if (!first || !last) return null;
  const r = normalizedRange(n, first.at, last.at + last.node.data.length);
  return { ...r, cell: el.matches("td,th") };
}

function build(
  block: BlockId,
  mb: Element,
  w: Walked,
  rawStart: number,
  rawEnd: number,
  scope: Element | null,
  wholeBlock: boolean,
  segment: Element | null = null,
): BlockAnchor {
  const n = normalize(w.raw);
  const r = normalizedRange(n, rawStart, rawEnd);
  const q = quoteOf(n.text, r.start, r.end);
  const bounds = segment ? segmentBounds(w, n, segment) : null;
  // the file:line of the header: the claim's cite, else the first cite of the selection's row / item, else the block's
  const row = segment?.closest("tr,li,p") ?? null;
  return {
    block,
    anchor: { primary: "doc", doc: { block, selStart: q.start, selEnd: q.end, quote: q.quote } },
    text: n.text,
    quote: displayQuote(n.text, q.start, q.end, 18, bounds ?? undefined),
    fileLine: fileLineOf(scope) ?? fileLineOf(row) ?? fileLineOf(mb),
    start: q.start,
    end: q.end,
    wholeBlock,
  };
}

/** Block element of a node (`.blk[data-b]`) and its server body (`.mb`). */
export function blockOf(node: Node | null): { blk: HTMLElement; mb: HTMLElement; id: BlockId } | null {
  const el = (node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement)?.closest<HTMLElement>(".blk[data-b]");
  const mb = el?.querySelector<HTMLElement>(":scope > .mb") ?? el?.querySelector<HTMLElement>(".mb") ?? null;
  if (!el || !mb) return null;
  return { blk: el, mb, id: el.dataset.b as BlockId };
}

/** Selection → anchor, clipped to the FIRST block (`clipped` tells the toolbar to say 「1 ブロック内に限ります」). */
export function anchorFromRange(range: Range): (BlockAnchor & { clipped: boolean; range: Range }) | null {
  const b = blockOf(range.startContainer);
  if (!b) return null;
  let r = range;
  let clipped = false;
  if (!b.mb.contains(range.endContainer)) {
    r = range.cloneRange();
    r.setEnd(b.mb, b.mb.childNodes.length);
    clipped = true;
  }
  const w = walkBlock(b.mb);
  const s = rawOffset(w, r.startContainer, r.startOffset, r, "start");
  const e = rawOffset(w, r.endContainer, r.endOffset, r, "end");
  if (e <= s) return null;
  const common = r.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement;
  const scope = common?.closest(".mc") ?? null;
  const seg = common?.closest(SEGMENT) ?? null;
  const segment = seg && b.mb.contains(seg) ? seg : null;
  return { ...build(b.id, b.mb, w, s, e, scope, false, segment), clipped, range: r };
}

/** Whole block (focused block) or one claim span (claim cursor / claim popover). */
export function anchorFromBlock(blk: HTMLElement, claim: string | null): BlockAnchor | null {
  const b = blockOf(blk);
  if (!b) return null;
  const w = walkBlock(b.mb);
  if (claim) {
    const el = b.mb.querySelector(`.mc[data-claim="${CSS.escape(claim)}"]`);
    if (el) {
      const inside = w.nodes.filter(({ node }) => el.contains(node));
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (first && last) return build(b.id, b.mb, w, first.at, last.at + last.node.data.length, el, true);
    }
  }
  return build(b.id, b.mb, w, 0, w.raw.length, null, true);
}

/** Range of a normalized [start, end) inside a block (repaint `::highlight(mitori-sel)` after re-render). */
export function rangeOf(mb: Element, start: number, end: number): Range | null {
  const w = walkBlock(mb);
  const n = normalize(w.raw);
  const doc = mb.ownerDocument;
  // Adjacent cells can share a normalized boundary. Start belongs to the following node; end to the preceding one.
  const toPoint = (pos: number, edge: "start" | "end"): { node: Text; offset: number } | null => {
    for (const { node, at } of w.nodes) {
      const last = n.map[at + node.data.length] ?? -1;
      if (last < pos || (edge === "start" && last === pos)) continue;
      for (let k = 0; k <= node.data.length; k++) if ((n.map[at + k] ?? -1) >= pos) return { node, offset: k };
    }
    const last = w.nodes[w.nodes.length - 1];
    return last ? { node: last.node, offset: last.node.data.length } : null;
  };
  const a = toPoint(start, "start");
  const z = toPoint(end, "end");
  if (!a || !z) return null;
  const r = doc.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  return r;
}
