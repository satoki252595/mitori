/**
 * Reader pure parts: outline index (numbers, pages = file changes, TOC states, verdict counters), page assembly
 * from page / child views, j/k stepping over hidden blocks, L3 runs, block windowing (ux.md §12.8), cite parsing
 * and the code window cap (≤ 400 mounted lines).
 */
import { describe, expect, test } from "bun:test";
import type { BlockView, DocOutline, SectionNode, SectionView } from "@mitori/core";
import { UI_THRESHOLDS } from "../contract.ts";
import { codeWindow, editorUrl, invalidateCode, loadCode, parseCite } from "./code.ts";
import { columnKinds, factCite } from "./decorate.ts";
import { indexOutline, pageSections, readingMinutes, subtreeStats, tocState } from "./outline.ts";
import { buildPage, isTitleBlock, l3Runs, sectionsToFetch, stepBlock } from "./page.ts";
import { estimateBlockPx, visibleWindows, windowOf } from "./virtual.ts";

const node = (id: string, file: string, children: string[] = [], state = "generated"): SectionNode =>
  ({ id, title: id, file, children, state, readingSec: 120 }) as unknown as SectionNode;

function outline(): DocOutline {
  return {
    sections: [
      node("s0", "doc/00.md"),
      node("s3", "doc/03.md", ["s3/a", "s3/b"]),
      node("s3/a", "doc/03.md"),
      node("s3/b", "doc/03-b.md"),
      node("s6", "doc/06.md", [], "pending"),
      node("appendix", "doc/A.md", [], "static_only"),
    ],
    // [id, section, kind, depth, verdict, cites, fresh]
    blocks: [
      ["b_1", "s3", "prose", "L1", "verified", 1, "fresh"],
      ["b_2", "s3/a", "prose", "L2", "inferred", 1, "fresh"],
      ["b_3", "s3/a", "prose", "L2", null, 0, "stale"],
    ],
  } as unknown as DocOutline;
}

const blk = (id: string, section: string, ord: number, depth = "L1", kind = "prose"): BlockView => ({ id, section, ord, depth, kind }) as unknown as BlockView;

describe("outline index", () => {
  const ix = indexOutline(outline());
  test("numbers, TOC order, pages split where the file changes", () => {
    expect([...ix.numbers.entries()]).toEqual([
      ["s0", "0"],
      ["s3", "3"],
      ["s3/a", "3.1"],
      ["s3/b", "3.2"],
      ["s6", "6"],
      ["appendix", "A"],
    ]);
    expect(ix.pages).toEqual(["s0", "s3", "s3/b", "s6", "appendix"]);
    expect(ix.pageOf.get("s3/a" as never)).toBe("s3");
    expect(pageSections(ix, "s3" as never)).toEqual(["s3", "s3/a"]);
  });

  test("verdict / freshness counters roll up; TOC state glyphs", () => {
    expect(subtreeStats(ix, "s3" as never)).toEqual({ blocks: 3, verified: 1, inferred: 1, stale: 1, unsupported: 0 });
    expect(tocState(ix.nodes.get("s3" as never) as SectionNode, subtreeStats(ix, "s3" as never))).toBe("stale");
    expect(tocState(ix.nodes.get("s6" as never) as SectionNode, undefined)).toBe("pending");
    expect(tocState(ix.nodes.get("appendix" as never) as SectionNode, undefined)).toBe("static");
    expect(tocState(ix.nodes.get("s0" as never) as SectionNode, undefined)).toBe("generated");
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(150)).toBe(3);
  });

  test("a page is assembled from its own view or its children's views, in ord order", () => {
    const views = new Map<string, SectionView>([
      ["s3", { blocks: [blk("b_1", "s3", 0)] } as unknown as SectionView],
      ["s3/a", { blocks: [blk("b_3", "s3/a", 2), blk("b_2", "s3/a", 1)] } as unknown as SectionView],
    ]);
    const have = (id: string) => views.get(id);
    expect(sectionsToFetch(ix, "s3" as never, () => undefined)).toEqual(["s3/a"]);
    expect(sectionsToFetch(ix, "s3" as never, have as never)).toEqual([]);
    const page = buildPage(ix, "s3" as never, have as never);
    expect(page.order).toEqual(["b_1", "b_2", "b_3"]);
    expect(page.parts.map((p) => [p.node.id, p.top, p.num, p.loaded])).toEqual([
      ["s3", true, "3", true],
      ["s3/a", false, "3.1", true],
    ]);
    // the page view may already include descendants' blocks
    const one = new Map([["s3", { blocks: [blk("b_1", "s3", 0), blk("b_2", "s3/a", 1)] } as unknown as SectionView]]);
    expect(sectionsToFetch(ix, "s3" as never, (id) => one.get(id))).toEqual([]);
    expect(buildPage(ix, "s3" as never, (id) => one.get(id)).order).toEqual(["b_1", "b_2"]);
  });
});

