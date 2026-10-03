import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MitoriError } from "@mitori/core";
import { createFakeClock, inlineWorkerPool } from "../testing.ts";
import { createWorkerPool } from "./index.ts";

const url = join(import.meta.dir, "test", "echo-worker.ts");
type Req = { op: "echo"; v: unknown } | { op: "who" } | { op: "throw" } | { op: "crash" } | { op: "sleep"; ms: number } | { op: "exit" };

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return MitoriError.is(e) ? e.code : String(e);
  }
};

describe("PLAT-I-006 WorkerPool", () => {
  test("lazy spawn up to size, pull-based dispatch, structured clone round trip", async () => {
    const pool = createWorkerPool<Req, unknown>({ url, size: 2 });
    expect(pool.size()).toBe(0);
    expect(await pool.run({ op: "echo", v: { a: [1, "x"], b: new Uint8Array([7]) } })).toEqual({ a: [1, "x"], b: new Uint8Array([7]) });
    expect(pool.size()).toBe(1);
    const who = await Promise.all([pool.run({ op: "sleep", ms: 30 }), pool.run({ op: "sleep", ms: 30 }), pool.run({ op: "sleep", ms: 1 })]);
    expect(pool.size()).toBe(2);
    expect(new Set(who).size).toBe(2);
    await pool.close();
  });

  test("a handled error fails the request only; the same worker keeps serving", async () => {
    const pool = createWorkerPool<Req, unknown>({ url });
    const before = await pool.run({ op: "who" });
    expect(await codeOf(pool.run({ op: "throw" }))).toBe("E_INTERNAL");
    expect(await pool.run({ op: "who" })).toBe(before);
    await pool.close();
  });

  test("a crash (uncaught error or exit) fails only the in-flight request; the pool is regenerated", async () => {
    const pool = createWorkerPool<Req, unknown>({ url, size: 1 });
    const first = await pool.run({ op: "who" });
    const queued = pool.run({ op: "echo", v: 42 });
    expect(await codeOf(pool.run({ op: "crash" }).finally(() => {}))).toBe("E_INTERNAL");
    expect(await queued).toBe(42);
    const second = await pool.run({ op: "who" });
    expect(second).not.toBe(first);
    expect(await codeOf(pool.run({ op: "exit" }))).toBe("E_INTERNAL");
    expect(await pool.run({ op: "echo", v: "alive" })).toBe("alive");
    expect(pool.size()).toBe(1);
    await pool.close();
  });

  test("idle for 60 s (FakeClock) → workers released; next run respawns", async () => {
    const clock = createFakeClock();
    const pool = createWorkerPool<Req, unknown>({ url, size: 2, timers: clock });
    await Promise.all([pool.run({ op: "sleep", ms: 10 }), pool.run({ op: "sleep", ms: 10 })]);
    expect(pool.size()).toBe(2);
    clock.advance(59_999);
    expect(pool.size()).toBe(2);
    clock.advance(1);
    expect(pool.size()).toBe(0);
    expect(await pool.run({ op: "echo", v: 1 })).toBe(1);
    expect(pool.size()).toBe(1);
    await pool.close();
  });

  test("cancellation: queued requests are dropped, a running one terminates its worker", async () => {
    const pool = createWorkerPool<Req, unknown>({ url, size: 1 });
    const ac = new AbortController();
    const running = pool.run({ op: "sleep", ms: 5000 }, ac.signal);
    const queued = pool.run({ op: "echo", v: "after" });
    await Bun.sleep(20);
    ac.abort();
    expect(await codeOf(running)).toBe("E_CANCELLED");
    expect(await queued).toBe("after");
    const pre = new AbortController();
    pre.abort();
    expect(await codeOf(pool.run({ op: "echo", v: 1 }, pre.signal))).toBe("E_CANCELLED");
    await pool.close();
  });

  test("resize grows eagerly and shrinks idle workers; resize(0) releases everything; close rejects", async () => {
    const pool = createWorkerPool<Req, unknown>({ url, size: 1 });
    await pool.resize(3);
    expect(pool.size()).toBe(3);
    await pool.shrink(1);
    expect(pool.size()).toBe(1);
    await pool.resize(0);
    expect(pool.size()).toBe(0);
    const pending = pool.run({ op: "sleep", ms: 5000 });
    await Bun.sleep(10);
    await pool.close();
    expect(await codeOf(pending)).toBe("E_SHUTTING_DOWN");
    expect(await codeOf(pool.run({ op: "echo", v: 1 }))).toBe("E_SHUTTING_DOWN");
    expect(pool.size()).toBe(0);
  });

  test("inlineWorkerPool (testing) runs in-thread with the same surface", async () => {
    const pool = inlineWorkerPool((n: number) => n * 2);
    expect(await pool.run(21)).toBe(42);
    await pool.resize(3);
    expect(pool.size()).toBe(3);
    await pool.close();
    expect(await codeOf(pool.run(1))).toBe("E_SHUTTING_DOWN");
  });
});
