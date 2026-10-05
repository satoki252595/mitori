/**
 * Compute Worker entry (ARCHITECTURE §2.4, PT-16): Shiki highlighting for the doc renderer (`HighlightReq → html`)
 * with the per-blob line cache of `@mitori/doc`'s `createHighlight`. Init carries the embedded `onig.wasm` bytes.
 */
import { canonicalJson, type DiagramIR, type DiagramLayout } from "@mitori/core";
import { createHighlight, type DiagramLayouter, floorplanLayout, floorplanQuality, type HighlightReq } from "@mitori/doc";
import { createHasher } from "@mitori/platform";
import { serveInitWorker } from "./protocol.ts";

type FloorReq = { type: "floorplan"; ir: DiagramIR; prev: DiagramLayout | null };
serveInitWorker<{ onig: Uint8Array }, HighlightReq | FloorReq, string | Awaited<ReturnType<DiagramLayouter["layoutFloorplan"]>>>(async (init) => {
  const highlight = await createHighlight(init.onig);
  const hasher = createHasher();
  return (req) => {
    if ("type" in req && req.type === "floorplan") {
      const start = performance.now();
      const layout = floorplanLayout(req.ir, hasher.xxh3(canonicalJson({ ...req.ir, id: null })), req.prev);
      return { layout, quality: floorplanQuality(req.ir, layout, performance.now() - start) };
    }
    return highlight(req as HighlightReq);
  };
});
