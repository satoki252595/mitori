import type { ViewerPayload } from "../contract.ts";

/**
 * Decode the `<script id="mitori-export">` body the way the exporter wrote it: no `data-encoding` (the
 * plain-JSON embedding) is parsed as JSON, anything else is gunzipped. Rejects when the body is damaged,
 * so the caller can show the failure text instead of a blank page.
 */
export async function decodeExportPayload(raw: string, encoding: string | undefined): Promise<ViewerPayload> {
  if (!encoding) return JSON.parse(raw) as ViewerPayload;
  const gunzipped = new Blob([Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(gunzipped).json()) as ViewerPayload;
}
