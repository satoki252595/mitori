import { expect, test } from "bun:test";
import type { DiagramIR } from "@mitori/core";
import { floorplanLayout, floorplanQuality } from "./floorplan.ts";

const corpus = (await Bun.file(new URL("./__fixtures__/floorplan.corpus.json", import.meta.url)).json()) as { name: string; ir: DiagramIR }[];

test("FP-AT-01/02: eight pinned source scans are deterministic, preserve order and fall back at most 2/8", () => {
  const failed: string[] = [];
  expect(corpus).toHaveLength(8);
  for (const { name, ir: input } of corpus) {
    const ir = input as DiagramIR;
    const layout = floorplanLayout(ir, "h", null);
    expect(floorplanLayout(ir, "h", null)).toEqual(layout);
    expect(floorplanLayout(ir, "h", layout).nodes.map((n) => n.id)).toEqual(layout.nodes.map((n) => n.id));
    const quality = floorplanQuality(ir, layout, 0);
    if (quality.labelFit < 0.7 || quality.doorRatio < 0.45 || quality.rooms > 40) failed.push(name);
    expect(layout.nodes).toHaveLength(ir.nodes.length); // No actors or hard rooms discarded to improve the score.
    for (const door of layout.doors ?? []) {
      if (door.b === null) continue;
      const a = layout.nodes.find((n) => n.id === door.a);
      const b = layout.nodes.find((n) => n.id === door.b);
      if (!a || !b) throw new Error("door has no room");
      const overlap = door.orient === "v" ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      expect(overlap).toBeGreaterThanOrEqual(34);
      expect(ir.edges.some((e) => e.kind === "imports" && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)))).toBe(true);
    }
  }
  expect(failed).toEqual(["excalidraw", "react"]);
});
