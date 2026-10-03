/** S1 map pure parts (ux.md §4.2.3, UXP-15): camera maths, zoom stages, LOD, plan model + SVG, engine problems. */
import { describe, expect, test } from "bun:test";
import type { EngineStatus, MapView } from "@mitori/core";
import { ROOM_LOD, UI_THRESHOLDS } from "../contract.ts";
import { cameraForK, centreOn, fitCamera, K_MAX, K_MIN, lerpCamera, lodClass, STAGE_K, stageOf, stepStageK, zoomAt } from "./camera.ts";
import { engineProblem } from "./engine.ts";
import { buildPlanModel, FLOW_BULGE, flowGeometry, type PlanModel, renderFlow, renderPins, renderPlanSvg, type RoomModel } from "./render.ts";

describe("camera", () => {
  const vp = { w: 1000, h: 600 };
  test("fit centres the content inside the padding", () => {
    const c = fitCamera(2000, 1000, vp, 20);
    expect(c.s).toBeCloseTo(0.48, 5);
    expect(c.x).toBeCloseTo((1000 - 2000 * c.s) / 2, 5);
    expect(c.y).toBeCloseTo((600 - 1000 * c.s) / 2, 5);
  });

  test("zoomAt keeps the screen point fixed and clamps k to [K_MIN, K_MAX]", () => {
    const c0 = { s: 1, x: 10, y: 20 };
    const c1 = zoomAt(c0, 2, 300, 200, 1);
    // the world point under (300, 200) is the same before and after
    expect((300 - c0.x) / c0.s).toBeCloseTo((300 - c1.x) / c1.s, 6);
    expect((200 - c0.y) / c0.s).toBeCloseTo((200 - c1.y) / c1.s, 6);
    expect(zoomAt(c0, 100, 0, 0, 1).s).toBe(K_MAX);
    expect(zoomAt(c0, 0.001, 0, 0, 1).s).toBe(K_MIN);
  });

  test("stages from k; Z3 only with a large room and when allowed", () => {
    expect(stageOf(UI_THRESHOLDS.mapZoomK.z0 - 0.01, false, true)).toBe("Z0");
    expect(stageOf(UI_THRESHOLDS.mapZoomK.z1 - 0.01, false, true)).toBe("Z1");
    expect(stageOf(1, false, true)).toBe("Z2");
    expect(stageOf(1, true, true)).toBe("Z3");
    expect(stageOf(1, true, false)).toBe("Z2");
    // every stage target k lands in its own stage
    for (const z of ["Z0", "Z1", "Z2"] as const) expect(stageOf(STAGE_K[z], false, false)).toBe(z);
  });

  test("= / - step through the stage ks and stay inside the clamp", () => {
    expect(stepStageK(STAGE_K.Z0, 1, false)).toBe(STAGE_K.Z1);
    expect(stepStageK(STAGE_K.Z1, 1, false)).toBe(STAGE_K.Z2);
    expect(stepStageK(STAGE_K.Z2, -1, false)).toBe(STAGE_K.Z1);
    expect(stepStageK(STAGE_K.Z0, -1, false)).toBeGreaterThanOrEqual(K_MIN);
    expect(stepStageK(K_MAX, 1, false)).toBeLessThanOrEqual(K_MAX);
  });

  test("cameraForK hits the requested k; centreOn centres the rect; lerp ends at its endpoints", () => {
    const fit = fitCamera(1000, 500, vp);
    const c = cameraForK(fit, STAGE_K.Z1, fit.s, vp);
    expect(c.s / fit.s).toBeCloseTo(STAGE_K.Z1, 6);
    const cc = centreOn({ x: 100, y: 100, w: 200, h: 100 }, 2, vp);
    expect(200 * 2 + cc.x).toBeCloseTo(vp.w / 2, 6);
    expect(150 * 2 + cc.y).toBeCloseTo(vp.h / 2, 6);
    const a = { s: 1, x: 0, y: 0 };
    const b = { s: 4, x: 100, y: -50 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    const end = lerpCamera(a, b, 1);
    expect(end.s).toBeCloseTo(4, 9);
    expect(end.x).toBeCloseTo(100, 9);
  });

  test("LOD classes follow ROOM_LOD and the large-room threshold", () => {
    for (const r of ROOM_LOD.filter((x) => Number.isFinite(x.maxW))) expect(lodClass(r.maxW, r.maxH)).toBe(r.cls);
    expect(lodClass(UI_THRESHOLDS.roomLg.w, UI_THRESHOLDS.roomLg.h)).toBe("lg");
    expect(lodClass(300, 160)).toBe("md");
  });
});

function view(): MapView {
  const box = (id: string, x: number, y: number) => ({ id, x, y, w: 100, h: 60 });
  return {
    fallback: "container",
    diagram: {
      id: "dg_t",
      kind: "container",
      direction: "RIGHT",
      origin: "static",
      groups: [
        { id: "g_a", label: "入口" },
        { id: "g_b", label: "<core> & co" },
      ],
      nodes: [
        { id: "md_b", label: "B", group: "g_a", ref: { module: "md_b" } },
        { id: "md_a", label: "A", group: "g_a", ref: { module: "md_a", section: "s6/a" } },
        { id: "md_c", label: 'C "x"', group: "g_b", ref: { module: "md_c" } },
        { id: "ext", label: "ブラウザ", shape: "actor" },
      ],
      edges: [{ id: "e1", from: "md_a", to: "md_c" }],
    },
    layout: {
      width: 400,
      height: 300,
      groups: [
        { id: "g_a", x: 0, y: 0, w: 200, h: 300 },
        { id: "g_b", x: 200, y: 0, w: 200, h: 300 },
      ],
      nodes: [box("md_b", 10, 120), box("md_a", 10, 30), box("md_c", 210, 30), box("ext", 300, 240)],
      edges: [
        {
          id: "e1",
          points: [
            [60, 60],
            [260, 60],
          ],
        },
      ],
    },
    modules: [
      { id: "md_a", name: "a", paths: ["internal/a/x.go", "internal/a/y.go"], children: [], loc: 1200 },
      { id: "md_b", name: "b", paths: ["internal/b/z.go"], children: [], loc: 300 },
      { id: "md_c", name: "c", paths: ["web/c.ts"], children: [], loc: 50 },
    ],
    overlays: { comments: { md_a: 2 }, working: { md_c: 1 }, freshness: { md_a: "stale" } },
  } as unknown as MapView;
}

describe("plan model + SVG (AC-J06 / AC-U75)", () => {
  test("rooms in roving order (zone, then rows), paths and overlays", () => {
    const m = buildPlanModel(view());
    expect(m.rooms.map((r) => r.id)).toEqual(["md_a", "md_b", "md_c", "ext"]);
    const a = m.byId.get("md_a");
    expect(a?.path).toBe("internal/a");
    expect(a?.files).toBe(2);
    expect(a?.threads).toBe(2);
    expect(a?.fresh).toBe("stale");
    expect(a?.section).toBe("s6/a");
    expect(m.byId.get("ext")?.external).toBe(true);
    expect([...(m.links.get("md_c") ?? [])]).toEqual(["md_a"]);
  });

  test("one SVG: escaped labels, rooms as focusable links (one tab stop), zone labels in a clipped top layer", () => {
    const m = buildPlanModel(view());
    const svg = renderPlanSvg(m, { title: "map", roomHref: (r) => `/w/x?room=${r.id}`, roomLabel: (r) => r.label }, "desc");
    expect(svg).toContain("&#60;core&#62; &#38; co");
    expect(svg).toContain("C &#34;x&#34;");
    expect(svg.match(/tabindex="0"/g)?.length).toBe(1);
    expect(svg.match(/tabindex="-1"/g)?.length).toBe(3);
    // zone names come after the rooms (never hidden under a wall) and are clipped by their zone's viewport
    expect(svg.indexOf('class="zlabels"')).toBeGreaterThan(svg.indexOf('class="rooms"'));
    expect(svg).toMatch(/<svg class="zl" x="0" y="0" width="200" height="300">/);
    expect(svg).not.toContain('overflow="visible"><g class="lbl"><text class="zn"');
    expect(renderPins(m, { md_a: 3, md_b: 0 })).toContain(">3</text>");
    expect(renderPins(m, { md_a: 3, md_b: 0 }).match(/class="pin"/g)?.length).toBe(1);
  });
});

describe("UXP-15 / AC-U-EN engine problems", () => {
  const base: EngineStatus = {
    engine: "claude-cli",
    installed: true,
    version: "2.1.0",
    auth: "subscription",
    plan: "max5",
    capabilities: [],
    billing: "subscription-window",
    problems: [],
    dataPolicyKey: "claude-cli.max",
    checkedAt: "2026-10-03T00:00:00Z",
  } as EngineStatus;
  test.each([
    [{}, null],
    [{ installed: false }, "notInstalled"],
    [{ auth: "none" }, "notLoggedIn"],
    [{ problems: [{ code: "E_AGENT_AUTH", message: "" }] }, "notLoggedIn"],
    [{ problems: [{ code: "E_AGENT_CAPABILITY", message: "" }] }, "capabilityLost"],
    [{ engine: "session", installed: false }, null],
  ] as const)("%j ⇒ %s", (patch, want) => {
    expect(engineProblem({ ...base, ...(patch as Partial<EngineStatus>) } as EngineStatus)).toBe(want);
  });
  test("no status yet ⇒ no card", () => expect(engineProblem(null)).toBeNull());
});

describe("§3 flow overlay geometry (ux.md §4.2.3)", () => {
  const room = (id: string, x: number, y: number): RoomModel =>
    ({ id, x, y, w: 100, h: 60, label: id, path: "", loc: 0, files: 0, zone: null, zoneLabel: "", section: null, module: null, external: false, threads: 0, working: 0, fresh: "unknown", topSymbols: [] }) as RoomModel;
  const rooms = [room("a", 0, 0), room("b", 400, 0), room("c", 400, 300)];
  const m = { width: 600, height: 400, rooms, zones: [], edges: [], byId: new Map(rooms.map((r) => [r.id, r])), links: new Map() } as PlanModel;

  test("one-way steps are straight between the room walls; tags at the midpoint", () => {
    const [g] = flowGeometry(m, [{ from: "a", to: "b", step: 1 }]);
    expect(g?.d).toBe("M104 30L396 30");
    expect(g?.tag).toEqual({ x: 250, y: 30 });
  });

  test("a there-and-back pair bulges to opposite sides, ≥ 70 units apart at the middle", () => {
    const g = flowGeometry(m, [
      { from: "a", to: "b", step: 1 },
      { from: "b", to: "a", step: 2 },
    ]);
    expect(g.map((x) => x.d.includes("Q"))).toEqual([true, true]);
    const [t1, t2] = g.map((x) => x.tag);
    expect(Math.abs((t1?.y ?? 0) - (t2?.y ?? 0))).toBeGreaterThanOrEqual(FLOW_BULGE - 1e-6);
  });

  test("unknown nodes and self loops are skipped; numbers are the step numbers", () => {
    expect(flowGeometry(m, [{ from: "a", to: "zz", step: 1 }, { from: "c", to: "c", step: 2 }])).toEqual([]);
    const svg = renderFlow(m, [{ from: "a", to: "c", step: 3 }]);
    expect(svg).toContain('marker-end="url(#pl-arrow)"');
    expect(svg).toContain(">3</text>");
  });
});
