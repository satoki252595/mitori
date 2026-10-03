import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { JobId, SseEvent, SseEventPayload, WorkspaceKey } from "@mitori/core";
import { type Harness, startHarness } from "../http/test/harness.ts";
import { openSse } from "../http/test/sse-reader.ts";

let h: Harness;
let ws: WorkspaceKey;
let ws2: WorkspaceKey;
let auth: string;

beforeAll(async () => {
  h = await startHarness();
  ws = await h.openProject("a");
  ws2 = await h.openProject("b");
  auth = `Mitori-Session ${(await h.browser()).token}`;
});
afterAll(() => h.close());

const hub = () => h.daemon.services.hub;
const removed = (id: string): SseEventPayload => ({ type: "thread.removed", id: `th_${id}` });

describe("SRV-I-016 stream basics", () => {
  test("first bytes `:\\n\\n`, then hello {boot}; ids are the daemon-global seq; closing leaves no connection behind", async () => {
    const before = hub().connections();
    const r = await openSse(h.origin, auth, `?ws=${ws}`);
    await r.until((es) => es.length >= 1);
    expect(r.prelude).toBe(":\n\n");
    expect(r.events[0]).toMatchObject({ type: "hello", apiVersion: 1, boot: hub().boot, resumedFrom: null });
    hub().publish(removed("00000001"), ws, 1);
    await r.until((es) => es.some((e) => e.type === "thread.removed"));
    expect(r.events.at(-1)?.seq).toBe(hub().seq());
    expect(hub().connections()).toBe(before + 1);
    r.close();
    await r.closed;
    await Bun.sleep(20);
    expect(hub().connections()).toBe(before);
  });

  test("a bearer CLI may stream; unknown ws / bad last are rejected", async () => {
    const cli = await openSse(h.origin, `Bearer ${h.token}`, "");
    await cli.until((es) => es.length >= 1);
    expect(cli.status).toBe(200);
    cli.close();
    expect((await openSse(h.origin, auth, "?ws=ws_zzzzzzzzzzzz")).status).toBe(404);
    expect((await openSse(h.origin, auth, "?last=-1")).status).toBe(400);
    expect((await openSse(h.origin, "Mitori-Session nope", "")).status).toBe(401);
  });
});

describe("SRV-I-032 / SRV-AT-03 resume", () => {
  test("mixed workspace + global events: disconnect, `last=<seq>` reconnect ⇒ no loss, no duplicates, other ws filtered", async () => {
    const r1 = await openSse(h.origin, auth, `?ws=${ws}`);
    await r1.until((es) => es.length >= 1);
    hub().publish(removed("a0000001"), ws, 10);
    hub().publish({ type: "notice", level: "info", key: "notice.settings.reloaded" }, null, null);
    await r1.until((es) => es.length >= 3);
    const last = r1.events.at(-1)?.seq as number;
    r1.close();
    await r1.closed;
    const expected: string[] = [];
    for (let i = 0; i < 30; i++) {
      hub().publish(removed(`b${String(i).padStart(7, "0")}`), ws, 11 + i);
      expected.push(`th_b${String(i).padStart(7, "0")}`);
      hub().publish(removed(`x${String(i).padStart(7, "0")}`), ws2, 1 + i); // other workspace
      if (i % 5 === 0) {
        hub().publish({ type: "notice", level: "info", key: `k${i}` }, null, null);
        expected.push(`k${i}`);
      }
      hub().publish({ type: "scan.progress", stage: "S0", done: i, total: 30 }, ws, 11 + i); // ephemeral: not replayed
    }
    const r2 = await openSse(h.origin, auth, `?ws=${ws}&last=${last}`);
    hub().publish(removed("c0000001"), ws, 99);
    expected.push("th_c0000001");
    await r2.until((es) => es.some((e) => e.type === "thread.removed" && e.id === "th_c0000001"));
    const got = r2.events
      .filter((e) => e.type === "thread.removed" || e.type === "notice")
      .map((e) => (e.type === "thread.removed" ? e.id : (e as { key: string }).key));
    expect(r2.events[0]).toMatchObject({ type: "hello", resumedFrom: last });
    expect(got).toEqual(expected);
    const seqs = r2.events.slice(1).map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    r2.close();
  });

  test("more than 4,096 replayable events missed ⇒ resync gap", async () => {
    const r1 = await openSse(h.origin, auth, `?ws=${ws}`);
    await r1.until((es) => es.length >= 1);
    const last = hub().seq();
    r1.close();
    await r1.closed;
    for (let i = 0; i < 4100; i++) hub().publish(removed(`g${String(i).padStart(7, "0")}`), ws, i);
    const r2 = await openSse(h.origin, auth, `?ws=${ws}&last=${last}`);
    await r2.until((es) => es.length >= 2);
    expect(r2.events[1]).toMatchObject({ type: "resync", reason: "gap" });
    r2.close();
  });
});

