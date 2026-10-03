import { describe, expect, test } from "bun:test";
import type { SseEventPayload, WorkspaceKey } from "@mitori/core";
import { SERVER_STATE_MIGRATIONS, SERVER_WORKSPACE_MIGRATIONS } from "../http/schema.ts";
import { migrate, noopMetrics, removeDir, sqliteDb, tempDir } from "../http/test/fakes.ts";
import { assertInWriteSlot, createStateQueue, createWorkspaceWriter, currentWriteSlot, guardMutators, requestWriteScope } from "./queue.ts";

const WS = "ws_qqqqqqqqqqqq" as WorkspaceKey;

function writer(opts: { dev?: boolean } = {}) {
  const db = migrate(sqliteDb(), SERVER_WORKSPACE_MIGRATIONS);
  db.exec("CREATE TABLE t (n INTEGER)");
  const published: { payload: SseEventPayload; rev: number | null }[] = [];
  const w = createWorkspaceWriter({
    ws: WS,
    db,
    hub: { publish: (payload, _ws, rev) => void published.push({ payload, rev }) },
    metrics: noopMetrics,
    dev: opts.dev ?? true,
  });
  return { db, w, published };
}

const ev = (id: number): SseEventPayload => ({ type: "thread.removed", id: `th_${String(id).padStart(8, "0")}` });

describe("SRV-I-017 / SRV-AT-04 write queue", () => {
  test("100 concurrent writes: serialized, rev monotonic without gaps, one rev per event-emitting write", async () => {
    const { db, w, published } = writer();
    const order: number[] = [];
    const revs = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        requestWriteScope.run({ rev: null }, async () => {
          await w.write(`op${i}`, () => {
            order.push(i);
            db.run("INSERT INTO t (n) VALUES (?)", [i]);
            w.events.emit(ev(i));
          });
          return requestWriteScope.getStore()?.rev;
        }),
      ),
    );
    expect(order).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(revs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(revs).size).toBe(100);
    expect(published.map((p) => p.rev)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(w.rev()).toBe(100);
    expect(db.get<{ v: string }>("SELECT v FROM srv_meta WHERE k = 'rev'")?.v).toBe("100");
  });

  test("rev advances only for writes that emitted events; events of one slot share its rev", async () => {
    const { w, published } = writer();
    await w.write("quiet", () => 1);
    expect(w.rev()).toBe(0);
    await w.write("two", () => {
      w.events.emit(ev(1));
      w.events.emit(ev(2));
    });
    expect(published.map((p) => p.rev)).toEqual([1, 1]);
    w.events.emit(ev(3)); // outside a slot: current rev, no advance
    expect(published.at(-1)?.rev).toBe(1);
    expect(w.rev()).toBe(1);
  });

  test("a throwing slot rolls back, publishes nothing, does not advance rev and does not jam the queue", async () => {
    const { db, w, published } = writer();
    const bad = w.write("bad", () => {
      db.run("INSERT INTO t (n) VALUES (1)");
      w.events.emit(ev(1));
      throw new Error("boom");
    });
    const good = w.write("good", () => {
      db.run("INSERT INTO t (n) VALUES (2)");
      w.events.emit(ev(2));
      return "ok";
    });
    expect(
      await bad.then(
        () => "resolved",
        (e: Error) => e.message,
      ),
    ).toBe("boom");
    expect(await good).toBe("ok");
    expect(db.all<{ n: number }>("SELECT n FROM t")).toEqual([{ n: 2 }]);
    expect(published.map((p) => p.rev)).toEqual([1]);
  });

  test("rev survives a reopen (srv_meta)", async () => {
    const dir = tempDir();
    try {
      const path = `${dir}/index.sqlite`;
      const db1 = migrate(sqliteDb(path), SERVER_WORKSPACE_MIGRATIONS);
      const w1 = createWorkspaceWriter({ ws: WS, db: db1, hub: { publish() {} }, metrics: noopMetrics, dev: true });
      await w1.write("a", () => w1.events.emit(ev(1)));
      await w1.write("b", () => w1.events.emit(ev(2)));
      db1.close();
      const db2 = sqliteDb(path);
      const w2 = createWorkspaceWriter({ ws: WS, db: db2, hub: { publish() {} }, metrics: noopMetrics, dev: true });
      expect(w2.rev()).toBe(2);
      db2.close();
    } finally {
      removeDir(dir);
    }
  });

  test("slot-outside mutation is a dev assertion (E_INTERNAL)", async () => {
    const { w } = writer();
    const store = {
      items: [] as number[],
      add(n: number) {
        this.items.push(n);
        return this.items.length;
      },
    };
    const guarded = guardMutators(store, ["add"], WS);
    expect(() => guarded.add(1)).toThrow("mutation outside write queue");
    expect(await w.write("in", () => guarded.add(2))).toBe(1);
    expect(store.items).toEqual([2]);
    expect(currentWriteSlot()).toBeNull();
    expect(() => assertInWriteSlot("x")).toThrow();
    await w.write("in", () => assertInWriteSlot("x", WS));
  });
});

