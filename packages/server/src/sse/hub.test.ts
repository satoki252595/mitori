import { describe, expect, test } from "bun:test";
import type { JobEvent, JobId, SseEvent, SseEventPayload, WorkspaceKey } from "@mitori/core";
import type { SseConnection } from "../contract.ts";
import { fakeClock, fakeTimers, noopMetrics, recordingMetrics, seededRandom } from "../http/test/fakes.ts";
import { createSseHub } from "./hub.ts";

const WS_A = "ws_aaaaaaaaaaaa" as WorkspaceKey;
const WS_B = "ws_bbbbbbbbbbbb" as WorkspaceKey;

function setup(opts: { ringSize?: number } = {}) {
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const metrics = recordingMetrics();
  const hub = createSseHub({ clock, timers, metrics, random: seededRandom(7), version: "0.1.0", ...opts });
  return { clock, timers, metrics, hub };
}

function conn(ws: WorkspaceKey | null, client: SseConnection["client"] = "web") {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const c: SseConnection & { events: SseEvent[]; comments: string[] } = {
    ws,
    client,
    closed: false,
    events,
    comments,
    send: (e) => void events.push(e),
    comment: (t) => void comments.push(t),
  };
  return c;
}

const notice = (key: string): SseEventPayload => ({ type: "notice", level: "info", key });
const threadRemoved = (id: string): SseEventPayload => ({ type: "thread.removed", id: id as `th_${string}` });
const jobEvent = (job: string, event: JobEvent): SseEventPayload => ({ type: "job.event", job: job as JobId, event });

describe("SRV-I-016 SSE hub", () => {
  test("hello first with boot; seq is daemon-global and monotonic; envelope stamped", () => {
    const { hub } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    expect(a.events[0]).toMatchObject({ type: "hello", version: "0.1.0", apiVersion: 1, resumedFrom: null, boot: hub.boot, seq: hub.seq() });
    hub.publish(notice("notice.settings.reloaded"), null, null);
    hub.publish(threadRemoved("th_00000001"), WS_A, 3);
    const [, n, t] = a.events;
    expect(n).toMatchObject({ type: "notice", ws: null, rev: null });
    expect(t).toMatchObject({ type: "thread.removed", ws: WS_A, rev: 3 });
    expect((t as SseEvent).seq).toBe((n as SseEvent).seq + 1);
    expect(typeof (t as SseEvent).at).toBe("string");
  });

  test("scope: workspace events only to that workspace, global events to everyone", () => {
    const { hub } = setup();
    const a = conn(WS_A);
    const b = conn(WS_B);
    const g = conn(null);
    for (const c of [a, b, g]) hub.attach(c, null, null);
    hub.publish(threadRemoved("th_00000001"), WS_A, 1);
    hub.publish(notice("notice.trust.pending"), null, null);
    expect(a.events.map((e) => e.type)).toEqual(["hello", "thread.removed", "notice"]);
    expect(b.events.map((e) => e.type)).toEqual(["hello", "notice"]);
    expect(g.events.map((e) => e.type)).toEqual(["hello", "notice"]);
    expect(hub.connections({ ws: WS_A })).toBe(1);
    expect(hub.connections({ client: "web" })).toBe(3);
  });

  test("replay from last (filtered by ws, replayable only), no duplicates", () => {
    const { hub } = setup();
    const first = conn(WS_A);
    hub.attach(first, null, null);
    hub.publish(threadRemoved("th_00000001"), WS_A, 1);
    const last = hub.seq();
    hub.publish(threadRemoved("th_00000002"), WS_A, 2);
    hub.publish(threadRemoved("th_00000003"), WS_B, 1);
    hub.publish({ type: "scan.progress", stage: "S0", done: 1, total: 2 }, WS_A, 2); // not replayable
    hub.publish(notice("notice.settings.reloaded"), null, null);
    const again = conn(WS_A);
    hub.attach(again, last, hub.boot);
    expect(again.events[0]).toMatchObject({ type: "hello", resumedFrom: last, seq: last });
    expect(again.events.slice(1).map((e) => (e.type === "thread.removed" ? e.id : e.type))).toEqual(["th_00000002", "notice"]);
  });

  test("gap older than the ring ⇒ resync gap; other boot or future seq ⇒ resync restart", () => {
    const { hub } = setup({ ringSize: 8 });
    const start = hub.seq();
    for (let i = 0; i < 20; i++) hub.publish(threadRemoved(`th_${String(i).padStart(8, "0")}`), WS_A, i);
    const gap = conn(WS_A);
    hub.attach(gap, start + 2, null);
    expect(gap.events.map((e) => e.type)).toEqual(["hello", "resync"]);
    expect(gap.events[1]).toMatchObject({ type: "resync", reason: "gap" });
    const ok = conn(WS_A);
    hub.attach(ok, hub.seq() - 8, null);
    expect(ok.events.length).toBe(9);
    const otherBoot = conn(WS_A);
    hub.attach(otherBoot, hub.seq(), "differentboot000");
    expect(otherBoot.events[1]).toMatchObject({ type: "resync", reason: "restart" });
    const future = conn(WS_A);
    hub.attach(future, hub.seq() + 100, null);
    expect(future.events[1]).toMatchObject({ type: "resync", reason: "restart" });
    const older = conn(WS_A);
    hub.attach(older, hub.seqBase - 5, null);
    expect(older.events[1]).toMatchObject({ type: "resync", reason: "restart" });
  });

  test("heartbeat `: hb` every 15 s while connected; timers released when the last connection detaches", () => {
    const { hub, timers } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    timers.advance(14_999);
    expect(a.comments).toEqual([]);
    timers.advance(1);
    expect(a.comments).toEqual(["hb"]);
    timers.advance(15_000);
    expect(a.comments).toEqual(["hb", "hb"]);
    hub.detach(a);
    expect(timers.pending()).toBe(0);
    expect(hub.connections()).toBe(0);
  });

  test("a connection that throws or is closed is dropped", () => {
    const { hub } = setup();
    const bad = conn(null);
    bad.send = () => {
      throw new Error("gone");
    };
    const closed = conn(null);
    hub.attach(conn(null), null, null);
    hub.attach(closed, null, null);
    hub.attach(bad, null, null);
    closed.closed = true;
    hub.publish(notice("notice.settings.reloaded"), null, null);
    expect(hub.connections()).toBe(1);
  });
});