describe("j / k and L3 runs", () => {
  test("stepBlock skips hidden blocks and stops at the ends", () => {
    const order = ["b_a", "b_b", "b_c", "b_d"] as const;
    const vis = (id: string) => id !== "b_b";
    expect(stepBlock(order, null, 1, vis)).toBe("b_a");
    expect(stepBlock(order, "b_a", 1, vis)).toBe("b_c");
    expect(stepBlock(order, "b_c", -1, vis)).toBe("b_a");
    expect(stepBlock(order, "b_d", 1, vis)).toBeNull();
    expect(stepBlock(order, null, -1, vis)).toBe("b_d");
  });

  test("runs of consecutive L3 / deepdive blocks", () => {
    const runs = l3Runs([blk("b_a", "s", 0), blk("b_b", "s", 1, "L3"), blk("b_c", "s", 2, "L2", "deepdive"), blk("b_d", "s", 3), blk("b_e", "s", 4, "L3")]);
    expect([...runs.entries()]).toEqual([
      ["b_b", 2],
      ["b_e", 1],
    ]);
  });
});

describe("block windowing (§12.8)", () => {
  test("viewport ± one window, clamped; beyond the content keeps an end window", () => {
    const h = [1000, 1000, 1000, 1000, 1000];
    expect(visibleWindows(h, 0, 2100, 2900)).toEqual({ first: 1, last: 3 });
    expect(visibleWindows(h, 0, 0, 800)).toEqual({ first: 0, last: 1 });
    expect(visibleWindows(h, 0, 9000, 9800)).toEqual({ first: 3, last: 4 });
    expect(visibleWindows([], 0, 0, 100)).toEqual({ first: 0, last: -1 });
    expect(windowOf(149, UI_THRESHOLDS.blockWindow)).toBe(2);
    expect(estimateBlockPx(37 / 8.33)).toBeCloseTo(30.4 + 14, 5);
  });
});

describe("code pane", () => {
  test("parseCite", () => {
    expect(parseCite("internal/daemon/daemon.go:178-193")).toEqual({ path: "internal/daemon/daemon.go", start: 178, end: 193 });
    expect(parseCite("a:b.go:9")).toEqual({ path: "a:b.go", start: 9, end: 9 });
    expect(parseCite("nope")).toBeNull();
    expect(parseCite("x.go:L9")).toBeNull();
  });

  test("⇧O editor deep link: segments percent-encoded, separators and a drive letter kept", () => {
    expect(editorUrl("vscode", "/Users/me/my repo/", "internal/a#b?.go", 40)).toBe("vscode://file/Users/me/my%20repo/internal/a%23b%3F.go:40");
    expect(editorUrl("cursor", "C:\\work\\crit", "cmd/main.go", 7)).toBe("cursor://file/C:/work/crit/cmd/main.go:7");
  });

  test("index.changed drops cached windows of the changed files only", async () => {
    const calls: string[] = [];
    const api = {
      call: async (_k: string, a: { query: { path: string } }) => {
        calls.push(a.query.path);
        return { path: a.query.path };
      },
    } as never;
    const ws = "ws_cache0000000" as never;
    await loadCode(api, ws, "a.go", 1, 10);
    await loadCode(api, ws, "b.go", 1, 10);
    await loadCode(api, ws, "a.go", 1, 10);
    expect(calls).toEqual(["a.go", "b.go"]);
    expect(invalidateCode(ws, ["a.go"])).toBe(true);
    expect(invalidateCode(ws, ["zzz.go"])).toBe(false);
    await loadCode(api, ws, "a.go", 1, 10);
    await loadCode(api, ws, "b.go", 1, 10);
    expect(calls).toEqual(["a.go", "b.go", "a.go"]);
  });

  test("±ctx lines around the cite, never more than maxMountedCodeLines", () => {
    expect(codeWindow(100, 110, 40)).toEqual({ start: 60, end: 150 });
    expect(codeWindow(5, 6, 40)).toEqual({ start: 1, end: 46 });
    const w = codeWindow(100, 2000, 40);
    expect(w.end - w.start + 1).toBe(UI_THRESHOLDS.maxMountedCodeLines);
  });
});

