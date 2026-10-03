/**
 * WEB-U-026 SSE reducer de-duplication, on the REAL `SseClient` (it records each event's `rev` per entity BEFORE it
 * dispatches, drops older revs and the echo of our own `x-mitori-rev` response) behind a scripted `/events` stream —
 * a hand-written fake of it hid LIVE-01: the store-side check used to call `noteRev` (= "this rev came from a
 * response"), so the second state of an entity inside ONE rev never reached the store.
 */
import { describe, expect, test } from "bun:test";
import { createSseClient, type EntityKey, type SseClient } from "@mitori/client";
import type { SseEvent, WorkspaceKey } from "@mitori/core";
import type { Stores } from "./app.svelte.ts";
import { acceptProgress, acceptUpsert, wireSse } from "./sse.ts";

const WS = "ws_cccccccccccc" as WorkspaceKey;
const enc = new TextEncoder();

/** A real client connected to a scripted stream: `send(payload, rev)` is one daemon event. */
async function liveSse() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const sse = createSseClient({
    base: "http://127.0.0.1:1/api/v1",
    auth: { scheme: "session", token: () => "t" },
    client: { kind: "web", version: "1.0.0" },
    random: { bytes: (n) => new Uint8Array(n).fill(0x80) },
    clock: { now: () => Date.now(), iso: () => new Date().toISOString() },
    fetch: (async () => new Response(body, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch,
  });
  let seq = 100;
  const frame = (e: object) => ctl.enqueue(enc.encode(`id: ${(e as { seq: number }).seq}\ndata: ${JSON.stringify(e)}\n\n`));
  sse.connect(WS);
  frame({ type: "hello", version: "1.0.0", apiVersion: 1, resumedFrom: null, boot: "b1", seq: seq, ws: null, rev: null, at: "" });
  const send = async (payload: Record<string, unknown>, rev: number | null) => {
    frame({ ...payload, seq: ++seq, ws: WS, rev, at: "" });
    await Bun.sleep(5);
  };
  return { sse, send, close: () => sse.close() };
}

describe("WEB-U-026 SSE upsert de-dupe", () => {
  test("acceptUpsert / acceptProgress are pure queries on the client's record (they never write it)", () => {
    const recorded = new Map<string, { rev: number; response: boolean }>();
    // the real client's rule: older rev, or the same rev when the record came from our own response
    const sse = {
      isStale: (k: EntityKey, rev: number) => {
        const v = recorded.get(k);
        return v !== undefined && (rev < v.rev || (rev === v.rev && v.response));
      },
    } as Pick<SseClient, "isStale">;
    const k = "thread:th_1" as EntityKey;
    recorded.set(k, { rev: 5, response: false });
    expect(acceptUpsert(sse, k, { rev: 5 })).toBe(true);
    expect(acceptUpsert(sse, k, { rev: 5 })).toBe(true);
    expect(acceptUpsert(sse, k, { rev: 4 })).toBe(false);
    expect(acceptUpsert(sse, k, { rev: null })).toBe(true);
    expect(recorded.get(k)).toEqual({ rev: 5, response: false });
    recorded.set(k, { rev: 5, response: true });
    expect(acceptUpsert(sse, k, { rev: 5 })).toBe(false);
    expect(acceptProgress(sse, k, { rev: 5 })).toBe(false);
    expect(acceptProgress(sse, k, { rev: 6 })).toBe(true);
    recorded.set(k, { rev: 5, response: false });
    expect(acceptProgress(sse, k, { rev: 5 })).toBe(true);
    expect(acceptProgress(sse, k, { rev: 4 })).toBe(false);
  });

  test("an older thread / job replay after a newer one does not overwrite it", async () => {
    const { sse, send, close } = await liveSse();
    const threads = new Map<string, { id: string; v: number }>();
    const jobs = new Map<string, { id: string; v: number }>();
    const off = wireSse({ sse, review: { threads, jobs } } as unknown as Stores, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    await send({ type: "thread.upsert", thread: { id: "th_1", v: 2 } }, 10);
    await send({ type: "thread.upsert", thread: { id: "th_1", v: 1 } }, 8);
    await send({ type: "job.upsert", job: { id: "j_1", v: 3 } }, 12);
    await send({ type: "job.upsert", job: { id: "j_1", v: 2 } }, 11);
    expect(threads.get("th_1")?.v).toBe(2);
    expect(jobs.get("j_1")?.v).toBe(3);
    await send({ type: "thread.upsert", thread: { id: "th_1", v: 3 } }, 11);
    expect(threads.get("th_1")?.v).toBe(3);
    off();
    close();
  });

  test("LIVE-01: states of one thread / job published inside ONE rev all apply (running → answered)", async () => {
    const { sse, send, close } = await liveSse();
    const threads = new Map<string, { id: string; state: string }>();
    const jobs = new Map<string, { id: string; state: string }>();
    const off = wireSse({ sse, review: { threads, jobs } } as unknown as Stores, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    // the order the daemon published them in (the loop's own writes do not bump the workspace rev)
    await send({ type: "thread.upsert", thread: { id: "th_1", state: "running" } }, 8);
    await send({ type: "thread.upsert", thread: { id: "th_1", state: "answered" } }, 8);
    await send({ type: "job.upsert", job: { id: "j_1", state: "running" } }, 8);
    await send({ type: "job.upsert", job: { id: "j_1", state: "done" } }, 8);
    expect(threads.get("th_1")?.state).toBe("answered");
    expect(jobs.get("j_1")?.state).toBe("done");
    off();
    close();
  });

  test("the echo of our own mutation (same rev as its x-mitori-rev response) is still dropped", async () => {
    const { sse, send, close } = await liveSse();
    const threads = new Map<string, { id: string; state: string }>();
    const off = wireSse({ sse, review: { threads, jobs: new Map() } } as unknown as Stores, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    threads.set("th_1", { id: "th_1", state: "open" }); // what the PATCH response put into the store
    sse.noteRev("thread:th_1", 7);
    await send({ type: "thread.upsert", thread: { id: "th_1", state: "stale-echo" } }, 7);
    expect(threads.get("th_1")?.state).toBe("open");
    await send({ type: "thread.upsert", thread: { id: "th_1", state: "queued" } }, 8);
    expect(threads.get("th_1")?.state).toBe("queued");
    off();
    close();
  });
});

/** Handler table only — enough for events that carry no entity. */
function fakeSse() {
  const handlers = new Map<string, (e: SseEvent) => void>();
  const sse = {
    on(type: string, fn: (e: SseEvent) => void) {
      handlers.set(type, fn);
      return () => handlers.delete(type);
    },
    noteRev() {},
    isStale: () => false,
  };
  const emit = (e: Record<string, unknown>) => handlers.get(e.type as string)?.({ seq: 1, at: "", ws: "ws_cr1t00000000", rev: null, ...e } as never);
  return { sse: sse as unknown as SseClient, emit };
}

describe("settings.updated applies the whole UI block (ux.md §3.2-6)", () => {
  function storesWith(pending: boolean) {
    const calls: string[] = [];
    const view = { version: 4, settings: { ui: { lang: "en", readerLevel: "expert", keymap: { "read.next": "n" } } } };
    const s = {
      session: { loadSettings: async () => view },
      prefs: {
        pending,
        level: "standard",
        reconcile(v: typeof view) {
          calls.push("reconcile");
          this.level = v.settings.ui.readerLevel;
        },
      },
      keys: { setOverrides: (m: Record<string, string>) => calls.push(`keymap:${Object.keys(m).join(",")}`) },
      doc: {
        level: "standard",
        levelTransition: () => () => calls.push("anchor"),
        setLevel(l: string) {
          calls.push(`level:${l}`);
          this.level = l;
        },
      },
    };
    return { s, calls };
  }

  test("level, keymap overrides and language follow the server (with the reading-position anchor)", async () => {
    const { sse, emit } = fakeSse();
    const { s, calls } = storesWith(false);
    const off = wireSse({ ...s, sse } as unknown as Stores, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    emit({ type: "settings.updated" });
    await Bun.sleep(0);
    expect(calls).toEqual(["reconcile", "keymap:read.next", "level:expert", "anchor"]);
    off();
  });

  test("a local change still waiting for its debounced PATCH is not overwritten", async () => {
    const { sse, emit } = fakeSse();
    const { s, calls } = storesWith(true);
    const off = wireSse({ ...s, sse } as unknown as Stores, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    emit({ type: "settings.updated" });
    await Bun.sleep(0);
    expect(calls).toEqual([]);
    off();
  });
});
