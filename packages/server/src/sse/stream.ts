/**
 * `GET /events` as a `fetch()` stream (ADR-0009 R1: EventSource cannot send `authorization`). First bytes `:\n\n`,
 * then the hub's `hello` (+ replay or `resync`), live events and `: hb`. A connection whose unsent bytes exceed
 * 1 MiB is closed (the client reconnects with `?last=<seq>`); cancel/abort detaches it so nothing is left behind.
 */
import type { ClientKind, WorkspaceKey } from "@mitori/core";
import type { EndableConnection, SseHubImpl } from "./hub.ts";
import { encodeComment, encodeEvent, OPEN_BYTES } from "./wire.ts";

/** Backpressure limit per connection. */
export const SSE_MAX_BUFFERED_BYTES = 1024 * 1024;

export interface SseStreamOptions {
  hub: SseHubImpl;
  ws: WorkspaceKey | null;
  client: ClientKind;
  /** `?last=<seq>`. */
  last: number | null;
  /** Remembered boot (null when the transport does not carry it). */
  boot: string | null;
  /** Request signal (client went away). */
  signal: AbortSignal;
  /** Default {@link SSE_MAX_BUFFERED_BYTES}. */
  maxBufferedBytes?: number;
  /** Extra response headers (security headers are added by the HTTP layer). */
  headers?: Record<string, string>;
}

/** A live SSE connection backed by a ReadableStream controller. */
export function sseResponse(opts: SseStreamOptions): Response {
  const max = opts.maxBufferedBytes ?? SSE_MAX_BUFFERED_BYTES;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const close = () => {
    if (conn.closed) return;
    conn.closed = true;
    opts.hub.detach(conn);
    try {
      ctrl?.close();
    } catch {
      // already closed/errored
    }
  };
  const write = (bytes: Uint8Array) => {
    if (conn.closed || !ctrl) return;
    ctrl.enqueue(bytes);
    if ((ctrl.desiredSize ?? 0) < 0) close();
  };
  const conn: EndableConnection = {
    ws: opts.ws,
    client: opts.client,
    closed: false,
    send: (e) => write(encodeEvent(e)),
    comment: (text) => write(encodeComment(text)),
    end: () => close(),
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        ctrl = controller;
        controller.enqueue(OPEN_BYTES);
        if (opts.signal.aborted) {
          close();
          return;
        }
        opts.signal.addEventListener("abort", close, { once: true });
        opts.hub.attach(conn, opts.last, opts.boot);
      },
      cancel: close,
    },
    { highWaterMark: max, size: (chunk) => chunk?.byteLength ?? 0 },
  );
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      ...opts.headers,
    },
  });
}
