/**
 * WEB-U-026 SSE client (local fallback until `@mitori/client` ships `createSseClient`): frame parsing across chunk
 * boundaries, backoff bounds, hello → live, restart ⇒ resync, `rev` de-dupe, 401 ⇒ auth_expired, shutdown ⇒ stopped.
 */
import { describe, expect, test } from "bun:test";
import type { ConnectionState } from "@mitori/client";
import type { SseEvent } from "@mitori/core";
import { backoffMs, createLocalSseClient, SseParser } from "./sse.ts";

describe("SseParser", () => {
  test("frames split anywhere, CRLF, comments and multi-line data", () => {
    const got: [string | null, string][] = [];
    const p = new SseParser((id, data) => got.push([id, data]));
    const text = ': keep-alive\r\nid: 7\r\ndata: {"a":1}\r\n\r\nid: 8\ndata: line1\ndata: line2\n\n';
    for (const ch of text) p.push(ch);
    expect(got).toEqual([
      ["7", '{"a":1}'],
      ["8", "line1\nline2"],
    ]);
  });
});

describe("backoff", () => {
  test("0.5 s × 2ⁿ, cap 10 s, ±20 % jitter", () => {
    expect(backoffMs(0, 0.5)).toBe(500);
    expect(backoffMs(3, 0.5)).toBe(4000);
    expect(backoffMs(20, 0.5)).toBe(10_000);
    expect(backoffMs(0, 0)).toBe(400);
    expect(backoffMs(0, 1)).toBe(600);
  });
});

function streamOf(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

const frame = (seq: number, e: Record<string, unknown>) =>
  `id: ${seq}\ndata: ${JSON.stringify({ seq, at: "2026-10-03T00:00:00Z", ws: null, rev: null, ...e })}\n\n`;

function client(responses: (() => Response)[]) {
  const states: ConnectionState[] = [];
  const urls: string[] = [];
  let i = 0;
  const c = createLocalSseClient({
    base: "/api/v1",
    auth: { scheme: "session", token: () => "tok" },
    client: { kind: "web", version: "dev" },
    random: { bytes: (n) => new Uint8Array(n).fill(128) },
    clock: { now: () => 1 as never, iso: () => "2026-10-03T00:00:00Z" as never },
    onState: (s) => states.push(s),
    fetch: (async (url: string) => {
      urls.push(url);
      const r = responses[Math.min(i++, responses.length - 1)];
      return r ? r() : new Response(null, { status: 503 });
    }) as unknown as typeof fetch,
  });
  return { c, states, urls };
}

describe("createLocalSseClient", () => {
  test("hello ⇒ live; events reach handlers; a new boot id ⇒ resync; resume with ?last=", async () => {
    const hello = (seq: number, boot: string) => frame(seq, { type: "hello", boot, version: "dev", resumedFrom: seq > 1 ? seq - 1 : null });
    const { c, states, urls } = client([
      () => new Response(streamOf([hello(1, "b1"), frame(2, { type: "index.changed", ws: "ws_cr1t00000000", rev: 5 })])),
      () => new Response(streamOf([hello(3, "b2")])),
      () => new Response(null, { status: 503 }),
    ]);
    const seen: string[] = [];
    for (const t of ["hello", "index.changed", "resync"] as const) c.on(t, (e: SseEvent) => seen.push(e.type));
    c.connect("ws_cr1t00000000" as never);
    await Bun.sleep(20);
    expect(states.some((s) => s.kind === "live")).toBe(true);
    expect(c.rev("ws_cr1t00000000" as never)).toBe(5);
    // the stream ended ⇒ reconnect after the (jittered) backoff, resuming after seq 2
    await Bun.sleep(700);
    expect(urls[1]).toContain("last=2");
    expect(seen).toEqual(["hello", "index.changed", "hello", "resync"]);
    c.close();
  });

  test("connect() to another workspace replaces the stream: no second reconnect from the aborted one, no stale frames", async () => {
    const enc = new TextEncoder();
    const urls: string[] = [];
    const ctrls: ReadableStreamDefaultController<Uint8Array>[] = [];
    const states: string[] = [];
    const c = createLocalSseClient({
      base: "/api/v1",
      auth: { scheme: "session", token: () => "tok" },
      client: { kind: "web", version: "dev" },
      random: { bytes: (n) => new Uint8Array(n).fill(128) },
      clock: { now: () => 1 as never, iso: () => "2026-10-03T00:00:00Z" as never },
      onState: (st) => states.push(st.kind),
      fetch: (async (url: string, init?: RequestInit) => {
        urls.push(url);
        // a live stream that stays open until its request is aborted (like the daemon's)
        const body = new ReadableStream<Uint8Array>({
          start(ctl) {
            ctrls.push(ctl);
            ctl.enqueue(enc.encode(frame(urls.length, { type: "hello", boot: "b1", version: "dev", resumedFrom: null })));
            init?.signal?.addEventListener("abort", () => ctl.error(new DOMException("aborted", "AbortError")));
          },
        });
        return new Response(body);
      }) as unknown as typeof fetch,
    });
    const seen: string[] = [];
    c.on("index.changed", (e) => seen.push(e.ws ?? ""));
    c.connect("ws_aaaa00000000" as never);
    await Bun.sleep(20);
    c.connect("ws_bbbb00000000" as never);
    await Bun.sleep(20);
    // a frame arriving late on the superseded stream is ignored
    try {
      ctrls[0]?.enqueue(enc.encode(frame(9, { type: "index.changed", ws: "ws_aaaa00000000", rev: 1 })));
    } catch {
      /* already errored */
    }
    ctrls[1]?.enqueue(enc.encode(frame(10, { type: "index.changed", ws: "ws_bbbb00000000", rev: 1 })));
    await Bun.sleep(30);
    // the aborted stream must not schedule a reconnect (it would surface as `retrying` and open a 2nd live stream)
    expect(states).not.toContain("retrying");
    expect(urls.length).toBe(2);
    expect(urls[1]).toContain("ws=ws_bbbb00000000");
    expect(seen).toEqual(["ws_bbbb00000000"]);
    c.close();
  });

  test("entity rev de-dupe", () => {
    const { c } = client([]);
    c.noteRev("thread:th_1" as never, 4);
    expect(c.isStale("thread:th_1" as never, 4)).toBe(true);
    expect(c.isStale("thread:th_1" as never, 5)).toBe(false);
    expect(c.isStale("thread:th_2" as never, 1)).toBe(false);
  });

  test("401 ⇒ auth_expired; server.shutdown ⇒ stopped", async () => {
    const a = client([() => new Response(null, { status: 401 })]);
    a.c.connect(null);
    await Bun.sleep(20);
    expect(a.c.state.kind).toBe("auth_expired");
    a.c.close();
    const b = client([() => new Response(streamOf([frame(1, { type: "server.shutdown", reason: "user" })]))]);
    b.c.connect(null);
    await Bun.sleep(20);
    expect(b.c.state.kind).toBe("stopped");
    b.c.close();
  });
});
