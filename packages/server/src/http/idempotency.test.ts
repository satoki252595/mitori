import { describe, expect, test } from "bun:test";
import { MitoriError } from "@mitori/core";
import { createStateQueue } from "../ws/queue.ts";
import { checkIdempotencyKey, createIdempotencyStore } from "./idempotency.ts";
import { SERVER_STATE_MIGRATIONS } from "./schema.ts";
import { fakeClock, migrate, noopMetrics, sqliteDb } from "./test/fakes.ts";

describe("SRV-I-019 idempotency store", () => {
  test("same key + body ⇒ stored response; other body ⇒ E_CONFLICT; expired after 10 min (FakeClock)", async () => {
    const clock = fakeClock();
    const db = migrate(sqliteDb(), SERVER_STATE_MIGRATIONS);
    const store = createIdempotencyStore({ db, write: createStateQueue({ db, metrics: noopMetrics, dev: true }), clock, table: "srv_idempotency_global" });
    const res = { status: 200, headers: { "content-type": "application/json", "x-mitori-rev": "3" }, body: new TextEncoder().encode('{"ok":true}') };
    expect(store.lookup("k", "POST /x /x", "h1")).toBeNull();
    await store.save("k", "POST /x /x", "h1", res);
    expect(store.lookup("k", "POST /x /x", "h1")).toEqual(res);
    expect(() => store.lookup("k", "POST /x /x", "h2")).toThrow(MitoriError);
    expect(() => store.lookup("k", "POST /y /y", "h1")).toThrow("already used");
    clock.advance(599_999);
    expect(store.lookup("k", "POST /x /x", "h1")).not.toBeNull();
    clock.advance(1);
    expect(store.lookup("k", "POST /x /x", "h2")).toBeNull(); // expired: the key is free again
    await store.save("other", "POST /x /x", "h3", res); // prunes expired rows
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM srv_idempotency_global")?.n).toBe(1);
  });

  test("keys are 1–200 printable ASCII characters", () => {
    expect(() => checkIdempotencyKey("ok-key_1")).not.toThrow();
    for (const bad of ["", "a b", "x".repeat(201), "é", "a\nb"]) expect(() => checkIdempotencyKey(bad)).toThrow();
  });
});
