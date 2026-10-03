/**
 * WEB-U-024 palette store ↔ worker protocol (the real `PaletteState` over the real `runQuery`, through an
 * in-process fake Worker): latest query id only (stale replies are dropped), the index is fetched once per
 * workspace, action items reach the worker even when they change after the index load (language switch).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import type { PaletteItem } from "@mitori/core";
import type { PaletteActionItem, PaletteWorkerMsg, PaletteWorkerReply } from "../contract.ts";
import { buildIndex, type PaletteIndexState, runQuery } from "../palette/search.ts";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
let PaletteState: typeof import("./palette.svelte.ts").PaletteState;
beforeAll(async () => {
  ({ PaletteState } = await import("./palette.svelte.ts"));
});

/** A worker whose replies are released by hand, so tests can reorder them. */
class FakeWorker {
  onmessage: ((e: MessageEvent<PaletteWorkerReply>) => void) | null = null;
  ix: PaletteIndexState = buildIndex(0, [], []);
  pending: PaletteWorkerReply[] = [];
  loads = 0;
  postMessage(m: PaletteWorkerMsg) {
    if (m.t === "load") {
      this.loads++;
      this.ix = buildIndex(m.rev, m.items, m.actions);
      this.pending.push({ t: "loaded", rev: m.rev, n: this.ix.entries.length, ms: 0 });
    } else if (m.t === "query") {
      const r = runQuery(this.ix, m.q, m.scope, m.groupMax);
      this.pending.push({ t: "results", id: m.id, ms: 0.1, total: r.total, groups: r.groups, counts: r.counts, top: r.top } as PaletteWorkerReply);
    }
  }
  flush(order?: number[]) {
    const list = order ? order.map((i) => this.pending[i] as PaletteWorkerReply) : this.pending;
    this.pending = [];
    for (const r of list) this.onmessage?.({ data: r } as MessageEvent<PaletteWorkerReply>);
  }
}

const ITEMS: PaletteItem[] = [
  { k: "t", i: "gl_mochikos", l: "持ち越し", y: "もちこし", r: "mochikoshi", al: ["carry-forward"], h: "/g" },
  { k: "y", i: "a.go#carryForwardComments", l: "carryForwardComments", s: "a.go:1", h: "/c", via: "gl_mochikos" },
];

function setup() {
  const w = new FakeWorker();
  let fetches = 0;
  const api = {
    call: async () => {
      fetches++;
      return { digest: "0", rev: 3, items: ITEMS };
    },
  } as unknown as ApiClient;
  const p = new PaletteState(
    api,
    () => "ws_cr1t00000000" as never,
    () => w as unknown as Worker,
  );
  return { p, w, fetches: () => fetches };
}

const action = (l: string): PaletteActionItem => ({ k: "a", i: "action.themeDark", l, al: [] });

describe("WEB-U-024 palette store", () => {
  test("index fetched once per workspace; the query is re-sent after `loaded`", async () => {
    const { p, w, fetches } = setup();
    p.show("carry");
    await Bun.sleep(0);
    p.hide();
    p.show("carry");
    await Bun.sleep(0);
    expect(fetches()).toBe(1);
    w.flush();
    w.flush();
    expect(p.status).toBe("ready");
    expect(p.results[0]?.items[0]?.label).toBe("持ち越し");
    expect(p.top).toEqual({ group: "term", id: "gl_mochikos" });
  });

  test("a reply for an older query id is never rendered (AC-U70)", async () => {
    const { p, w } = setup();
    p.show("");
    await Bun.sleep(0);
    w.flush();
    p.setQuery("mochi");
    p.setQuery("carryForwardCom");
    // replies arrive out of order: newest first, then the stale one
    w.flush([1, 0]);
    expect(p.query).toBe("carryForwardCom");
    expect(p.results.flatMap((g) => g.items.map((i) => i.label))).toContain("carryForwardComments");
    expect(p.results.flatMap((g) => g.items.map((i) => i.label))).not.toContain("持ち越し");
  });

  test("actions set after the index load (and on a language switch) are re-sent; identical ones are not", async () => {
    const { p, w } = setup();
    p.show("");
    await Bun.sleep(0);
    w.flush();
    const loads = w.loads;
    p.setActions([action("Theme: dark")]);
    expect(w.loads).toBe(loads + 1);
    p.setActions([action("Theme: dark")]);
    expect(w.loads).toBe(loads + 1);
    p.setActions([action("テーマ: ダーク")]);
    expect(w.loads).toBe(loads + 2);
    w.flush();
    p.setQuery("テーマ");
    w.flush();
    expect(p.results.find((g) => g.group === "action")?.items[0]?.label).toBe("テーマ: ダーク");
  });

  test("an empty query clears results and the top hit without asking the worker", async () => {
    const { p, w } = setup();
    p.show("carry");
    await Bun.sleep(0);
    w.flush();
    w.flush();
    p.setQuery("  ");
    expect(w.pending).toEqual([]);
    expect(p.results).toEqual([]);
    expect(p.top).toBeNull();
  });
});
