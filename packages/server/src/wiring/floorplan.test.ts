import { expect, test } from "bun:test";
import type { DiagramIR, DiagramLayout, ModuleInfo } from "@mitori/core";
import { type DiagramLayouter, type DocStore, floorplanLayout, floorplanQuality } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { floorZone } from "./static-input.ts";
import { mapView, type ViewCtx } from "./views.ts";

test("FP-AT-04/05: source LOC dominance, opt-in floorplan, previous order and quality fallback", async () => {
  const modules = [
    { id: "md_00000001", slug: "a", name: "A", paths: ["src/a.ts"], children: [], loc: 100 },
    { id: "md_00000002", slug: "b", name: "B", paths: ["src/b.ts"], children: [], loc: 400 },
  ] as unknown as ModuleInfo[];
  const indexer = {
    modules: () => modules,
    graph: () => ({
      nodes: modules.map((m) => ({ id: m.id, label: m.name, rank: 1 })),
      edges: [{ from: "md_00000001", to: "md_00000002", kind: "import", weight: 1 }],
    }),
    facts: () => [],
    imports: (p: string) => (p === "cloud.ts" ? [{ external: "@aws-sdk/s3" }] : []),
    file: (p: string) => ({ loc: p === "cli.ts" ? 20 : 100 }),
    symbols: () => [],
    currentText: () => Promise.resolve(""),
  } as unknown as Indexer;
  expect(await floorZone(indexer, ["web/view.js", "cli.ts"])).toBe("ui");
  expect(await floorZone(indexer, ["cloud.ts", "src/a.ts"])).toBe("infra");
  expect(await floorZone(indexer, ["src/a.ts"])).toBe("core");
  const doc = { index: () => ({ modules: [], blocks: {}, diagrams: {} }), section: () => null } as unknown as DocStore;
  let enabled = false,
    bad = false;
  const previous: (DiagramLayout | null)[] = [];
  const layouter = {
    layout: async (ir: DiagramIR) => ({ diagram: ir.id, engine: "container", nodes: [], edges: [], groups: [], width: 1600, height: 1000 }),
    layoutFloorplan: async (ir: DiagramIR, prev: DiagramLayout | null) => {
      previous.push(prev);
      const layout = floorplanLayout(ir, "h", prev);
      return { layout, quality: { ...floorplanQuality(ir, layout, 0), ...(bad ? { labelFit: 0.69 } : {}) } };
    },
  } as unknown as DiagramLayouter;
  const ctx = { doc, floorplan: () => enabled } as ViewCtx;
  const normal = await mapView(ctx, indexer, layouter, () => 0);
  expect(normal.diagram.kind).toBe("container");
  expect(normal.fallback).toBeUndefined();
  expect(previous).toHaveLength(0);
  enabled = true;
  const floor = await mapView(ctx, indexer, layouter, () => 0);
  expect(floor.diagram.kind).toBe("floorplan");
  expect(floor.layout.doors).toHaveLength(1);
  bad = true;
  const fallback = await mapView(ctx, indexer, layouter, () => 0);
  expect(previous[1]).toEqual(floor.layout);
  expect(fallback.diagram.kind).toBe("container");
  expect(fallback.fallback).toBe("container");
  expect(fallback.quality?.labelFit).toBe(0.69);
});
