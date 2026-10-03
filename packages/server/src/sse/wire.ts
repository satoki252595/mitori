/**
 * SSE wire format (api §10, ADR-0009 R1): `id: <seq>\n` + `data: <json>\n\n`, no `event:` line; comments `: hb`.
 * One event is serialized once and the same bytes are written to every connection.
 */
import type { SseEvent } from "@mitori/core";

const enc = new TextEncoder();
const cache = new WeakMap<SseEvent, Uint8Array>();

/** First bytes of every stream (Safari flushes the response head only after a body chunk). */
export const OPEN_BYTES: Uint8Array = enc.encode(":\n\n");

/** `id:` + `data:` frame (memoized per event object). */
export function encodeEvent(e: SseEvent): Uint8Array {
  let bytes = cache.get(e);
  if (!bytes) {
    bytes = enc.encode(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    cache.set(e, bytes);
  }
  return bytes;
}

/** Comment frame (`: hb`). */
export function encodeComment(text: string): Uint8Array {
  return enc.encode(`: ${text.replace(/[\r\n]/g, " ")}\n\n`);
}
