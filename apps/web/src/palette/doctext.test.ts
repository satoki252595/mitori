/**
 * NC-09 the document's text index (DocText): sections the Reader holds are reused, the others fetched once; a page
 * view covers its same-file children; block upserts patch their entry; an outline change re-reads only the
 * changed sections; a workspace switch starts over. Memory: no HTML is retained.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { BlockId, BlockView, DocOutline, OutlineBlock, SectionId, SectionNode, SectionView, WorkspaceKey } from "@mitori/core";
import { indexOutline } from "../reader/outline.ts";
import { installRunes } from "../stores/__tests__/runes.ts";

installRunes();
let DocText: typeof import("./doctext.svelte.ts").DocText;
beforeAll(async () => {
  ({ DocText } = await import("./doctext.svelte.ts"));
});

const blk = (id: string, section: string, text: string): BlockView =>
  ({ id: id as BlockId, section: section as SectionId, kind: "prose", status: "ready", html: `<div class="mb"><p>${text}</p></div>` }) as BlockView;

function outline(rev: number, secs: { id: string; blocks: string[]; children?: string[]; file?: string }[]): DocOutline {
  const sections = secs.map(
    (s) =>
      ({
        id: s.id,
        title: s.id,
        file: s.file ?? `${s.id}.md`,
        blocks: s.blocks,
        children: s.children ?? [],
        state: "generated",
        readingSec: 60,
      }) as unknown as SectionNode,
  );
  const blocks = secs.flatMap((s) => s.blocks.map((b, i) => [b, s.id, "L1", "prose", null, i, "fresh"] as unknown as OutlineBlock));
  return { outlineRev: rev, sections, blocks, readingPaths: [], glossaryCount: 0 } as unknown as DocOutline;
}

function rig(o0: DocOutline, views: Record<string, SectionView>, cached: Record<string, SectionView> = {}) {
  let o = o0;
  let ws: WorkspaceKey | null = "ws_a" as WorkspaceKey;
  const fetched: string[] = [];
  let listener: ((b: BlockView | { removed: BlockId; section: SectionId }) => void) | null = null;
  const t = new DocText({
    ws: () => ws,
    outline: () => o,
    index: () => indexOutline(o),
    cached: (id) => cached[id],
    load: async (_w, id) => {
      fetched.push(id);
      const v = views[id];
      if (!v) throw new Error(`no ${id}`);
      return v;
    },
    onBlock: (fn) => {
      listener = fn;
      return () => {};
    },
  });
  return {
    t,
    fetched,
    setOutline: (x: DocOutline) => (o = x),
    setWs: (x: string) => (ws = x as WorkspaceKey),
    emit: (b: BlockView | { removed: BlockId; section: SectionId }) => listener?.(b),
  };
}

const view = (id: string, blocks: BlockView[]): SectionView => ({ section: { id } as SectionNode, blocks, breadcrumbs: [] });

describe("NC-09 DocText", () => {
  const o1 = outline(1, [
    { id: "s0", blocks: ["b_00000001"] },
    { id: "s4", blocks: ["b_00000004"], children: ["s4/run"] },
    { id: "s4/run", blocks: ["b_00000041"], file: "s4.md" },
  ]);
  const s0 = view("s0", [blk("b_00000001", "s0", "見取り図は設計書を作る")]);
  // the page s4 carries its same-file child s4/run
  const s4 = view("s4", [blk("b_00000004", "s4", "npm install を実行"), blk("b_00000041", "s4/run", "npm run dev で起動")]);

  test("reuses what the Reader holds, fetches the rest once, a page covers its children; no HTML is kept", async () => {
    const r = rig(o1, { s4 }, { s0 });
    await r.t.ensure();
    expect(r.fetched).toEqual(["s4"]);
    expect(r.t.status).toBe("ready");
    expect(r.t.entries().map((e) => e.block)).toEqual(["b_00000001", "b_00000004", "b_00000041"]);
    expect(r.t.search("起動", 5).hits[0]?.entry.section).toBe("s4/run");
    expect(JSON.stringify(r.t.entries())).not.toContain("<p>");
    await r.t.ensure();
    expect(r.fetched).toEqual(["s4"]);
  });

  test("a block upsert patches its entry; a removal drops it", async () => {
    const r = rig(o1, { s4 }, { s0 });
    await r.t.ensure();
    const v0 = r.t.version;
    r.emit(blk("b_00000001", "s0", "見取り図は localhost で開く"));
    expect(r.t.version).toBeGreaterThan(v0);
    expect(r.t.search("localhost", 5).total).toBe(1);
    r.emit({ removed: "b_00000004" as BlockId, section: "s4" as SectionId });
    expect(r.t.search("install", 5).total).toBe(0);
  });

  test("an outline change re-reads only the sections whose block list changed", async () => {
    const r = rig(o1, { s0, s4, "s4/run": view("s4/run", [blk("b_00000041", "s4/run", "npm run dev で起動"), blk("b_00000042", "s4/run", "ポート 3000")]) });
    await r.t.ensure();
    expect(r.fetched).toEqual(["s0", "s4"]);
    r.setOutline(
      outline(2, [
        { id: "s0", blocks: ["b_00000001"] },
        { id: "s4", blocks: ["b_00000004"], children: ["s4/run"] },
        { id: "s4/run", blocks: ["b_00000041", "b_00000042"], file: "s4.md" },
      ]),
    );
    await r.t.ensure();
    expect(r.fetched).toEqual(["s0", "s4", "s4/run"]);
    expect(r.t.search("3000", 5).total).toBe(1);
  });

  test("a failed section is retried by the next ensure; a workspace switch starts over", async () => {
    const views: Record<string, SectionView> = { s0 };
    const r = rig(o1, views);
    await r.t.ensure();
    expect(r.t.status).toBe("error");
    views.s4 = s4;
    await r.t.ensure();
    expect(r.t.status).toBe("ready");
    expect(r.t.search("install", 5).total).toBe(1);
    r.setWs("ws_b");
    await r.t.ensure();
    expect(r.fetched.filter((x) => x === "s0").length).toBe(2);
  });
});
