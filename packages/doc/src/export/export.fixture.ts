// Shared fixtures of the exporter's unit tests: a doc store over the `secrets` truth, a real renderer with an inline
// highlighter, a grid-layout double, an in-memory code source and a viewer bundle double.
import {
  type Cite,
  type ClaimChecks,
  createSecretScanner,
  type DiagramIR,
  type DiagramLayout,
  type ExportReq,
  type RepoPath,
  type SourceLang,
} from "@mitori/core";
import type { DiagramLayouter, GeneratedBlock } from "../contract.ts";
import { createBlockRenderer } from "../render/index.ts";
import { DOC_MIGRATIONS } from "../store/index.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { hasher, inlinePool, memDb, silentLog } from "../test/helpers.ts";
import { createHtmlExporter, type ExportSource } from "./index.ts";
import { sha256Hex, utf8 } from "./sha256.ts";

export const AWS = "AKIAJ3Q7XK2M5N8P4RWT";
export const GH = "ghp_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ";
export const STRIPE = "sk_live_51Hq7YtL2m9XkP4rVb8NcZ0aW";
export const PASS = "Tr0ub4dor&3xKq9Zp";

export const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
export const cite = (path: string, start: number, end: number): Cite => ({
  path,
  start,
  end,
  blob: "b".repeat(40),
  snippet: "s".repeat(16),
  precision: "exact",
});
export const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
export const opts = { mode: "write" as const, deletes: [], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "test", listed: 0 };
export const REQ: ExportReq = { format: "html", level: "standard", lang: "ja", includeDecisions: false, excerpts: true };

export function block(over: Partial<GeneratedBlock>): GeneratedBlock {
  return {
    id: null,
    section: "s1",
    aspect: "problem",
    kind: "prose",
    depth: "L0",
    audience: ["newcomer"],
    lang: "ja",
    md: "課題を解く[[1]]。",
    claims: [],
    gen,
    ...over,
  };
}

/** Grid layout double: node boxes in IR order, straight edges. */
export const layouter: DiagramLayouter = {
  async layout(ir: DiagramIR): Promise<DiagramLayout> {
    const nodes = ir.nodes.map((n, i) => ({ id: n.id, x: 20 + i * 200, y: 20, w: 160, h: 56 }));
    return {
      diagram: ir.id,
      irHash: "0".repeat(16),
      engine: "test",
      width: 40 + ir.nodes.length * 200,
      height: 96,
      nodes,
      edges: ir.edges.map((e) => {
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        return {
          id: e.id,
          points: [[(a?.x ?? 0) + 160, 48] as [number, number], [b?.x ?? 0, 48] as [number, number]],
          label: [(a?.x ?? 0) + 180, 40] as [number, number],
        };
      }),
      groups: [],
    };
  },
  async layoutFloorplan() {
    throw new Error("unused");
  },
  toMermaid: () => "",
};

export const SRC: Record<string, string> = {
  "src/config.ts": `${["export const a = 1;", `const key = "${STRIPE}";`, "export const b = 2;", "export const c = 3;", "export const d = 4;"].join("\n")}\n`,
  "src/index.ts": `${Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`,
};
export const source: ExportSource = {
  async file(path: RepoPath) {
    const text = SRC[path];
    return text === undefined ? null : { text, blob: "c".repeat(40), lang: "typescript" as SourceLang };
  },
};

export function viewer(js = "document.title='ok';") {
  return { js, css: ".x{color:red}", jsSha256: sha256Hex(utf8(js)) };
}

export function setup(over: { js?: string } = {}) {
  const h = harness();
  h.store.applyStatic(staticInputFromTruth("secrets"));
  const db = memDb(DOC_MIGRATIONS);
  const renderer = createBlockRenderer({
    highlighter: inlinePool((req: { text: string }) =>
      req.text
        .split("\n")
        .map((l) => `<span class="line">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`)
        .join("\n"),
    ),
    secrets: createSecretScanner(),
    hasher,
    db,
    log: silentLog,
  });
  const exporter = (src: ExportSource | null = source, assets = viewer(over.js)) =>
    createHtmlExporter({
      doc: h.store,
      renderer,
      layouter,
      secrets: createSecretScanner(),
      viewerAssets: assets,
      clock: h.clock,
      ...(src ? { source: src } : {}),
    });
  return { h, renderer, exporter };
}

/** The payload of an exported file, read the way the viewer does. */
export function payloadOf(html: string) {
  const m = /<script type="application\/json" id="mitori-export">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m?.[1] ?? "null") as import("./payload.ts").ExportPayload;
}
