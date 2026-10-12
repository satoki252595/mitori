/** S1 map pure parts (ux.md §4.2.3, UXP-15): camera maths, zoom stages, LOD, plan model + SVG, engine problems. */
import { describe, expect, test } from "bun:test";
import type { EngineStatus, MapView } from "@mitori/core";
import { buildPlanModel, hydratePlan, MAP_SVG_LABELS, mapSvgPresentation, planData, renderPlanSvg } from "@mitori/core";
import { ROOM_LOD, UI_THRESHOLDS } from "../contract.ts";
import { cameraForK, centreOn, fitCamera, K_MAX, K_MIN, lerpCamera, lodClass, STAGE_K, stageOf, stepStageK, zoomAt } from "./camera.ts";
import { engineProblem, fixSteps, museUpdated, policyAcknowledged } from "./engine.ts";
import { generatedTokens, heroAreas, heroMeta, oneSentence } from "./hero.ts";
import {
  FLOW_BULGE,
  fitText,
  flowGeometry,
  LABEL_FONT,
  type PlanModel,
  pathLine,
  type RoomModel,
  renderFlow,
  renderPins,
  roomLabels,
  textPx,
} from "./render.ts";

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
  test("server presentation round trips JSON without losing roving order, links or localized escaped captions", async () => {
    const v = view();
    const model = buildPlanModel(v);
    const restored = hydratePlan(JSON.parse(JSON.stringify(planData(model))));
    expect(restored.rooms).toEqual(model.rooms);
    expect([...restored.links]).toEqual([...model.links]);
    expect([...restored.byId.keys()]).toEqual([...model.byId.keys()]);
    for (const lang of ["ja", "en"] as const) {
      const catalog = await Bun.file(new URL(`../../i18n/map.${lang}.json`, import.meta.url)).json();
      expect(MAP_SVG_LABELS[lang]).toEqual({ title: catalog["map.aria.plan"], room: catalog["map.aria.room"], files: catalog["map.room.files"] });
      const svg = mapSvgPresentation(v, "ws_000000000000", lang, model);
      expect(svg).toContain(`aria-label="${MAP_SVG_LABELS[lang].title}"`);
      expect(svg).toContain("&#60;core&#62; &#38; co");
      expect(svg).toContain('href="/w/ws_000000000000?room=md_a"');
      expect(svg).not.toContain("<core>");
      expect(svg.match(/tabindex="0"/g)).toHaveLength(1);
    }
  });
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
    const svg = renderPlanSvg(m, { title: "map", roomHref: (r) => `/w/x?room=${r.id}`, roomLabel: (r) => r.label, files: (n) => `${n} files` }, "desc");
    expect(svg).toMatch(/^<svg [^>]*role="group"/);
    expect(svg).toContain("&#60;core&#62; &#38; co");
    expect(svg).toContain("C &#34;x&#34;");
    expect(svg.match(/tabindex="0"/g)?.length).toBe(1);
    expect(svg.match(/tabindex="-1"/g)?.length).toBe(3);
    // zone names come after the rooms (never hidden under a wall) and are clipped by their zone's viewport
    expect(svg.indexOf('class="zlabels"')).toBeGreaterThan(svg.indexOf('class="rooms"'));
    expect(svg).toMatch(/<svg class="zl" data-zone="g_a" x="0" y="0" width="200" height="300">/);
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
  test("generic consent is scoped to the detected provider/model identity", () => {
    const ack = { at: "2026-10-04T00:00:00Z", shownAt: "2026-10-04T00:00:00Z", plan: "generic:one" };
    const status = { ...base, engine: "generic", plan: "generic:one" } as EngineStatus;
    expect(policyAcknowledged("generic", status, ack)).toBe(true);
    expect(policyAcknowledged("generic", { ...status, plan: "generic:two" }, ack)).toBe(false);
    expect(policyAcknowledged("generic", null, ack)).toBe(false);
    expect(policyAcknowledged("generic", status, undefined)).toBe(false);
  });
});

