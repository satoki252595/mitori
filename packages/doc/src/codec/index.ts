/**
 * @mitori/doc — `codec/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Block, type Cite, type DocLang, type Hasher, unsupported, type Xxh3 } from "@mitori/core";
import type { CiteLinkGroup, ClaimSpan, CodecContext, ParsedDocFile } from "../contract.ts";

/** Parse a doc file: ID comments delimit blocks; wrappers (alerts, headings) are removed. */
export function parseDocFile(text: string, file: string, ctx: CodecContext): ParsedDocFile {
  return unsupported("doc.parseDocFile", text, file, ctx);
}

/** Serialize blocks of one file deterministically (§10.2). Same input ⇒ same bytes. */
export function serializeDocFile(blocks: readonly Block[], ctx: CodecContext): string {
  return unsupported("doc.serializeDocFile", blocks, ctx);
}

/** Cite links → `[[k]]` markers (k by occurrence). */
export function toMarkerForm(md: string, lang: DocLang): { md: string; links: CiteLinkGroup[] } {
  return unsupported("doc.toMarkerForm", md, lang);
}

/** `[[n]]` markers → cite links (W07 normalization applied first). Claims with 0 cites render `（推測）`. */
export function fromMarkerForm(markerMd: string, claims: readonly { n: number; cites: readonly Cite[] }[], ctx: CodecContext): string {
  return unsupported("doc.fromMarkerForm", markerMd, claims, ctx);
}

/** Semantic hash = xxh3(normalize(toMarkerForm(md))) — unchanged by line-number-only cite updates. */
export function semanticHash(md: string, lang: DocLang, hasher: Hasher): Xxh3 {
  return unsupported("doc.semanticHash", md, lang, hasher);
}

/** Derive claim spans from marker-form md (§6.6). */
export function deriveClaimSpans(markerMd: string): ClaimSpan[] {
  return unsupported("doc.deriveClaimSpans", markerMd);
}

/** Canonical JSON (keys sorted by UTF-16 code unit, 2-space indent, LF, trailing newline). §10.8 */
export { canonicalJson } from "@mitori/core";

/** Hepburn romaji of a hiragana reading (`にんしょう` → `ninshou`). §5.6.9 */
export function yomiToRomaji(yomi: string): string {
  return unsupported("doc.yomiToRomaji", yomi);
}

/** Sentence-level 3-way merge (§10.6). */
export function merge3(base: string, ours: string, theirs: string): { ok: true; md: string } | { ok: false; conflicts: number } {
  return unsupported("doc.merge3", base, ours, theirs);
}
