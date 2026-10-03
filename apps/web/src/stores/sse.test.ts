/**
 * WEB-U-026 SSE reducer de-duplication: every applied upsert records its envelope `rev`, so an older replay of the
 * same entity (resume after a reconnect, out-of-order delivery) is dropped instead of overwriting newer state.
 */
import { describe, expect, test } from "bun:test";
import type { EntityKey, SseClient } from "@mitori/client";
import type { SseEvent } from "@mitori/core";
import type { Stores } from "./app.svelte.ts";
import { acceptUpsert, wireSse } from "./sse.ts";

function fakeSse() {
  const handlers = new Map<string, (e: SseEvent) => void>();
  const revs = new Map<string, number>();
  const sse = {
    on(type: string, fn: (e: SseEvent) => void) {
      handlers.set(type, fn);
      return () => handlers.delete(type);
    },
    noteRev(k: EntityKey, r: number) {
      revs.set(k, Math.max(revs.get(k) ?? 0, r));
    },
    isStale(k: EntityKey, r: number) {
      return r <= (revs.get(k) ?? -1);
    },
  };
  const emit = (e: Record<string, unknown>) => handlers.get(e.type as string)?.({ seq: 1, at: "", ws: "ws_cr1t00000000", rev: null, ...e } as never);
  return { sse: sse as unknown as SseClient, emit };
}

describe("WEB-U-026 SSE upsert de-dupe", () => {
  test("acceptUpsert records the rev it accepts", () => {
    const { sse } = fakeSse();
    expect(acceptUpsert(sse, "thread:th_1" as EntityKey, { rev: 5 })).toBe(true);
    expect(acceptUpsert(sse, "thread:th_1" as EntityKey, { rev: 5 })).toBe(false);
    expect(acceptUpsert(sse, "thread:th_1" as EntityKey, { rev: 4 })).toBe(false);
    expect(acceptUpsert(sse, "thread:th_1" as EntityKey, { rev: 6 })).toBe(true);
    expect(acceptUpsert(sse, "thread:th_1" as EntityKey, { rev: null })).toBe(true);
  });

  test("an older thread / job replay after a newer one does not overwrite it", () => {
    const { sse, emit } = fakeSse();
    const threads = new Map<string, { id: string; v: number }>();
    const jobs = new Map<string, { id: string; v: number }>();
    const s = { sse, review: { threads, jobs } } as unknown as Stores;
    const off = wireSse(s, { resync() {}, notice() {}, firstBlock() {}, genDone() {} });
    emit({ type: "thread.upsert", rev: 10, thread: { id: "th_1", v: 2 } });
    emit({ type: "thread.upsert", rev: 8, thread: { id: "th_1", v: 1 } });
    emit({ type: "job.upsert", rev: 12, job: { id: "j_1", v: 3 } });
    emit({ type: "job.upsert", rev: 12, job: { id: "j_1", v: 2 } });
    expect(threads.get("th_1")?.v).toBe(2);
    expect(jobs.get("j_1")?.v).toBe(3);
    emit({ type: "thread.upsert", rev: 11, thread: { id: "th_1", v: 3 } });
    expect(threads.get("th_1")?.v).toBe(3);
    off();
  });
});

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
