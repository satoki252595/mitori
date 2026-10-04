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
  /**
   * EX-03: the claims a partial selection `[start, end)` of the block's text touches — null when the selection is
   * (nearly) the whole block, or when no claim touches it but some claim could not be located in the text. Absent ⇒
   * the block-wide rule.
   */
  claimsTouching?(block: BlockId, start: number, end: number): ClaimId[] | null;
}

/** A selection this wide (share of the block text) anchors the block, not one sentence. */
const WHOLE_BLOCK_SHARE = 0.9;

/**
 * {@link CiteSource.claimsTouching} over a block's rendered text and its claims (a claim's span = the first occurrence
 * of its quote, as at capture). Pure.
 */
export function touchingClaims(text: string, claims: readonly { id: ClaimId; quote: string }[], start: number, end: number): ClaimId[] | null {
  if (end <= start || end - start >= text.length * WHOLE_BLOCK_SHARE) return null;
  const hit: ClaimId[] = [];
  let unknown = false;
  for (const c of claims) {
    const at = c.quote === "" ? -1 : text.indexOf(c.quote);
    if (at < 0) {
      unknown = true;
      continue;
    }
    if (at < end && at + c.quote.length > start) hit.push(c.id);
  }
  return hit.length === 0 && unknown ? null : hit;
}

/** The selected span of a doc anchor (offset + quote), or null for a whole-block / truncated anchor. */
function selectionOf(doc: NonNullable<Anchor["doc"]>): { start: number; end: number } | null {
  const exact = doc.quote?.exact ?? "";
  if (exact.length === 0 || doc.offset === undefined) return null;
  return { start: doc.offset, end: doc.offset + exact.length };
}

/**
 * The code ranges one anchor points at (spec §3.2 step 1). Code-primary: the code member. Doc-primary: the cites of
 * the bound claim; else of the claims the selected text touches — an uncited sentence borrows NO cites of the block's
 * other sentences (EX-03: a question about `checkSecFetchSite` was sent `NewServer`, 102 unrelated lines); a whole
 * block takes all its cites. Diagram-primary: the code member when the server derived one
 * (CR-PENDING(WP-08a): the contract gives the router no diagram-node resolver, so node refs are not followed here).
 */
export function anchorRanges(anchor: Anchor, src: CiteSource): CodeRange[] {
  if (anchor.primary === "doc" && anchor.doc) {
    const d = anchor.doc;
    let cites: Cite[];
    if (d.claim !== undefined) cites = src.citesOfClaim(d.claim);
    else {
      const sel = selectionOf(d);
      const touched = sel && src.claimsTouching ? src.claimsTouching(d.block, sel.start, sel.end) : null;
      cites = touched === null ? src.citesOfBlock(d.block) : touched.flatMap((c) => src.citesOfClaim(c));
    }
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