describe("SRV-U-018 write slot assertions", () => {
  test("a slot running > 50 ms throws in dev builds and rolls back", async () => {
    const { db, w, published } = writer({ dev: true });
    const busy = w.write("slow", () => {
      db.run("INSERT INTO t (n) VALUES (1)");
      w.events.emit(ev(1));
      const end = performance.now() + 60;
      while (performance.now() < end) {
        // a sync wait standing in for an awaited LLM/git/network call
      }
    });
    const err = await busy.then(
      () => null,
      (e: { code?: string; message: string }) => e,
    );
    expect(err?.code).toBe("E_INTERNAL");
    expect(err?.message).toContain("no LLM/git/network/Worker waits");
    expect(db.all("SELECT n FROM t")).toEqual([]);
    expect(published).toEqual([]);
  });

  test("release builds do not time slots; a promise-returning fn is always rejected", async () => {
    const { w } = writer({ dev: false });
    const end = performance.now() + 55;
    await w.write("slow-ok", () => {
      while (performance.now() < end) {
        // no-op
      }
    });
    const err = await w.write("async", (() => Promise.resolve(1)) as unknown as () => number).then(
      () => null,
      (e: Error) => e.message,
    );
    expect(err).toBe("write fn must be synchronous");
  });
});

describe("SRV-I-030 stateWrite", () => {
  test("3 workspaces + agent bridge writing state.sqlite concurrently through stateWrite ⇒ SQLITE_BUSY 0", async () => {
    const dir = tempDir();
    try {
      const path = `${dir}/state.sqlite`;
      const db = migrate(sqliteDb(path), SERVER_STATE_MIGRATIONS);
      db.exec("CREATE TABLE use_records (id INTEGER PRIMARY KEY, src TEXT)");
      const stateWrite = createStateQueue({ db, metrics: noopMetrics, dev: true });
      const sources = ["ws_a", "ws_b", "ws_c", "agent"];
      const errors: unknown[] = [];
      await Promise.all(
        sources.flatMap((src) =>
          Array.from({ length: 50 }, (_, i) =>
            stateWrite(`${src}:${i}`, () => {
              db.run("INSERT INTO use_records (src) VALUES (?)", [src]);
              db.run("INSERT INTO srv_ports (id, port, updated_at) VALUES (1, ?, 'x') ON CONFLICT (id) DO UPDATE SET port = excluded.port", [i]);
            }).catch((e) => errors.push(e)),
          ),
        ),
      );
      expect(errors).toEqual([]);
      expect(db.get<{ c: number }>("SELECT count(*) AS c FROM use_records")?.c).toBe(200);
      db.close();
    } finally {
      removeDir(dir);
    }
  });
});