describe("§3 flow overlay geometry (ux.md §4.2.3)", () => {
  const room = (id: string, x: number, y: number): RoomModel =>
    ({
      id,
      x,
      y,
      w: 100,
      h: 60,
      label: id,
      path: "",
      loc: 0,
      files: 0,
      zone: null,
      zoneLabel: "",
      section: null,
      module: null,
      external: false,
      threads: 0,
      working: 0,
      fresh: "unknown",
      topSymbols: [],
      summary: null,
      chips: [],
    }) as RoomModel;
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
    expect(
      flowGeometry(m, [
        { from: "a", to: "zz", step: 1 },
        { from: "c", to: "c", step: 2 },
      ]),
    ).toEqual([]);
    const svg = renderFlow(m, [{ from: "a", to: "c", step: 3 }]);
    expect(svg).toContain('marker-end="url(#pl-arrow)"');
    expect(svg).toContain(">3</text>");
  });
});

describe("labels never clip (M1 §5-1): every part is whole, shortened with …, or hidden", () => {
  const files = (n: number) => `${n} files`;
  const room = {
    label: "internal/session · CritJSON",
    path: "internal/session",
    loc: 14_000,
    files: 12,
    chips: [
      { name: "session.go", size: "3.1k" },
      { name: "watch.go", size: "2.3k" },
    ],
  };

  test("fitText keeps fitting text, shortens with …, and gives up below two characters", () => {
    expect(fitText("crit", 100, LABEL_FONT.name)).toBe("crit");
    const short = fitText("internal/session · CritJSON", 90, LABEL_FONT.name);
    expect(short?.endsWith("…")).toBe(true);
    expect(textPx(short ?? "", LABEL_FONT.name)).toBeLessThanOrEqual(90);
    expect(fitText("見取り図の部屋", 10, LABEL_FONT.name)).toBeNull();
  });

  test("a room sized for its label shows everything; narrower rooms drop the size, then shorten, then hide", () => {
    const full = roomLabels(room, 320, 76, files);
    expect(full).toEqual({ name: room.label, size: true, path: pathLine(room, files), chips: 2 });
    const mid = roomLabels(room, 200, 76, files);
    expect(mid.size).toBe(false);
    expect(mid.name?.endsWith("…")).toBe(true);
    expect(textPx(mid.name ?? "", LABEL_FONT.name)).toBeLessThanOrEqual(200 - 24);
    const low = roomLabels(room, 320, 40, files);
    expect([low.path, low.chips]).toEqual([null, 0]);
    expect(roomLabels(room, 30, 20, files)).toEqual({ name: null, size: false, path: null, chips: 0 });
  });

  test("the path line carries the file count; chips that do not fit are dropped from the end", () => {
    expect(pathLine({ path: "", files: 3 }, files)).toBe("3 files");
    expect(pathLine({ path: "web", files: 0 }, files)).toBe("web");
    expect(roomLabels(room, 150, 76, files).chips).toBe(1);
  });
});

describe("CR m1-26 hero meta and tiles", () => {
  const t = (k: string, p?: Record<string, string | number>) =>
    k === "map.hero.head" ? `${p?.commit}（${p?.date}）` : k === "map.strip.files" ? `${p?.n}ファイル` : k;
  const scan = {
    files: 1219,
    loc: 64_911,
    languages: [
      { lang: "go", files: 183, loc: 35_664 },
      { lang: "javascript", files: 71, loc: 20_971 },
      { lang: "generic", files: 19, loc: 7973 },
      { lang: "python", files: 1, loc: 137 },
    ],
  } as never;
  test("profile: remote (linked for known forges) · toolchain · license · HEAD (date)", () => {
    const profile = {
      remote: { host: "github.com", path: "tomasz-tomczyk/crit" },
      head: { commit: "406875dd31e0eacc9af33b7643d54100620e8775", date: "2026-10-02T12:00:00+09:00", tag: "v0.21.1" },
      license: { spdx: "MIT", path: "LICENSE" },
      toolchain: { name: "go", version: "1.26", path: "go.mod", line: 3 },
      readme: null,
      areas: [{ kind: "code", lang: "go", loc: 45_700, files: 186 }],
    } as never;
    expect(heroMeta(profile, scan, "406875d", t).map((m) => m.text)).toEqual(["github.com/tomasz-tomczyk/crit", "Go 1.26", "MIT", "406875d（2026-10-02）"]);
    expect(heroMeta(profile, scan, "406875d", t)[0]?.href).toBe("https://github.com/tomasz-tomczyk/crit");
    expect(heroAreas(profile, scan)).toHaveLength(1);
  });
  test("no profile: the scan summary stands in; tiles are the main languages (≥ 2 % of the LOC)", () => {
    expect(heroMeta(null, scan, "406875d", t).map((m) => m.text)).toEqual(["Go", "64.9k LOC", "1,219ファイル", "406875d"]);
    expect(heroAreas(null, scan).map((a) => a.lang)).toEqual(["go", "javascript"]);
  });
});

