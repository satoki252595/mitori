import { describe, expect, test } from "bun:test";
import type { DiagramId, DiagramIR, DiagramLayout } from "@mitori/core";
import ELK from "elkjs/lib/elk-api.js";
import { DOC_MIGRATIONS } from "../store/index.ts";
import { hasher, inlinePool, memDb, silentLog } from "../test/helpers.ts";
import { elkLayout, irToElk, sequenceLayout } from "./elk.ts";
import { createDiagramLayouter } from "./index.ts";
import { ROOM_BOX, ROOMS_ENGINE, roomsLayout, roomWidth } from "./rooms.ts";

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

describe("DOC-G-013 AI diagrams with duplicate ids", () => {
  test("duplicate node / group / edge ids are dropped (first wins) before ELK, which rejects duplicate groups", async () => {
    const elk = new ELK({ workerUrl: require.resolve("elkjs/lib/elk-worker.min.js"), workerFactory: (u) => new Worker(u as string) as never });
    try {
      const dup = ir({
        nodes: [...ir().nodes, { id: "csv", label: "again", group: "store" }],
        groups: [
          { id: "store", label: "保存" },
          { id: "store", label: "二重" },
        ],
        edges: [...ir().edges, { id: "e1", from: "end", to: "csv", kind: "calls" }],
      });
      const l = await elkLayout(elk as never, { ir: dup });
      expect([l.nodes.map((n) => n.id), l.groups.map((g) => g.id), l.edges.map((e) => e.id)]).toEqual([["csv", "repo", "end"], ["store"], ["e1", "e2"]]);
      expect(sequenceLayout({ ...dup, kind: "sequence" }, "h").nodes.map((n) => n.id)).toEqual(["csv", "repo", "end"]);
    } finally {
      elk.terminateWorker();
    }
  });
});

describe("DOC-G-013 container map: rooms sized for their labels, zones as bands (M1 §5-1)", () => {
  const map = (zones: number, perZone: number, loose = 0): DiagramIR => {
    const groups = Array.from({ length: zones }, (_, z) => ({ id: `z${z}`, label: `zone ${z}` }));
    const nodes = [
      ...groups.flatMap((g, z) =>
        Array.from({ length: perZone }, (_, i) => ({
          id: `n${z}_${i}`,
          label: i % 3 === 0 ? `internal/session · CritJSON${i}` : `web${i}`,
          sublabel: "internal",
          group: g.id,
          weight: (perZone - i) / perZone,
        })),
      ),
      ...Array.from({ length: loose }, (_, i) => ({ id: `l${i}`, label: `loose${i}` })),
    ];
    return {
      id: "dg_map00000" as DiagramId,
      kind: "container",
      nodes,
      edges: [{ id: "e0", from: nodes[0]?.id ?? "", to: nodes[1]?.id ?? "", kind: "imports" }],
      groups,
      direction: "RIGHT",
      origin: "static",
    };
  };
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test("deterministic, every node placed once, no overlaps, each room wide enough for its label", () => {
    for (const ir of [map(2, 9), map(3, 13, 2), map(0, 0, 5), map(1, 1)]) {
      const a = roomsLayout(ir, "h");
      expect(roomsLayout(ir, "h")).toEqual(a);
      expect(a.engine).toBe(ROOMS_ENGINE);
      expect(a.nodes.map((n) => n.id).sort()).toEqual(ir.nodes.map((n) => n.id).sort());
      for (const [i, n] of a.nodes.entries()) {
        for (const v of [n.x, n.y, n.w, n.h]) expect(v * 2).toBe(Math.round(v * 2));
        const src = ir.nodes.find((x) => x.id === n.id);
        expect(n.w + 0.5).toBeGreaterThanOrEqual(roomWidth(src?.label ?? "", src?.sublabel));
        expect(n.h).toBe(ROOM_BOX.h);
        for (const m of a.nodes.slice(i + 1)) expect(overlaps(n, m)).toBe(false);
        const g = a.groups.find((x) => x.id === src?.group);
        if (g) expect(n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w + 0.5 && n.y + n.h <= g.y + g.h + 0.5).toBe(true);
      }
    }
  });

  test("the plan is close to 16:10 – 1.75 (readable at the fit zoom of a laptop or tablet stage)", () => {
    for (const ir of [map(2, 9), map(4, 10), map(1, 40)]) {
      const l = roomsLayout(ir, "h");
      expect(l.width / l.height).toBeGreaterThan(1.2);
      expect(l.width / l.height).toBeLessThan(2.4);
    }
  });

  test("zones are full-width bands; rows are balanced (no lone room on a last row) and justified", () => {
    const l = roomsLayout(map(2, 9), "h");
    const [g0, g1] = l.groups;
    expect(g0?.w).toBe(g1?.w);
    const rows = new Map<number, number>();
    for (const n of l.nodes.filter((x) => x.id.startsWith("n0_"))) rows.set(n.y, (rows.get(n.y) ?? 0) + 1);
    const counts = [...rows.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    for (const y of rows.keys()) {
      const row = l.nodes.filter((x) => x.id.startsWith("n0_") && x.y === y);
      const right = Math.max(...row.map((n) => n.x + n.w));
      expect(Math.abs(right - ((g0?.x ?? 0) + (g0?.w ?? 0) - 10))).toBeLessThan(1);
    }
  });

  test("the layouter lays container maps out in-thread (no ELK call) and caches them", async () => {
    let calls = 0;
    const l = createDiagramLayouter({
      elk: inlinePool(() => {
        calls++;
        return {} as DiagramLayout;
      }),
      db: memDb(DOC_MIGRATIONS),
      hasher,
      log: silentLog,
    });
    const a = await l.layout(map(2, 4));
    expect(a.engine).toBe(ROOMS_ENGINE);
    expect(a.edges).toHaveLength(1);
    expect(calls).toBe(0);
  });
});
