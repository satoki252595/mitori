import { expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { Block, SectionId, SectionNode, SectionView, WorkspaceKey } from "@mitori/core";
import type { RouteCtx, RouteHandler } from "../routes/types.ts";
import { domainHandlers, type RouteEnv } from "./routes.ts";
import { MdLines, sectionView, type ViewCtx } from "./views.ts";

const id = "s1" as SectionId;
const ws = "ws_000000000000" as WorkspaceKey;
function fixture(n = 5, body = "body") {
  const rendered: string[] = [];
  const blocks = Array.from({ length: n }, (_, ord) => ({
    id: `b_${String(ord).padStart(8, "0")}`,
    section: id,
    ord,
    file: "s1.md",
    kind: "prose",
    depth: "L1",
    audience: [],
    lang: "ja",
    origin: "static",
    status: "ready",
    freshness: "fresh",
    hash: "0".repeat(16),
    claims: [],
    readingSec: 3,
    md: body,
  })) as Block[];
  const node = { id, title: "section", blocks: blocks.map((b) => b.id), children: [] } as unknown as SectionNode;
  const c = {
    ws,
    doc: { section: () => ({ node, blocks }), sections: () => [node], index: () => ({ glossary: [] }), claims: () => [], proposals: () => [] },
    renderer: {
      render: async (b: Block) => {
        rendered.push(b.id);
        return b.md;
      },
      splice: (body: string) => `<p>${body}</p>`,
    },
    lines: new MdLines({ stat: () => null, read: async () => new Uint8Array() }, "/doc"),
    threads: () => ({ open: 0, total: 0 }),
  } as unknown as ViewCtx;
  const handler = domainHandlers({ domain: async () => ({ view: c, staticReady: async () => {} }) } as unknown as RouteEnv)[
    "GET /ws/:ws/doc/sections/:section"
  ] as RouteHandler<"GET /ws/:ws/doc/sections/:section">;
  const ctx = (query = "", encoding = "") =>
    ({
      params: { ws, section: id },
      query: new URLSearchParams(query),
      req: new Request("http://127.0.0.1/section", { headers: { "accept-encoding": encoding } }),
    }) as unknown as RouteCtx<"GET /ws/:ws/doc/sections/:section">;
  return { c, blocks, node, rendered, handler, ctx };
}

test("section range retains canonical metadata/order and renders only its window; default remains full", async () => {
  const f = fixture();
  const v = (await sectionView(f.c, id, "en", { from: 2, limit: 2 })) as SectionView;
  expect(v.section).toEqual(f.node);
  expect(v.blocks.map((b) => b.id)).toEqual(f.blocks.map((b) => b.id));
  expect(v.blocks.map((b) => b.html !== "")).toEqual([false, false, true, true, false]);
  expect(v.blocks[0]).toMatchObject({ hash: f.blocks[0]?.hash, origin: "static", htmlLang: "en", threads: { open: 0, total: 0 } });
  expect(f.rendered).toEqual(f.blocks.slice(2, 4).map((b) => b.id));
  expect([v.from, v.total]).toEqual([2, 5]);
  const slice = (await sectionView(f.c, id, undefined, { from: 4, limit: 512, outline: false })) as SectionView;
  expect(slice.blocks.map((b) => b.id)).toEqual(f.blocks.slice(4).map((b) => b.id));
  expect(slice.blocks[0]?.html).toContain("body");
  const beyond = (await sectionView(f.c, id, undefined, { from: 100, limit: 1, outline: false })) as SectionView;
  expect([beyond.from, beyond.total, beyond.blocks.length]).toEqual([5, 5, 0]);
  const full = (await sectionView(f.c, id)) as SectionView;
  expect(full.blocks.every((b) => b.html.includes("body"))).toBe(true);
  expect(full.total).toBeUndefined();
  expect(full.from).toBeUndefined();
});

test("10,000 metadata blocks share one cold file read; the range renders only 150 bodies", async () => {
  const f = fixture(10_000, "body ".repeat(400));
  const source = new TextEncoder().encode(f.blocks.map((b) => `text\n<!-- ${b.id} -->\n`).join("\n"));
  let reads = 0;
  let mtime = 1n;
  f.c.lines = new MdLines(
    {
      stat: () => ({ mtimeNs: mtime }),
      read: async () => {
        reads++;
        await Promise.resolve();
        return source;
      },
    },
    "/doc",
  );
  const v = (await f.handler(f.ctx("from=9000&limit=150", "gzip"))) as Response;
  const decoded = JSON.parse(gunzipSync(Buffer.from(await v.arrayBuffer())).toString()) as SectionView;
  expect(reads).toBe(1);
  expect(f.rendered).toHaveLength(150);
  expect(decoded.total).toBe(10_000);
  expect(decoded.blocks).toHaveLength(10_000);
  expect(decoded.blocks[9000]?.html).toContain("body");
  expect(decoded.blocks[8999]?.html).toBe("");
  expect(decoded.blocks[8999]?.mdLine).toBeGreaterThan(0);
  mtime++;
  await f.c.lines.lineOf(f.blocks[0] as Block);
  expect(reads).toBe(2);
});

test("section route bounds and validates windows before loading the domain", async () => {
  const f = fixture();
  for (const query of ["from=-1", "from=1000001", "from=1.5", "from=no", "limit=0", "limit=513", "limit=NaN", "outline=false", "from=0&outline=0"]) {
    await expect(f.handler(f.ctx(query))).rejects.toMatchObject({ code: "E_INVALID_INPUT" });
  }
  expect(f.rendered).toHaveLength(0);
  const v = (await f.handler(f.ctx("from=4&limit=512&outline=false"))) as SectionView;
  expect(v.blocks).toHaveLength(1);
  expect(v.from).toBe(4);
});

test("large section JSON negotiates br/gzip, honors q=0 and stays unchanged after decompression", async () => {
  const f = fixture(5, "body ".repeat(1000));
  const full = await sectionView(f.c, id);
  for (const [encoding, selected] of [
    ["gzip", "gzip"],
    ["gzip;q=0.5,br", "br"],
    ["br;q=0,gzip;q=0", null],
  ] as const) {
    const r = (await f.handler(f.ctx("", encoding))) as Response;
    expect(r).toBeInstanceOf(Response);
    expect(r.headers.get("content-encoding")).toBe(selected);
    expect(r.headers.get("vary")).toBe("accept-encoding");
    const raw = Buffer.from(await r.arrayBuffer());
    const decoded = selected === "br" ? brotliDecompressSync(raw) : selected === "gzip" ? gunzipSync(raw) : raw;
    expect(JSON.parse(decoded.toString())).toEqual(full);
    if (selected) expect(raw.length).toBeLessThan(decoded.length / 10);
  }
  const small = fixture();
  expect(await small.handler(small.ctx("", "br,gzip"))).not.toBeInstanceOf(Response);
});
