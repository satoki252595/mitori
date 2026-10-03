/**
 * @mitori/anchor — `engine/` (owner: WP-07). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Hasher } from "@mitori/core";
import type { AnchorEngine } from "../contract.ts";
import { buildLineMap } from "../linemap/linemap.ts";
import { splitLines } from "../normalize/index.ts";
import { captureCode, captureDoc, verifyQuote } from "./capture.ts";
import { reanchorDiagramMember, reanchorDocMember } from "./doc.ts";
import { overlaps } from "./overlap.ts";
import { findQuote } from "./quote.ts";
import { reanchorItems } from "./reanchor.ts";

/** Factory (pure; core-only dependency). */
export function createAnchorEngine(deps: { hasher: Hasher }): AnchorEngine {
  const { hasher } = deps;
  const now = () => performance.now();
  return {
    codeAnchor: (path, start, end, text, blob, symbol, charRange) => captureCode(hasher, path, start, end, text, blob, symbol, charRange),
    docAnchor: (block, blockText, blockHash, selStart, selEnd, claims) => captureDoc(block, blockText, blockHash, selStart, selEnd, claims),
    verifyDocQuote: verifyQuote,
    lineMap: (oldText, newText) => buildLineMap(splitLines(oldText), splitLines(newText)),
    reanchor: (items, delta, ctx) => reanchorItems(hasher, items, delta, ctx, now),
    reanchorDoc: reanchorDocMember,
    reanchorDiagram: reanchorDiagramMember,
    findQuote,
    overlaps,
  };
}
