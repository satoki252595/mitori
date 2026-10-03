// ParsePool (main-thread side of S1, spec §3.1 / §3.3): IDX-AT-55 idle shrink after updates, cancellation between
// batches (spec §1.3), results in input order.
import { describe, expect, test } from "bun:test";
import { MitoriError, type WorkerPool } from "@mitori/core";
import type { ParseBatchRequest, ParseBatchResponse } from "../contract.ts";
import { ParsePool } from "./pool.ts";
import type { ParseItemExt } from "./protocol.ts";

/** A fake WorkerPool: answers every item `ok` after `delayMs`, records sizes and requests. */
function fakePool(delayMs = 0) {
  const log = { sizes: [] as number[], requests: 0 };
  let size = 0;
  const factory = (n: number): WorkerPool<ParseBatchRequest, ParseBatchResponse> => {
    size = n;
    log.sizes.push(n);
    return {
      async run(req) {
        log.requests++;
        await Bun.sleep(delayMs);
        return {
          id: req.id,
          items: req.items.map((it) => ({ status: "unreadable", path: it.path }) as never),
          ms: { read: 0, hash: 0, parse: 0, query: 0, extract: 0 },
        };
      },
      size: () => size,
      async resize(k) {
        size = k;
        log.sizes.push(k);
      },
      async shrink(keep = 0) {
        size = Math.min(size, keep);
        log.sizes.push(size);
      },
      async close() {
        size = 0;
      },
    };
  };
  return { factory, log, size: () => size };
}

const items = (n: number, size = 70_000): ParseItemExt[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `f${String(i).padStart(3, "0")}.ts`,
    abs: `/x/f${i}.ts`,
    size,
    lang: "typescript",
    grammar: "typescript",
    profile: "full",
    knownBlob: null,
    detectors: [],
    provisionalClass: "source",
    scope: "main",
  }));

describe("IDX-AT-55 idle shrink", () => {
  test("an update() outside a scan re-arms the idle clock: the warm Worker goes away without an SSE client", async () => {
    const f = fakePool();
    const pool = new ParsePool(f.factory, () => performance.now(), 30);
    await pool.run(items(1), 1);
    expect(f.size()).toBe(1);
    await Bun.sleep(80);
    expect(f.size()).toBe(0);
    await pool.run(items(1), 1); // e.g. update() long after the scan
    expect(f.size()).toBe(1);
    await Bun.sleep(80);
    expect(f.size()).toBe(0);
    await pool.close();
  });

  test("setActive(true) keeps the Worker; setActive(false) starts the clock", async () => {
    const f = fakePool();
    const pool = new ParsePool(f.factory, () => performance.now(), 30);
    pool.setActive(true);
    await pool.run(items(1), 1);
    await Bun.sleep(80);
    expect(f.size()).toBe(1);
    pool.setActive(false);
    await Bun.sleep(80);
    expect(f.size()).toBe(0);
    await pool.close();
  });
});

describe("spec §1.3 cancellation between batches", () => {
  test("an abort stops dispatching further batches and rejects with E_CANCELLED", async () => {
    const f = fakePool(15);
    const pool = new ParsePool(f.factory, () => performance.now());
    const ac = new AbortController();
    const work = items(200); // 14 MB → many batches on 2 Workers
    const run = pool.run(work, 2, ac.signal, (done) => {
      if (done > 0) ac.abort();
    });
    await expect(run).rejects.toBeInstanceOf(MitoriError);
    await expect(run).rejects.toMatchObject({ code: "E_CANCELLED" });
    await Bun.sleep(40);
    expect(f.log.requests).toBeLessThan(10);
    await pool.close();
  });

  test("a failing batch rejects run() only after the other lanes stopped; nothing is dispatched afterwards", async () => {
    const f = fakePool(5);
    let calls = 0;
    const factory = (n: number) => {
      const p = f.factory(n);
      return {
        ...p,
        run: (req: ParseBatchRequest) => (++calls === 3 ? Promise.reject(new Error("worker died")) : p.run(req)),
      };
    };
    const pool = new ParsePool(factory, () => performance.now(), 30);
    await expect(pool.run(items(200), 2)).rejects.toThrow("worker died");
    const after = calls;
    await Bun.sleep(40);
    expect(calls).toBe(after);
    expect(calls).toBeLessThan(10);
    await Bun.sleep(40);
    expect(f.size()).toBe(0); // idle clock re-armed once every lane settled
    await pool.close();
  });

  test("results come back in input order", async () => {
    const f = fakePool();
    const pool = new ParsePool(f.factory, () => performance.now());
    const work = items(50).map((it, i) => ({ ...it, size: 1_000 + ((i * 7919) % 50_000) }));
    const r = await pool.run(work, 3);
    expect(r.results.map((x) => x.path)).toEqual(work.map((w) => w.path));
    await pool.close();
  });
});
