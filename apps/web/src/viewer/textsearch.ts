/**
 * Full-text search over the exported document (⌘K, 「本文」 group): the app's own matcher (palette/fulltext.ts), over
 * the payload's sections — built lazily on the first query (a doc of 1,500 blocks ≈ 3 ms).
 */
export { buildTextIndex, htmlText, searchText, type TextEntry, type TextHit } from "../palette/fulltext.ts";
