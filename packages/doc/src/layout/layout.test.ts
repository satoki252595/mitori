import { describe, expect, test } from "bun:test";
import type { DiagramId, DiagramIR, DiagramLayout } from "@mitori/core";
import { DOC_MIGRATIONS } from "../store/index.ts";
import { hasher, inlinePool, memDb, silentLog } from "../test/helpers.ts";
import { irToElk, sequenceLayout } from "./elk.ts";
import { createDiagramLayouter } from "./index.ts";

const ir = (over: Partial<DiagramIR> = {}): DiagramIR => ({
  id: "dg_00000001" as DiagramId,
  kind: "flow",
  nodes: [
    { id: "csv", label: 'CSV "raw"' },
    { id: "repo", label: "Repo [x]\nline2", group: "store" },
    { id: "end", label: "API | #1;" },
  ],
  edges: [
    { id: "e1", from: "csv", to: "repo", kind: "data", label: "parse" },
    { id: "e2", from: "repo", to: "end", kind: "calls" },
  ],
  groups: [{ id: "store", label: "保存" }],
  direction: "RIGHT",
  origin: "static",
  ...over,
});

describe("DOC-U-014 toMermaid", () => {
  const layouter = createDiagramLayouter({ elk: inlinePool(() => ({}) as DiagramLayout), db: memDb(DOC_MIGRATIONS), hasher, log: silentLog });
  test("flowchart: deterministic, escaped labels, reserved ids, subgraphs", () => {
    const text = layouter.toMermaid(ir());
    expect(text).toBe(
      [
        "flowchart LR",
        '  csv["CSV #quot;raw#quot;"]',
        '  repo["Repo #91;x#93;<br/>line2"]',
        '  n_end["API #124; #35;1#59;"]',
        '  subgraph g_store ["保存"]',
        "    repo",
        "  end",
        "  csv -->|parse| repo",
        "  repo --> n_end",
        "",
      ].join("\n"),
    );
    expect(layouter.toMermaid(ir())).toBe(text);
    expect(layouter.toMermaid(ir({ direction: "DOWN" })).startsWith("flowchart TB\n")).toBe(true);
  });
  test("sequence: participants then messages in seq order", () => {
    const seq = ir({
      kind: "sequence",
      groups: [],
      nodes: [
        { id: "u", label: "利用者" },
        { id: "s", label: "Server; v2" },
      ],
      edges: [
        { id: "m2", from: "s", to: "u", kind: "message", label: "200 OK", seq: 2 },
        { id: "m1", from: "u", to: "s", kind: "message", label: "POST /login", seq: 1 },
      ],
    });
    expect(layouter.toMermaid(seq)).toBe(
      "sequenceDiagram\n  participant u as 利用者\n  participant s as Server#59; v2\n  u->>s: POST /login\n  s->>u: 200 OK\n",
    );
  });
});

describe("DOC-G-013 layouts", () => {
  test("sequence layout is deterministic and rounded to 0.5 px", () => {
    const seq = ir({
      kind: "sequence",
      groups: [],
      nodes: ir().nodes.map(({ group: _g, ...n }) => n),
      edges: ir().edges.map((e, i) => ({ ...e, seq: i + 1 })),
    });
    const a = sequenceLayout(seq, "h");
    expect(sequenceLayout(seq, "h")).toEqual(a);
    for (const n of a.nodes) for (const v of [n.x, n.y, n.w, n.h]) expect(v * 2).toBe(Math.round(v * 2));
    expect(a.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    const y = (i: number) => ((a.edges[i] as DiagramLayout["edges"][number]).points[0] as [number, number])[1];
    expect(y(0)).toBeLessThan(y(1));
  });
  test("IR → ELK: groups are compound nodes, cross-group edges aggregate between the groups", () => {
    const g = irToElk(ir());
    expect(g.children?.map((c) => c.id)).toEqual(["g:store", "n:csv", "n:end"]);
    expect(g.children?.[0]?.children?.map((c) => c.id)).toEqual(["n:repo"]);
    expect(g.edges?.map((e) => [e.sources[0], e.targets[0]])).toEqual([
      ["n:csv", "g:store"],
      ["g:store", "n:end"],
    ]);
  });
  test("layouter caches by IR hash (memory, then DB) and stamps irHash + diagram id", async () => {
    let calls = 0;
    const elk = inlinePool(async (req: { ir: DiagramIR }) => {
      calls++;
      return { diagram: req.ir.id, irHash: "", engine: "elk@0.12.0/layered", width: 10, height: 10, nodes: [], edges: [], groups: [] } as DiagramLayout;
    });
    const db = memDb(DOC_MIGRATIONS);
    const l1 = createDiagramLayouter({ elk, db, hasher, log: silentLog });
    const a = await l1.layout(ir());
    await l1.layout(ir());
    const b = await createDiagramLayouter({ elk, db, hasher, log: silentLog }).layout({ ...ir(), id: "dg_00000002" as DiagramId });
    expect(calls).toBe(1);
    expect(a.irHash).toMatch(/^[0-9a-f]{16}$/);
    expect(b.diagram).toBe("dg_00000002" as DiagramId);
    await l1.layout({ ...ir(), title: "changed" });
    expect(calls).toBe(2);
  });
  test("floor plan layout is WP-18", async () => {
    const l = createDiagramLayouter({ elk: inlinePool(() => ({}) as DiagramLayout), db: memDb(DOC_MIGRATIONS), hasher, log: silentLog });
    await expect(l.layoutFloorplan(ir({ kind: "floorplan" }), null)).rejects.toMatchObject({ code: "E_UNSUPPORTED" });
  });
});
