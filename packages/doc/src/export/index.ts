/**
 * @mitori/doc — `export/` (owner: WP-13). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Clock, SecretScanner, Sha256 } from "@mitori/core";
import type { BlockRenderer, DiagramLayouter, DocStore, HtmlExporter } from "../contract.ts";
import { bytesToBase64, checkViewerAssets, jsonForScript, type PayloadEncoding, renderPage } from "./html.ts";
import { buildPayload } from "./payload.ts";
import { sha256Hex, utf8 } from "./sha256.ts";
import type { ExportSource } from "./source.ts";

export { blockDiagramIr, withDiagramSvg } from "./inline.ts";

/**
 * Exporter factory [CONS-26]. `viewerAssets` are embedded by the CLI build (doc cannot import apps/web).
 *
 * `source` (optional) is the code side the doc package cannot reach: file text for the static cite peeks and the
 * map's module list. Without it an export has no code excerpts (cites show `path:line` only).
 * CR-PENDING(WP-13): `source` is not in the frozen deps; see docs/design/cr-requests/WP-13.md.
 */
export function createHtmlExporter(deps: {
  doc: DocStore;
  renderer: BlockRenderer;
  layouter: DiagramLayouter;
  secrets: SecretScanner;
  viewerAssets: { js: string; css: string; jsSha256: Sha256 };
  clock: Clock;
  source?: ExportSource;
  /**
   * Gzip compressor for the embedded payload (injected: doc has no platform port for it). Absent = plain-JSON
   * embedding (tests only; the daemon always passes one).
   */
  gzip?: (data: Uint8Array) => Uint8Array;
}): HtmlExporter {
  return {
    async export(req) {
      checkViewerAssets(deps.viewerAssets);
      const built = await buildPayload(
        { doc: deps.doc, renderer: deps.renderer, layouter: deps.layouter, secrets: deps.secrets, source: deps.source, now: deps.clock.iso() },
        req,
      );
      const { payload } = built;
      // the payload is gzip+base64: base64's alphabet cannot contain `</script` or `<!--`, so no JSON escaping
      // is needed on top; without a compressor it stays `jsonForScript`-escaped plain JSON as before
      let json: string;
      let encoding: PayloadEncoding;
      if (deps.gzip) {
        json = bytesToBase64(deps.gzip(utf8(JSON.stringify(payload))));
        encoding = "gzip+base64";
      } else {
        json = jsonForScript(payload);
        encoding = "json";
      }
      const html = renderPage({
        title: payload.outline.manifest.title,
        lang: req.lang,
        level: req.level,
        css: deps.viewerAssets.css,
        js: deps.viewerAssets.js,
        jsSha256: deps.viewerAssets.jsSha256,
        json,
        encoding,
      });
      const bytes = utf8(html);
      return { html, bytes: bytes.length, sha256: sha256Hex(bytes), redactions: built.redactions, codeExcerpts: built.codeExcerpts };
    },
  };
}

export type { ExportPayload } from "./payload.ts";
export type { ExportFile, ExportSource } from "./source.ts";
