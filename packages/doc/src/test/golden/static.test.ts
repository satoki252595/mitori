// Goldens of the zero-token doc (fixtures/golden/<fixture>/doc-static/**): applyStatic + flush under a fake clock
// and seeded ids, for the fixture repos (StaticDocInput from their hand-written truth). The static sections alone
// leave no TOC entry empty, and every written Markdown file round-trips through the codec. ts-small also pins the
// rendered HTML of its blocks (html/<block>.html) and the ELK layout of its map (layout/<dg>.json, real ELK Worker).
import { afterAll, describe, expect, test } from "bun:test";
import { type BlockId, canonicalJson, createSecretScanner, type DiagramIR, type WorkspaceKey } from "@mitori/core";
import ELK from "elkjs/lib/elk-api.js";
import { parseDocFile, serializeDocFile } from "../../codec/index.ts";
import { type ElkGraphNode, elkLayout } from "../../layout/elk.ts";
import { createDiagramLayouter } from "../../layout/index.ts";
import { createBlockRenderer } from "../../render/index.ts";
import { DOC_MIGRATIONS } from "../../store/index.ts";
import { harness, staticInputFromTruth } from "../harness.ts";
import { expectGoldenFile, hasher, inlinePool, memDb, silentLog } from "../helpers.ts";

const FIXTURES = ["ts-small", "py-small", "go-small", "rust-small", "mixed", "nongit", "injection"];

async function staticDoc(name: string) {
  const h = harness();
  h.store.applyStatic(staticInputFromTruth(name));
  await h.store.flush({ force: true });
  return h;
}

describe("DOC-U-015 / golden doc-static (7 fixtures)", () => {
  for (const name of FIXTURES) {
    test(name, async () => {
      const h = await staticDoc(name);
      const files = [...(h.mem?.files ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const mismatched: string[] = [];
      // `.gitignore` is stored as `dot-gitignore`: its `*` would ignore the golden directory itself
      for (const [rel, text] of files) if (!expectGoldenFile(`${name}/doc-static/${rel.replace(/^\.gitignore$/, "dot-gitignore")}`, text).ok) mismatched.push(rel);
      expect(mismatched).toEqual([]);
      for (const s of h.store.sections()) {
        const content = (h.store.section(s.id)?.blocks ?? []).filter((b) => b.kind !== "heading");
        expect({ section: s.id, empty: content.length === 0 }).toEqual({ section: s.id, empty: false });
      }
      for (const [rel, text] of files) {
        if (!rel.startsWith("doc/")) continue;
        const ctx = { lang: "ja" as const, docFile: rel, docDirAbs: "/repo/.mitori", rootAbs: "/repo" };
        const parsed = parseDocFile(text, rel, ctx);
        expect(parsed.blocks.every((b) => b.id !== null)).toBe(true);
        expect(serializeDocFile(parsed.blocks.map((b) => ({ id: b.id as BlockId, kind: b.kindHint, md: b.md }) as never), ctx)).toBe(text);
      }
    });
  }
});

describe("ts-small rendered HTML and map layout goldens", () => {
  const elk = new ELK({ workerUrl: require.resolve("elkjs/lib/elk-worker.min.js"), workerFactory: (u) => new Worker(u as string) as never });
  afterAll(() => elk.terminateWorker());

  test("html/<block>.html (HTML_CONTRACT, spliced at the standard level)", async () => {
    const h = await staticDoc("ts-small");
    const renderer = createBlockRenderer({
      highlighter: inlinePool((r: { text: string }) => r.text),
      secrets: createSecretScanner(),
      hasher,
      db: memDb(DOC_MIGRATIONS),
      log: silentLog,
    });
    const bad: string[] = [];
    for (const s of h.store.sections()) {
      for (const b of h.store.section(s.id)?.blocks ?? []) {
        const claims = h.store.claims(b.id);
        const html = renderer.splice(await renderer.render(b, claims, { lang: "ja", glossaryTerms: new Map() }), claims, { ws: "ws_000000000000" as WorkspaceKey, level: "standard" });
        if (!expectGoldenFile(`ts-small/html/${b.id}.html`, html).ok) bad.push(b.id);
      }
    }
    expect(bad).toEqual([]);
  });

  test("layout/<dg>.json of the §2 container map (coordinates rounded to 0.5 px)", async () => {
    const h = await staticDoc("ts-small");
    const [id, ir] = Object.entries(h.store.index().diagrams)[0] as [string, DiagramIR];
    const api = elk as unknown as { layout(g: ElkGraphNode): Promise<ElkGraphNode> };
    const layouter = createDiagramLayouter({ elk: inlinePool((req: { ir: DiagramIR }) => elkLayout(api, req)) as never, db: memDb(DOC_MIGRATIONS), hasher, log: silentLog });
    const layout = await layouter.layout(ir);
    for (const n of layout.nodes) for (const v of [n.x, n.y, n.w, n.h]) expect(Number.isInteger(v * 2)).toBe(true);
    expect(expectGoldenFile(`ts-small/layout/${id}.json`, canonicalJson(layout)).ok).toBe(true);
  });
});
