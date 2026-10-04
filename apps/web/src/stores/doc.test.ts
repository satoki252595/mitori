import { expect, test } from "bun:test";
import type { ApiClient } from "@mitori/client";
import type { BlockView, SectionId, SectionView, WorkspaceKey } from "@mitori/core";
import type { OutlineIndex } from "../reader/outline.ts";
import { installRunes } from "./__tests__/runes.ts";

installRunes();
const { DocState } = await import("./doc.svelte.ts");

test("freshness reaches loaded and in-flight blocks and does not leak across workspaces", async () => {
  const id = "s1" as SectionId;
  const block = { id: "b_00000000", section: id, freshness: "fresh" } as unknown as BlockView;
  let finish!: (v: SectionView) => void;
  const api = { call: () => new Promise<SectionView>((resolve) => (finish = resolve)) } as unknown as ApiClient;
  const doc = new DocState(api, () => "ws_000000000000" as WorkspaceKey);
  const loading = doc.load(id);
  doc.applyFreshness([block.id], "stale");
  finish({ section: { id }, blocks: [block] } as SectionView);
  await loading;
  expect(doc.section(id)?.blocks[0]?.freshness).toBe("stale");
  doc.applyFreshness([block.id], "fresh");
  expect(doc.section(id)?.blocks[0]?.freshness).toBe("fresh");
  doc.applyFreshness([block.id], "stale");
  doc.upsertBlock(block);
  expect(doc.section(id)?.blocks[0]?.freshness).toBe("fresh");
  doc.reset();
  expect(doc.freshness.size).toBe(0);
});

test("anchor HTML arrives first, idle windows preserve SSE upserts/removals/freshness and reset drops late replies", async () => {
  const id = "s1" as SectionId;
  const blocks = Array.from({ length: 400 }, (_, ord) => ({
    id: `b_${String(ord).padStart(8, "0")}`,
    section: id,
    ord,
    hash: "0".repeat(16),
    freshness: "fresh",
    html: `<p>block ${ord}</p>`,
    claimViews: [],
  })) as unknown as BlockView[];
  const response = (from: number, sliced: boolean): SectionView =>
    ({
      section: { id },
      total: blocks.length,
      from,
      breadcrumbs: [],
      blocks: sliced ? blocks.slice(from, from + 150) : blocks.map((b, i) => ({ ...b, html: i >= from && i < from + 150 ? b.html : "" })),
    }) as unknown as SectionView;
  const calls: { from?: number; limit?: number; outline?: boolean }[] = [];
  const idle: IdleRequestCallback[] = [];
  const oldIdle = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (cb) => {
    idle.push(cb);
    return idle.length;
  };
  let finish!: (v: SectionView) => void;
  const api = {
    call: (_key: string, opts: { query: { from: number; limit: number; outline?: boolean } }) => {
      calls.push(opts.query);
      return opts.query.outline === false ? new Promise<SectionView>((resolve) => (finish = resolve)) : Promise.resolve(response(opts.query.from, false));
    },
  } as unknown as ApiClient;
  let ws = "ws_000000000000" as WorkspaceKey;
  const doc = new DocState(api, () => ws);
  const b10 = blocks[10] as BlockView;
  const b11 = blocks[11] as BlockView;
  const b12 = blocks[12] as BlockView;
  doc.index = { nodes: new Map([[id, { blocks: blocks.map((b) => b.id) }]]) } as unknown as OutlineIndex;
  try {
    await doc.load(id, { anchor: blocks[325]?.id });
    expect(calls[0]).toMatchObject({ from: 275, limit: 150 });
    expect(doc.section(id)?.blocks[325]?.html).toContain("block 325");
    expect(doc.section(id)?.blocks[0]?.html).toBe("");
    idle.shift()?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(calls[1]).toMatchObject({ from: 0, limit: 150, outline: false });
    doc.applyFreshness([b10.id], "stale");
    doc.upsertBlock({ ...b11, html: "<p>new SSE body</p>", hash: "1".repeat(16) as BlockView["hash"] });
    doc.removeBlock(b12.id, id);
    finish(response(0, true));
    await Bun.sleep(0);
    const current = (doc.section(id) as SectionView).blocks;
    expect(current.find((b) => b.id === b10.id)).toMatchObject({ freshness: "stale", html: "<p>block 10</p>" });
    expect(current.find((b) => b.id === b11.id)?.html).toBe("<p>new SSE body</p>");
    expect(current.some((b) => b.id === b12.id)).toBe(false);
    expect(current.map((b) => b.id)).toEqual(blocks.filter((b) => b.id !== b12.id).map((b) => b.id));
    idle.shift()?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    doc.reset();
    ws = "ws_000000000001" as WorkspaceKey;
    finish(response(150, true));
    await Bun.sleep(0);
    expect(doc.section(id)).toBeUndefined();
  } finally {
    doc.reset();
    globalThis.requestIdleCallback = oldIdle;
  }
});
