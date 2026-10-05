import { expect, test } from "bun:test";
import type { DiagramIR, DiagramLayout } from "@mitori/core";
import type { DiagramLayouter } from "@mitori/doc";
import { createWorkerPool } from "@mitori/platform";

test("FP-AT-03: the daemon compute Worker returns 40 actual LOC rooms in 30ms", async () => {
  const onig = await Bun.file(new URL("../../../../node_modules/shiki/dist/onig.wasm", import.meta.url)).bytes();
  const pool = createWorkerPool<{ type: "floorplan"; ir: DiagramIR; prev: DiagramLayout | null }, Awaited<ReturnType<DiagramLayouter["layoutFloorplan"]>>>({
    create: () => {
      const worker = new Worker(new URL("./compute.ts", import.meta.url));
      worker.postMessage({ type: "init", init: { onig } });
      return worker;
    },
  });
  const ir: DiagramIR = {
    id: "dg_floor0001" as DiagramIR["id"],
    kind: "floorplan",
    direction: "RIGHT",
    origin: "static",
    groups: [],
    nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Room ${i}`, loc: 100 + i * 5 })),
    edges: Array.from({ length: 39 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, kind: "imports", weight: 1 })),
  };
  try {
    const first = await pool.run({ type: "floorplan", ir, prev: null });
    const again = await pool.run({ type: "floorplan", ir, prev: first.layout });
    expect(first.layout.engine).toBe("mitori-floorplan@1");
    expect(first.quality.rooms).toBe(40);
    expect(first.quality.layoutMs).toBeLessThanOrEqual(30);
    expect(first.layout.nodes.map((n) => n.loc)).toEqual(expect.arrayContaining(ir.nodes.map((n) => n.loc)));
    expect(again.layout).toEqual(first.layout);
  } finally {
    await pool.close();
  }
});
