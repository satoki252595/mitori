/**
 * @mitori/doc — `export/` (owner: WP-13). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Clock, type SecretScanner, type Sha256, unsupported } from "@mitori/core";
import type { BlockRenderer, DiagramLayouter, DocStore, HtmlExporter } from "../contract.ts";

/** Exporter factory [CONS-26]. `viewerAssets` are embedded by the CLI build (doc cannot import apps/web). */
export function createHtmlExporter(deps: {
  doc: DocStore;
  renderer: BlockRenderer;
  layouter: DiagramLayouter;
  secrets: SecretScanner;
  viewerAssets: { js: string; css: string; jsSha256: Sha256 };
  clock: Clock;
}): HtmlExporter {
  return unsupported("doc.createHtmlExporter", deps);
}
