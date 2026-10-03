import { afterEach, describe, expect, test } from "bun:test";
import type { Clock, Random, SseEvent, SseEventPayload, WorkspaceKey } from "@mitori/core";
import type { ConnectionState, SseClient } from "../contract.ts";
import { BACKOFF_CAP_MS, backoffDelay } from "./backoff.ts";
import { createSseClient } from "./index.ts";
import { createFrameParser } from "./parse.ts";

const WS = "ws_cccccccccccc" as WorkspaceKey;
const enc = new TextEncoder();
const clock: Clock = { now: () => Date.now(), iso: () => new Date().toISOString() };
const random: Random = { bytes: (n) => new Uint8Array(n).fill(0x80) };

/** Minimal daemon `/events` endpoint: hello, replay from `last`, resync on demand, live events. */
function fakeDaemon(opts: { port?: number; boot: string; version?: string; resyncOnRestart?: boolean; token?: string }) {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const history: SseEvent[] = [];
  const requests: { last: string | null; ws: string | null; auth: string | null }[] = [];
  let seq = 1000;
  const frame = (e: SseEvent) => enc.encode(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
  const stamp = (p: SseEventPayload, ws: WorkspaceKey | null, rev: number | null, s: number) => ({ ...p, seq: s, ws, rev, at: clock.iso() }) as SseEvent;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      requests.push({ last: url.searchParams.get("last"), ws: url.searchParams.get("ws"), auth });
      if (auth !== `Mitori-Session ${opts.token ?? "good"}`)
        return Response.json({ error: { code: "E_AUTH_REQUIRED", message: "no", retryable: false } }, { status: 401 });
      const lastRaw = url.searchParams.get("last");
      const last = lastRaw === null ? null : Number(lastRaw);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(":\n\n"));
          const known = last !== null && history.some((e) => e.seq === last);
          const resumed = last !== null && (known || last === seq) ? last : null;
          c.enqueue(
            frame(stamp({ type: "hello", version: opts.version ?? "1.0.0", apiVersion: 1, resumedFrom: resumed, boot: opts.boot }, null, null, resumed ?? seq)),
          );
          if (last !== null && resumed === null && opts.resyncOnRestart) c.enqueue(frame(stamp({ type: "resync", reason: "restart" }, null, null, seq)));
          if (resumed !== null) for (const e of history) if (e.seq > resumed) c.enqueue(frame(e));
          streams.add(c);
        },
        cancel() {},
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    port: server.port as number,
    requests,
    emit(p: SseEventPayload, ws: WorkspaceKey | null = WS, rev: number | null = null) {
      seq += 1;
      const e = stamp(p, ws, rev, seq);
      history.push(e);
      for (const c of streams) c.enqueue(frame(e));
      return e;
    },
    /** Drop every live stream (network blip); history stays for replay. */
    drop() {
      for (const c of streams) c.close();
      streams.clear();
    },
    async stop() {
      for (const c of streams) {
        try {
          c.close();
        } catch {
          // closed
        }
      }
      streams.clear();
      await server.stop(true);
    },
  };
}

const open: { stop(): Promise<void> }[] = [];
const clients: SseClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const d of open.splice(0)) await d.stop();
});

function client(port: number, opts: { token?: string; version?: string } = {}) {
  const states: ConnectionState[] = [];
  const c = createSseClient({
    base: `http://127.0.0.1:${port}/api/v1`,
    auth: { scheme: "session", token: () => opts.token ?? "good" },
    client: { kind: "web", version: opts.version ?? "1.0.0" },
    random,
    clock,
    onState: (s) => states.push(s),
  });
  clients.push(c);
  return { c, states };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) throw new Error("timed out");
    await Bun.sleep(5);
  }
};

const upsert = (id: string): SseEventPayload => ({ type: "thread.upsert", thread: { id } as never });

