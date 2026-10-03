/**
 * Compute Worker entry (ARCHITECTURE §2.4, PT-16): Shiki highlighting for the doc renderer (`HighlightReq → html`)
 * with the per-blob line cache of `@mitori/doc`'s `createHighlight`. Init carries the embedded `onig.wasm` bytes.
 */
import { createHighlight, type HighlightReq } from "@mitori/doc";
import { serveInitWorker } from "./protocol.ts";

serveInitWorker<{ onig: Uint8Array }, HighlightReq, string>(async (init) => createHighlight(init.onig));
