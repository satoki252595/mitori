/** Doc-member (D1–D4) and diagram-member re-anchoring (loop spec §1.6). */
import type { DiagramAnchor, DiagramRef, DocAnchor, ReanchorResult } from "@mitori/core";
import { ANCHOR_LIMITS, type DiagramReanchorInput, type DocReanchorInput } from "../contract.ts";
import { normLine } from "../normalize/index.ts";
import { bindClaim, isWholeBlock } from "./capture.ts";
import { findQuote } from "./quote.ts";

const CTX = ANCHOR_LIMITS.quoteContextChars;

function rehome(
  prev: DocAnchor,
  block: DocAnchor["block"],
  hash: string,
  text: string,
  start: number,
  end: number,
  claims: DocReanchorInput["claims"],
): DocAnchor {
  const out: DocAnchor = {
    block,
    blockHash: hash,
    quote: { prefix: text.slice(Math.max(0, start - CTX), start), exact: text.slice(start, end), suffix: text.slice(end, end + CTX) },
    offset: start,
  };
  const claim = block === prev.block ? bindClaim(start, end, claims) : undefined;
  if (claim !== undefined) out.claim = claim;
  return out;
}

/** D1–D4. Never throws; failures keep the previous anchor as `outdated`. */
export function reanchorDocMember(input: DocReanchorInput): ReanchorResult<DocAnchor> {
  const prev = input.anchor;
  const outdated: ReanchorResult<DocAnchor> = { health: "outdated", method: "none", anchor: prev, previous: prev, confidence: 0 };
  if (input.blockText !== null && input.blockHash !== null) {
    // D1: unchanged block.
    if (input.blockHash === prev.blockHash) return { health: "ok", method: "identity", anchor: prev, previous: prev, confidence: 1 };
    // D2: whole-block anchors follow the block whatever its text (a claim it was bound to may have left the block).
    if (isWholeBlock(prev)) {
      const anchor: DocAnchor = { ...prev, blockHash: input.blockHash };
      if (anchor.claim !== undefined && !input.claims.some((c) => c.id === anchor.claim)) delete anchor.claim;
      return { health: "ok", method: "identity", anchor, previous: prev, confidence: 1 };
    }
    // D3: quote inside the same block.
    const m = findQuote(input.blockText, prev.quote as NonNullable<DocAnchor["quote"]>, prev.offset);
    if (m && m.score >= ANCHOR_LIMITS.quoteAcceptSim) {
      const anchor = rehome(prev, prev.block, input.blockHash, input.blockText, m.start, m.end, input.claims);
      if (m.score >= ANCHOR_LIMITS.quoteMovedScore) {
        return { health: m.start === prev.offset ? "ok" : "moved", method: "quote", anchor, previous: prev, confidence: m.score };
      }
      return { health: "fuzzy", method: "quote", anchor, previous: prev, confidence: m.score };
    }
  }
  // D4: the block is gone (or the quote left it) — look in the section's other blocks.
  if (isWholeBlock(prev)) return outdated;
  let best: { sib: DocReanchorInput["siblings"][number]; start: number; end: number; score: number } | null = null;
  for (const sib of input.siblings) {
    if (sib.block === prev.block) continue;
    const m = findQuote(sib.text, prev.quote as NonNullable<DocAnchor["quote"]>);
    if (m && m.score >= ANCHOR_LIMITS.docSiblingMinScore && (!best || m.score > best.score)) best = { sib, ...m };
  }
  if (!best) return outdated;
  return {
    health: "moved",
    method: "quote",
    anchor: rehome(prev, best.sib.block, best.sib.hash, best.sib.text, best.start, best.end, []),
    previous: prev,
    confidence: best.score,
  };
}

const REF_KEYS = ["section", "block", "module", "symbol", "path"] as const satisfies readonly (keyof DiagramRef)[];

/** Same non-empty ref. */
function sameRef(a: DiagramRef | undefined, b: DiagramRef | undefined): boolean {
  if (!a || !b) return false;
  let any = false;
  for (const k of REF_KEYS) {
    if (a[k] !== b[k]) return false;
    if (a[k] !== undefined) any = true;
  }
  return any;
}

/** Diagram member (§1.6.2): id → ref → exact label → normalized label; one match ⇒ moved, several ⇒ fuzzy. */
export function reanchorDiagramMember(input: DiagramReanchorInput): ReanchorResult<DiagramAnchor> {
  const prev = input.anchor;
  const outdated: ReanchorResult<DiagramAnchor> = { health: "outdated", method: "none", anchor: prev, previous: prev, confidence: 0 };
  const nodes = input.nodes;
  if (nodes === null) return outdated;
  const ok: ReanchorResult<DiagramAnchor> = { health: "ok", method: "identity", anchor: prev, previous: prev, confidence: 1 };
  if (prev.edge !== undefined) return input.edges.includes(prev.edge) ? ok : outdated;
  if (prev.node === undefined || nodes.some((n) => n.id === prev.node)) return ok;
  const { ref, label } = input.snapshot;
  const tiers: [DiagramReanchorInput["nodes"] & object, "symbol" | "quote"][] = [
    [nodes.filter((n) => sameRef(n.ref, ref)), "symbol"],
    [label === undefined ? [] : nodes.filter((n) => n.label === label), "quote"],
    [label === undefined ? [] : nodes.filter((n) => normLine(n.label) === normLine(label)), "quote"],
  ];
  for (const [found, method] of tiers) {
    const first = found[0];
    if (!first) continue;
    const anchor: DiagramAnchor = { ...prev, node: first.id };
    return found.length === 1
      ? { health: "moved", method, anchor, previous: prev, confidence: 1 }
      : { health: "fuzzy", method, anchor, previous: prev, confidence: 1 / found.length };
  }
  return outdated;
}