describe("SRV-I-016 coalescing (PT-01)", () => {
  test("entity key: gen.task merged per task id (latest wins), leading event immediate", () => {
    const { hub, timers, metrics } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    const task = (id: string, attempt: number) =>
      ({
        type: "gen.task",
        task: { id, attempt, stage: "S5", target: "m", state: "running", priority: 0, usage: null, blocks: [] },
      }) as unknown as SseEventPayload;
    hub.publish(task("gt_a", 1), WS_A, 1);
    hub.publish(task("gt_b", 1), WS_A, 1);
    hub.publish(task("gt_a", 2), WS_A, 2);
    hub.publish(task("gt_a", 3), WS_A, 3);
    hub.publish(task("gt_b", 2), WS_A, 3);
    const brief = (e: SseEvent) => {
      const t = (e as unknown as { task: { id: string; attempt: number } }).task;
      return [t.id, t.attempt];
    };
    expect(a.events.slice(1).map(brief)).toEqual([
      ["gt_a", 1],
      ["gt_b", 1],
    ]);
    timers.advance(100);
    const after = a.events
      .slice(3)
      .map((e) => [(e as unknown as { task: { id: string } }).task.id, (e as unknown as { task: { attempt: number } }).task.attempt, e.rev]);
    expect(after).toEqual([
      ["gt_a", 3, 3],
      ["gt_b", 2, 3],
    ]);
    expect(metrics.counts.get("srv.sse.coalesced")).toBe(1);
    timers.advance(100); // windows close once quiet
    expect(timers.pending()).toBe(1); // only the heartbeat remains
  });

  test("union: doc.saved files merged within the window", () => {
    const { hub, timers } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    hub.publish({ type: "doc.saved", files: ["a.md"] }, WS_A, 1);
    hub.publish({ type: "doc.saved", files: ["b.md", "c.md"] }, WS_A, 2);
    hub.publish({ type: "doc.saved", files: ["c.md", "d.md"] }, WS_A, 3);
    timers.advance(500);
    expect(a.events.slice(1).map((e) => (e as { files?: string[] }).files)).toEqual([["a.md"], ["b.md", "c.md", "d.md"]]);
  });

  test("job.event: text concatenated per job; non-text flushes the pending text first and is never merged", () => {
    const { hub, timers } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    const text = (job: string, delta: string) => jobEvent(job, { t: "text", delta, at: 0 });
    hub.publish(text("j_1", "a"), WS_A, 1);
    hub.publish(text("j_1", "b"), WS_A, 1);
    hub.publish(text("j_2", "x"), WS_A, 1);
    hub.publish(text("j_1", "c"), WS_A, 1);
    hub.publish(jobEvent("j_1", { t: "phase", phase: "thinking" as never, at: 0 }), WS_A, 1);
    hub.publish(jobEvent("j_1", { t: "phase", phase: "editing" as never, at: 0 }), WS_A, 1);
    timers.advance(100);
    const seen = a.events.slice(1).map((e) => {
      const je = e as Extract<SseEvent, { type: "job.event" }>;
      return `${je.job}:${je.event.t === "text" ? je.event.delta : je.event.t}`;
    });
    expect(seen).toEqual(["j_1:a", "j_2:x", "j_1:bc", "j_1:phase", "j_1:phase"]);
  });

  test("fuzz: 3 jobs × 200 deltas at 1 ms with interleaved non-text events ⇒ byte-identical reconstruction", () => {
    const { hub, timers } = setup();
    const a = conn(WS_A);
    hub.attach(a, null, null);
    const rnd = seededRandom(42);
    const jobs = ["j_0000000001", "j_0000000002", "j_0000000003"];
    const sent = new Map<string, string[]>(jobs.map((j) => [j, []]));
    const expected = new Map<string, string[]>(jobs.map((j) => [j, []])); // tokens: text runs + markers
    let marker = 0;
    for (let i = 0; i < 200; i++) {
      for (const j of jobs) {
        const [b0 = 0, b1 = 0] = rnd.bytes(2);
        const delta = `${j.slice(-1)}${i}:${'あa😀\n"\\'.slice(0, (b0 % 7) + 1)}|`;
        hub.publish(jobEvent(j, { t: "text", delta, at: i }), WS_A, i);
        sent.get(j)?.push(delta);
        expected.get(j)?.push(delta);
        if (b1 % 17 === 0) {
          marker += 1;
          hub.publish(jobEvent(j, { t: "tool", name: `m${marker}`, status: "ok", at: i }), WS_A, i);
          expected.get(j)?.push(`<m${marker}>`);
        }
      }
      timers.advance(1);
    }
    timers.advance(200);
    const got = new Map<string, string[]>(jobs.map((j) => [j, []]));
    for (const e of a.events) {
      if (e.type !== "job.event") continue;
      got.get(e.job)?.push(e.event.t === "text" ? e.event.delta : `<${e.event.t === "tool" ? e.event.name : "?"}>`);
    }
    for (const j of jobs) {
      const flatten = (xs: string[]) => xs.join("");
      expect(flatten(got.get(j) ?? [])).toBe(flatten(expected.get(j) ?? []));
      expect(Buffer.from((got.get(j) ?? []).filter((x) => !x.startsWith("<")).join("")).equals(Buffer.from((sent.get(j) ?? []).join("")))).toBe(true);
    }
    // coalescing actually happened (≤ ~10 Hz per job + markers)
    expect(a.events.length).toBeLessThan(3 * 200);
  });

  test("publish never throws", () => {
    const { hub } = setup();
    expect(() => hub.publish({ type: "nope" } as unknown as SseEventPayload, null, null)).not.toThrow();
    expect(() => hub.publish(null as unknown as SseEventPayload, null, null)).not.toThrow();
  });

  test("noop metrics accepted", () => {
    const hub = createSseHub({ clock: fakeClock(), timers: fakeTimers(fakeClock()), metrics: noopMetrics, random: seededRandom(1), version: "x" });
    expect(hub.boot).toMatch(/^[0-9a-z]{16}$/);
  });
});
