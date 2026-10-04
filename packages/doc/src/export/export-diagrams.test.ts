import { describe, expect, test } from "bun:test";
import type { DiagramIR } from "@mitori/core";
import { toMermaidText } from "../layout/mermaid.ts";
import { block, opts, payloadOf, REQ, setup, source } from "./export.fixture.ts";
import { fromMermaid } from "./mermaid.ts";
import { compactShiki, SHIKI_CLASSES } from "./payload.ts";

describe("WP13-U-09 Mermaid read back", () => {
  const flow: DiagramIR = {
    id: "dg_aaaaaaaa",
    kind: "flow",
    direction: "DOWN",
    origin: "ai",
    nodes: [
      { id: "a", label: '入力 "引用" #1', group: "g1" },
      { id: "b", label: "出力[2]|x;", group: "g1" },
      { id: "c", label: "外部" },
    ],
    edges: [
      { id: "e1", from: "a", to: "b", kind: "data", label: "渡す|送る" },
      { id: "e2", from: "b", to: "c", kind: "data" },
    ],
    groups: [{ id: "g1", label: "中核" }],
  };

  test("flowchart: nodes, escaped labels, groups, membership, edges and direction survive toMermaidText → fromMermaid", () => {
    const back = fromMermaid(toMermaidText(flow), "dg_bbbbbbbb");
    expect(back?.direction).toBe("DOWN");
    expect(back?.nodes.map((n) => [n.id, n.label, n.group !== undefined])).toEqual([
      ["a", '入力 "引用" #1', true],
      ["b", "出力[2]|x;", true],
      ["c", "外部", false],
    ]);
    expect(back?.groups.map((g) => g.label)).toEqual(["中核"]);
    expect(back?.nodes[0]?.group).toBe(back?.groups[0]?.id);
    expect(back?.edges.map((e) => [e.from, e.to, e.label ?? null])).toEqual([
      ["a", "b", "渡す|送る"],
      ["b", "c", null],
    ]);
  });

  test("sequence: participants and messages in order", () => {
    const seq: DiagramIR = {
      ...flow,
      kind: "sequence",
      groups: [],
      nodes: [
        { id: "u", label: "ユーザー" },
        { id: "s", label: "サーバー" },
      ],
      edges: [
        { id: "m1", from: "u", to: "s", kind: "message", seq: 1, label: "GET /x" },
        { id: "m2", from: "s", to: "u", kind: "message", seq: 2, label: "200" },
      ],
    };
    const back = fromMermaid(toMermaidText(seq), "dg_cccccccc");
    expect(back?.kind).toBe("sequence");
    expect(back?.nodes.map((n) => n.label)).toEqual(["ユーザー", "サーバー"]);
    expect(back?.edges.map((e) => [e.from, e.to, e.label, e.seq])).toEqual([
      ["u", "s", "GET /x", 1],
      ["s", "u", "200", 2],
    ]);
  });

  test("anything else is not a diagram we draw", () => {
    expect(fromMermaid('pie title x\n  "a": 1', "dg_dddddddd")).toBeNull();
    expect(fromMermaid("", "dg_dddddddd")).toBeNull();
  });
});

describe("WP13-U-10 lost IR, map fallback, syntax colours", () => {
  test("a diagram block whose IR is gone is drawn from its Mermaid fence", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(
      [
        block({
          kind: "diagram",
          aspect: "flow",
          section: "s3",
          md: "```mermaid\nsequenceDiagram\n  participant u as ユーザー\n  participant s as 窓口\n  u->>s: 依頼する\n```",
          diagram: {
            kind: "sequence",
            direction: "RIGHT",
            origin: "ai",
            nodes: [
              { id: "u", label: "ユーザー" },
              { id: "s", label: "窓口" },
            ],
            edges: [{ id: "m1", from: "u", to: "s", kind: "message", seq: 1, label: "依頼する" }],
            groups: [],
          },
        }),
      ],
      opts,
    );
    const real = h.store.index.bind(h.store);
    h.store.index = () => ({ ...real(), diagrams: {} }); // the sidecar lost its diagrams (external edit, merge)
    const found = payloadOf((await exporter().export(REQ)).html)
      .sections.flatMap((x) => x.blocks)
      .find((b) => b.kind === "diagram" && b.html.includes("依頼する"));
    expect(found?.html).toContain('<svg class="dg"');
    expect(found?.html).toContain('data-kind="message"');
  });

  test("the map comes from the source's container diagram when the doc has none", async () => {
    const { h, exporter } = setup();
    const own = payloadOf((await exporter().export(REQ)).html).map; // the static doc has its own container diagram
    expect(own?.diagram.nodes.length).toBeGreaterThan(0);
    const real = h.store.index.bind(h.store);
    h.store.index = () => ({ ...real(), diagrams: {} }); // an imported doc: no sidecar, no diagrams
    const ir: DiagramIR = {
      id: "dg_map00000",
      kind: "container",
      direction: "RIGHT",
      origin: "static",
      nodes: [
        { id: "m1", label: "api", sublabel: "src/api", group: "z1", ref: { module: "md_aaaaaaaa", section: "s6/api" } },
        { id: "m2", label: "db", group: "z1" },
      ],
      edges: [{ id: "e1", from: "m1", to: "m2", kind: "depends" }],
      groups: [{ id: "z1", label: "core" }],
    };
    const p = payloadOf((await exporter({ ...source, mapDiagram: () => ir }).export(REQ)).html);
    expect(p.map?.diagram.nodes.map((n) => n.id)).toEqual(["m1", "m2"]);
    expect(p.map?.layout.nodes.length).toBe(2);
    expect(p.palette.items.filter((i) => i.k === "m").map((i) => i.l)).toEqual(["api", "db"]);
    expect(payloadOf((await exporter().export(REQ)).html).map).toBeNull();
  });

  test("Shiki colours: the default colour span goes, the others get the one-letter classes the viewer stylesheet defines", () => {
    const html =
      '<span class="line"><span style="color:var(--shiki-token-keyword)">func</span><span style="color:var(--shiki-foreground)"> main</span><span style="color:var(--shiki-token-punctuation)">()</span><span style="color:var(--shiki-token-other)">?</span></span>';
    expect(compactShiki(html)).toBe(
      '<span class="line"><span class="sk">func</span> main<span class="sp">()</span><span style="color:var(--shiki-token-other)">?</span></span>',
    );
    // string-expression and string have separate classes (the themes may colour them differently)
    expect(SHIKI_CLASSES.string).not.toBe(SHIKI_CLASSES["string-expression"]);
  });
});
