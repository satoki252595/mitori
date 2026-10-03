import type { Anchor, BlockId, Cite, ClaimId, LineNo, RepoPath } from "@mitori/core";

/** A line range in one file (1-based, inclusive). */
export interface CodeRange {
  path: RepoPath;
  start: LineNo;
  end: LineNo;
}

/** Where a doc anchor's cites come from (the doc store, behind a function so the router stays pure). */
export interface CiteSource {
  citesOfBlock(block: BlockId): Cite[];
  citesOfClaim(claim: ClaimId): Cite[];
}

/**
 * The code ranges one anchor points at (spec §3.2 step 1). Code-primary: the code member. Doc-primary: all cites
 * of the claim, else of the block's claims. Diagram-primary: the code member when the server derived one
 * (CR-PENDING(WP-08a): the contract gives the router no diagram-node resolver, so node refs are not followed here).
 */
export function anchorRanges(anchor: Anchor, src: CiteSource): CodeRange[] {
  if (anchor.primary === "doc" && anchor.doc) {
    const cites = anchor.doc.claim !== undefined ? src.citesOfClaim(anchor.doc.claim) : src.citesOfBlock(anchor.doc.block);
    return cites.map((c) => ({ path: c.path, start: c.start, end: c.end }));
  }
  if (anchor.code) return [{ path: anchor.code.path, start: anchor.code.start, end: anchor.code.end }];
  return [];
}

/** Merge overlapping or adjacent ranges per path; result sorted by path, then start. */
export function mergeRanges(ranges: readonly CodeRange[]): CodeRange[] {
  const sorted = ranges
    .filter((r) => r.start >= 1 && r.end >= r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start || a.end - b.end));
  const out: CodeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.path === r.path && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Total lines of already merged ranges. */
export function lineCount(ranges: readonly CodeRange[]): number {
  let n = 0;
  for (const r of ranges) n += r.end - r.start + 1;
  return n;
}