describe("CR m1-103 the section title shows once", () => {
  const blk = (id: string, kind: string, html: string, ord: number) => ({ id, kind, html, ord, section: "s4" }) as unknown as BlockView;
  test("the first heading block whose text ends with the title is the page header, not a block", () => {
    const n = { title: "動かしてみる" } as SectionNode;
    expect(isTitleBlock(blk("b_1", "heading", '<div class="mb"><h1>4. 動かしてみる</h1></div>', 0), n)).toBe(true);
    expect(isTitleBlock(blk("b_2", "heading", '<div class="mb"><h2>手順</h2></div>', 0), n)).toBe(false);
    expect(isTitleBlock(blk("b_3", "prose", "<p>4. 動かしてみる</p>", 0), n)).toBe(false);
    expect(isTitleBlock(blk("b_4", "heading", "<h1>A &amp; B</h1>", 0), { title: "A & B" } as SectionNode)).toBe(true);
  });
  test("buildPage drops it from the blocks and the j/k order but remembers it", () => {
    const ix = indexOutline({ ...outline(), sections: [node("s4", "doc/04.md")], blocks: [] });
    const view = { section: "s4", blocks: [blk("b_t", "heading", "<h1>4. s4</h1>", 0), blk("b_p", "prose", "<p>x</p>", 1)] } as unknown as SectionView;
    const m = buildPage(ix, "s4", (id) => (id === "s4" ? view : undefined));
    expect(m.parts[0]?.titleBlock).toBe("b_t");
    expect(m.parts[0]?.blocks.map((b) => b.id)).toEqual(["b_p"]);
    expect(m.order).toEqual(["b_p"]);
  });
});

describe("M1 §5-7 comfortable tables: short / numeric columns and fact cites", () => {
  test("columns: every cell short ⇒ short, numeric ⇒ num, long prose ⇒ null", () => {
    const rows = [
      ["test", "e2e", "cd test/e2e && bash run.sh", "Makefile:87", "未実行", "4,611"],
      ["test", "e2e-failed", "cd test/e2e && npx playwright test --last-failed", "Makefile:90", "未実行", "12 ms"],
      ["build", "e2e-gitlab-roundtrip", "./scripts/e2e-gitlab-roundtrip.sh", "Makefile:74", "—", "35%"],
    ];
    expect(columnKinds(rows, 6)).toEqual(["short", "short", null, "short", "short", "num"]);
    expect(columnKinds([["3行"], ["12件"], ["—"]], 1)).toEqual(["num"]);
  });
  test("fact cites: repo paths with a line, never host:port or bare words", () => {
    expect(factCite("internal/server/server.go:224")).toEqual({ path: "internal/server/server.go", start: 224, end: 224 });
    expect(factCite("Makefile:87")).toEqual({ path: "Makefile", start: 87, end: 87 });
    expect(factCite("package.json:5-9")).toEqual({ path: "package.json", start: 5, end: 9 });
    for (const x of ["localhost:8080", "example.com:443", "ANY", "server.go", "a.go:0", "x.go:9-3"]) expect(factCite(x)).toBeNull();
  });
});
