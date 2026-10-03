/**
 * @mitori/doc — `codec/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Block, Cite, DocLang, Hasher, Xxh3 } from "@mitori/core";
import type { CiteLinkGroup, ClaimSpan, CodecContext, ParsedDocFile } from "../contract.ts";
import { markerize, unmarkerize } from "./cite.ts";
import { merge } from "./merge3.ts";
import { parseDoc, serializeDoc } from "./parse.ts";
import { toRomaji } from "./romaji.ts";
import { claimSpans } from "./spans.ts";

/** Parse a doc file: ID comments delimit blocks; wrappers (alerts, headings) are removed. */
export function parseDocFile(text: string, file: string, ctx: CodecContext): ParsedDocFile {
  return parseDoc(text, file, ctx);
}

/** Serialize blocks of one file deterministically (§10.2). Same input ⇒ same bytes. */
export function serializeDocFile(blocks: readonly Block[], ctx: CodecContext): string {
  return serializeDoc(blocks, ctx);
}

/**
 * Cite links → `[[k]]` markers (k by occurrence). Without a {@link CodecContext} the cite `path` is the href path
 * as written (relative to the doc file, percent-decoded); `parseDocFile` resolves it to a RepoPath.
 */
export function toMarkerForm(md: string, lang: DocLang): { md: string; links: CiteLinkGroup[] } {
  return markerize(md, lang);
}

/** `[[n]]` markers → cite links (W07 normalization applied first). Claims with 0 cites render `（推測）`. */
export function fromMarkerForm(markerMd: string, claims: readonly { n: number; cites: readonly Cite[] }[], ctx: CodecContext): string {
  return unmarkerize(markerMd, claims, ctx);
}

/** normalize = NFC, trailing whitespace per line removed, runs of blank lines collapsed, outer blank lines trimmed. */
function normalizeForHash(md: string): string {
  return md
    .normalize("NFC")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Semantic hash = xxh3(normalize(toMarkerForm(md))) — unchanged by line-number-only cite updates. */
export function semanticHash(md: string, lang: DocLang, hasher: Hasher): Xxh3 {
  return hasher.xxh3(normalizeForHash(markerize(md, lang).md));
}

/** Derive claim spans from marker-form md (§6.6). */
export function deriveClaimSpans(markerMd: string): ClaimSpan[] {
  return claimSpans(markerMd);
}

/** Canonical JSON (keys sorted by UTF-16 code unit, 2-space indent, LF, trailing newline). §10.8 */
export { canonicalJson } from "@mitori/core";

/** Hepburn romaji of a hiragana reading (`にんしょう` → `ninshou`). §5.6.9 */
export function yomiToRomaji(yomi: string): string {
  return toRomaji(yomi);
}

/** Sentence-level 3-way merge (§10.6). */
export function merge3(base: string, ours: string, theirs: string): { ok: true; md: string } | { ok: false; conflicts: number } {
  return merge(base, ours, theirs);
}