describe("SSE client (CR m0-10)", () => {
  test("hello ⇒ live; events dispatched by type; seq and rev tracked; unsubscribe works", async () => {
    const d = fakeDaemon({ boot: "boot-a" });
    open.push(d);
    const { c, states } = client(d.port);
    const seen: string[] = [];
    const off = c.on("thread.removed", (e) => void seen.push(e.id));
    c.connect(WS);
    await until(() => c.state.kind === "live");
    expect(states[0]?.kind).toBe("connecting");
    expect(d.requests[0]).toEqual({ last: null, ws: WS, auth: "Mitori-Session good" });
    d.emit({ type: "thread.removed", id: "th_1" }, WS, 3);
    d.emit({ type: "brand.new.type" } as unknown as SseEventPayload, WS, 3);
    await until(() => seen.length === 1);
    expect(c.rev(WS)).toBe(3);
    off();
    const e = d.emit({ type: "thread.removed", id: "th_2" }, WS, 4);
    await until(() => c.seq() === e.seq);
    expect(seen).toEqual(["th_1"]);
  });

  test("dedupe: x-mitori-rev noted ⇒ the SSE echo at that rev is dropped; later revs and same-rev SSE pairs pass", async () => {
    const d = fakeDaemon({ boot: "boot-b" });
    open.push(d);
    const { c } = client(d.port);
    const got: [string, number | null][] = [];
    c.on("thread.upsert", (e) => void got.push([e.thread.id, e.rev]));
    c.connect(WS);
    await until(() => c.state.kind === "live");
    c.noteRev("thread:th_1", 5);
    expect(c.isStale("thread:th_1", 5)).toBe(true);
    expect(c.isStale("thread:th_1", 6)).toBe(false);
    d.emit(upsert("th_1"), WS, 5);
    d.emit(upsert("th_1"), WS, 6);
    d.emit(upsert("th_2"), WS, 7);
    d.emit(upsert("th_2"), WS, 7);
    d.emit(upsert("th_1"), WS, 4);
    await until(() => c.rev(WS) === 7 && got.length >= 3);
    await Bun.sleep(20);
    expect(got).toEqual([
      ["th_1", 6],
      ["th_2", 7],
      ["th_2", 7],
    ]);
  });

  test("SRV-I-032: a dropped stream reconnects with ?last=<seq> and replays without loss or duplicates", async () => {
    const d = fakeDaemon({ boot: "boot-c" });
    open.push(d);
    const { c } = client(d.port);
    const ids: string[] = [];
    c.on("thread.removed", (e) => void ids.push(e.id));
    c.on("notice", (e) => void ids.push(e.key));
    c.connect(WS);
    await until(() => c.state.kind === "live");
    d.emit({ type: "thread.removed", id: "th_a" });
    await until(() => ids.length === 1);
    const before = c.seq();
    d.drop();
    d.emit({ type: "thread.removed", id: "th_b" }); // while disconnected
    d.emit({ type: "notice", level: "info", key: "c" }, null, null);
    await until(() => ids.length === 3);
    expect(d.requests.at(-1)?.last).toBe(String(before));
    expect(ids).toEqual(["th_a", "th_b", "c"]);
    expect(c.state.kind).toBe("live");
  });

  test("SRV-AT-05 / SRV-I-029: daemon restart on the same port ⇒ live again ≤ 5 s without 401, one resync (boot changed)", async () => {
    const d1 = fakeDaemon({ boot: "boot-1" });
    const port = d1.port;
    const { c, states } = client(port);
    const resyncs: string[] = [];
    c.on("resync", (e) => void resyncs.push(e.reason));
    c.connect(null);
    await until(() => c.state.kind === "live");
    d1.emit({ type: "server.shutdown", reason: "restart" }, null, null);
    await until(() => c.state.kind === "stopped");
    await d1.stop();
    const t0 = performance.now();
    await Bun.sleep(150);
    const d2 = fakeDaemon({ boot: "boot-2", port, resyncOnRestart: true });
    open.push(d2);
    await until(() => c.state.kind === "live", 5000);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(resyncs).toEqual(["restart"]);
    expect(d2.requests.every((r) => r.auth === "Mitori-Session good")).toBe(true);
    expect(states.some((s) => s.kind === "auth_expired")).toBe(false);
  });

  test("401 ⇒ auth_expired and no retry; version mismatch is reported", async () => {
    const d = fakeDaemon({ boot: "boot-d", version: "2.0.0" });
    open.push(d);
    const bad = client(d.port, { token: "revoked" });
    bad.c.connect(null);
    await until(() => bad.c.state.kind === "auth_expired");
    await Bun.sleep(700);
    expect(d.requests.length).toBe(1);
    const old = client(d.port, { version: "1.0.0" });
    old.c.connect(null);
    await until(() => old.c.state.kind === "version_mismatch");
    expect(old.c.state).toEqual({ kind: "version_mismatch", daemon: "2.0.0", web: "1.0.0" });
  });

  test("close() stops reconnecting", async () => {
    const d = fakeDaemon({ boot: "boot-e" });
    open.push(d);
    const { c } = client(d.port);
    c.connect(null);
    await until(() => c.state.kind === "live");
    c.close();
    d.drop();
    await Bun.sleep(800);
    expect(d.requests.length).toBe(1);
    expect(c.state).toEqual({ kind: "stopped", reason: "closed" });
  });
});

describe("backoff and parser", () => {
  test("0.5 s × 2ⁿ, capped at 10 s, jitter ±20 % from Random", () => {
    const mid: Random = { bytes: (n) => new Uint8Array(n).fill(0x7f).map((_v, i) => (i === 0 ? 0x7f : 0xff)) };
    const lo: Random = { bytes: (n) => new Uint8Array(n) };
    const hi: Random = { bytes: (n) => new Uint8Array(n).fill(0xff) };
    expect(backoffDelay(0, lo)).toBe(400);
    expect(backoffDelay(0, hi)).toBe(600);
    expect(backoffDelay(0, mid)).toBe(500);
    expect(backoffDelay(3, mid)).toBe(4000);
    expect(backoffDelay(10, hi)).toBe(BACKOFF_CAP_MS * 1.2);
    expect(backoffDelay(99, lo)).toBe(BACKOFF_CAP_MS * 0.8);
  });

  test("frames split across chunks, CRLF, comments and multi-line data", () => {
    const frames: { id: string | null; data: string }[] = [];
    const p = createFrameParser((f) => void frames.push(f));
    p.push(":\n\nid: 1\nda");
    p.push('ta: {"a":\n');
    p.push(": hb\r\n\r\nid: 2\r\ndata: x\r\ndata: y\r\n\r\n");
    expect(frames).toEqual([
      { id: "1", data: '{"a":' },
      { id: "2", data: "x\ny" },
    ]);
  });
});