describe("AC-U-EN engine card: exact steps, the last one re-probes", () => {
  test.each(["notInstalled", "notLoggedIn", "capabilityLost"] as const)("%s", (p) => {
    const steps = fixSteps(p);
    expect(steps[steps.length - 1]).toEqual({ key: "recheck" });
    expect(steps.some((s) => s.cmd?.includes("npm install -g"))).toBe(false);
  });
  test("arbitrary engines receive provider guidance, never Claude commands", () => {
    for (const engine of ["generic", "codex-cli", "anthropic-api"] as const)
      for (const p of ["notInstalled", "notLoggedIn", "capabilityLost"] as const) {
        const steps = fixSteps(p, engine);
        expect(steps).toContainEqual({ key: "providerSetup" });
        expect(steps.every((s) => s.cmd === undefined)).toBe(true);
        expect(steps.at(-1)?.key).toBe("recheck");
      }
  });
  test("a Muse self-update that removed the configured binary gets the one setup command, not install guidance", () => {
    const gone: EngineStatus = {
      engine: "generic",
      installed: false,
      path: "/Users/u/.local/bin/muse-bin-1.4.3-R5018.1",
      auth: "unknown",
      capabilities: [],
      billing: "unknown",
      problems: [{ code: "E_AGENT_NOT_INSTALLED", message: "gone" }],
      checkedAt: "2026-10-12T00:00:00Z" as never,
    };
    expect(museUpdated(gone)).toBe(true);
    expect(museUpdated({ ...gone, path: "/usr/local/bin/my-llm" })).toBe(false);
    expect(museUpdated({ ...gone, installed: true, problems: [] })).toBe(false);
    expect(fixSteps("notInstalled", "generic", { museSetup: "bun run start -- setup muse" })).toEqual([
      { key: "museSetup", cmd: "bun run start -- setup muse" },
      { key: "recheck" },
    ]);
  });
});

describe("NC-11 the generation card's token line", () => {
  test("the total is labelled as a total; the model's output is shown on its own (27k, not 0.48M)", async () => {
    const { interpolate } = await import("../shell/i18n.ts");
    const { fmtTokensImpl } = await import("../shell/fmt.ts");
    const { readFileSync } = await import("node:fs");
    const cat = (lang: string) => JSON.parse(readFileSync(new URL(`../../i18n/map.${lang}.json`, import.meta.url), "utf8")) as Record<string, string>;
    const ja = cat("ja");
    const en = cat("en");
    // m3e-canvas's mitori.json usageTotals
    const p = generatedTokens({ in: 2_100, out: 27_046, cacheRead: 270_773, cacheWrite: 182_326, apiUsd: 0.86 }, fmtTokensImpl, (u) => `$${u.toFixed(2)}`);
    expect(p.out).toBe(fmtTokensImpl(27_046));
    expect(interpolate(ja["map.generated"] as string, p)).toBe(`生成済み · 合計${fmtTokensImpl(482_245)} tok（出力${fmtTokensImpl(27_046)}）· $0.86`);
    expect(interpolate(ja["map.generated"] as string, p)).not.toMatch(/出力\s*0\.48M/);
    expect(interpolate(en["map.generated"] as string, p)).toContain(`(output ${fmtTokensImpl(27_046)})`);
  });
});

