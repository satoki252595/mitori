/**
 * @mitori/indexer — `lang/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */

/**
 * Tags queries per grammar, byte-identical to the spec `.scm` [CR m1-30]. The server's `ParseWorkerInit.queries` may
 * stay `{}` (the Worker falls back to this embedded text, so the Worker's and the main thread's ExtractorVersion
 * stay equal).
 */
export { TAGS_QUERIES } from "./queries.ts";