describe("SRV-AT-03 / PT-01 over HTTP", () => {
  test("fuzz: 3 jobs × 200 text deltas at 1 ms (+ tool events) ⇒ the client rebuilds byte-identical text", async () => {
    const r = await openSse(h.origin, auth, `?ws=${ws}`);
    await r.until((es) => es.length >= 1);
    const jobs = ["j_000000000a", "j_000000000b", "j_000000000c"] as JobId[];
    const sent = new Map<string, string>(jobs.map((j) => [j, ""]));
    for (let i = 0; i < 200; i++) {
      for (const job of jobs) {
        const delta = `${job.slice(-1)}${i}「あ😀」\n"\\${i % 3 === 0 ? "\u0000" : ""}|`;
        sent.set(job, (sent.get(job) ?? "") + delta);
        hub().publish({ type: "job.event", job, event: { t: "text", delta, at: i } }, ws, i);
        if (i % 37 === 0) {
          sent.set(job, `${sent.get(job) ?? ""}<tool>`);
          hub().publish({ type: "job.event", job, event: { t: "tool", name: "Read", status: "ok", at: i } }, ws, i);
        }
      }
      await Bun.sleep(1);
    }
    hub().publish(removed("ffffffff"), ws, 1000); // end marker (after the 100 ms windows flush)
    await Bun.sleep(150);
    hub().publish(removed("eeeeeeee"), ws, 1001);
    await r.until((es) => es.some((e) => e.type === "thread.removed" && e.id === "th_eeeeeeee"), 5000);
    const got = new Map<string, string>(jobs.map((j) => [j, ""]));
    let jobEvents = 0;
    for (const e of r.events as SseEvent[]) {
      if (e.type !== "job.event") continue;
      jobEvents += 1;
      got.set(e.job, (got.get(e.job) ?? "") + (e.event.t === "text" ? e.event.delta : "<tool>"));
    }
    for (const j of jobs) expect(Buffer.from(got.get(j) ?? "").equals(Buffer.from(sent.get(j) ?? ""))).toBe(true);
    expect(jobEvents).toBeLessThan(3 * 200); // coalesced
    r.close();
  });

  test("200 connections (readers in a Worker): publish → delivery p99 ≤ 5 ms", async () => {
    const N = 40;
    const worker = new Worker(new URL("./test/sse-clients.worker.ts", import.meta.url).href);
    const message = (kind: string) =>
      new Promise<{ kind: string; arrivals?: number[][] }>((resolve) => {
        const on = (e: MessageEvent<{ kind: string; arrivals?: number[][] }>) => {
          if (e.data.kind !== kind) return;
          worker.removeEventListener("message", on);
          resolve(e.data);
        };
        worker.addEventListener("message", on);
      });
    try {
      const ready = message("ready");
      worker.postMessage({ origin: h.origin, auth, query: `?ws=${ws}`, connections: 200, expect: N });
      await ready;
      const done = message("done");
      const publishedAt: number[] = [];
      for (let i = 0; i < N; i++) {
        publishedAt.push(performance.timeOrigin + performance.now());
        hub().publish(removed(`p${String(i).padStart(7, "0")}`), ws, i);
        await Bun.sleep(10);
      }
      const { arrivals = [] } = await done;
      const lat = arrivals.flatMap((times) => times.map((t, i) => t - (publishedAt[i] as number))).sort((a, b) => a - b);
      const p99 = lat[Math.floor(lat.length * 0.99)] as number;
      const p50 = lat[Math.floor(lat.length * 0.5)] as number;
      console.log(`srv.sse.p99 (200 clients): p50 ${p50.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, n=${lat.length}`);
      expect(lat.length).toBe(200 * N);
      expect(p99).toBeLessThanOrEqual(5);
    } finally {
      worker.terminate();
    }
  }, 30_000);
});