describe("NC-02 the hero lede of a generated doc", () => {
  test("the first model-written §0 paragraph, as text without its cite chips; static blocks are skipped", async () => {
    const { ledeOf } = await import("./hero.ts");
    const blocks = [
      { id: "b_h", kind: "heading", origin: "static", html: "<h2>ひとことで</h2>" },
      { id: "b_cov", kind: "facts", origin: "static", html: "<ul><li>読んだファイル 87</li></ul>" },
      {
        id: "b_tl",
        kind: "prose",
        origin: "ai",
        html: '<p><span class="mc">m3e-canvas は画面の配置を描き、AI 向けのプロンプトにして渡すツールである</span>（<a class="cite" href="#">page.tsx:1-9</a>）。バックエンドは無い。</p>',
      },
    ];
    expect(ledeOf(blocks)).toEqual({ block: "b_tl", text: "m3e-canvas は画面の配置を描き、AI 向けのプロンプトにして渡すツールである。バックエンドは無い。" });
    expect(ledeOf(blocks.slice(0, 2))).toBeNull();
  });

  test("a doc that came with the repository (its blocks load as human) still leads with its §0 prose, not its fact list", async () => {
    const { ledeOf } = await import("./hero.ts");
    // committed .mitori/doc opened elsewhere: the store did not write these blocks, so every one is `human`
    const blocks = [
      { id: "b_h", kind: "heading", origin: "static", html: "<h2>ひとことで</h2>" },
      { id: "b_facts", kind: "list", origin: "human", html: "<ul><li>言語: go 35664 行 · javascript 20971 行</li></ul>" },
      { id: "b_tl", kind: "prose", origin: "human", html: "<p>Crit は計画やコード差分にブラウザ上でレビューコメントを付けるツールである。</p>" },
    ];
    expect(ledeOf(blocks)).toEqual({ block: "b_tl", text: "Crit は計画やコード差分にブラウザ上でレビューコメントを付けるツールである。" });
    // no prose at all: the first written list
    expect(ledeOf(blocks.filter((b) => b.kind !== "prose"))?.block).toBe("b_facts");
  });
});

describe("NC-04 rooms say what they are", () => {
  test("a room carries the module's generated one-line role; the static count line stays for ungenerated rooms", () => {
    const view = {
      diagram: {
        id: "dg_map00000",
        kind: "container",
        nodes: [{ id: "md_a", label: "文書モデルとトークン", sublabel: "lib", ref: { module: "md_a", section: "s6/lib" } }],
        edges: [],
        groups: [],
        direction: "RIGHT",
        origin: "static",
      },
      layout: { width: 200, height: 100, nodes: [{ id: "md_a", x: 0, y: 0, w: 100, h: 60 }], edges: [], groups: [] },
      overlays: { comments: {}, working: {}, churn: {}, churnUnavailable: true, freshness: {} },
      modules: [
        {
          id: "md_a",
          slug: "lib",
          name: "文書モデルとトークン",
          children: [],
          paths: ["lib/tokens.ts"],
          loc: 900,
          rank: 1,
          summary: "部品型・寸法・配色を定義する基盤層",
          topFiles: [],
        },
      ],
      quick: [],
    } as unknown as MapView;
    const m = buildPlanModel(view);
    expect(m.rooms[0]).toMatchObject({ label: "文書モデルとトークン", path: "lib", summary: "部品型・寸法・配色を定義する基盤層" });
    const bare = { ...view, modules: [{ ...view.modules[0], summary: undefined }] } as unknown as MapView;
    expect(buildPlanModel(bare).rooms[0]?.summary).toBeNull();
  });
});

describe("NC-04 the 「文脈」 caption is one sentence of what the building is", () => {
  test("cut at the first sentence end (Japanese or Latin), not at an early abbreviation", () => {
    expect(oneSentence("M3E Canvas は画面をスケッチするエディタである。Next.js 16 で作られた。")).toBe("M3E Canvas は画面をスケッチするエディタである。");
    expect(oneSentence("Works with any AI coding tool that takes a prompt. Copy it and paste.")).toBe("Works with any AI coding tool that takes a prompt.");
    expect(oneSentence("v2. Works with any AI coding tool that takes a prompt")).toBe("v2. Works with any AI coding tool that takes a prompt");
  });
  test("long text ends with … at the limit; empty stays empty", () => {
    const long = "あ".repeat(200);
    expect([...oneSentence(long)].length).toBe(120);
    expect(oneSentence(long).endsWith("…")).toBe(true);
    expect(oneSentence("")).toBe("");
  });
});
