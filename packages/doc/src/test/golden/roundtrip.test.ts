// DOC-G-001 — the `doc-roundtrip` fixture (20 documents): load → save is byte-identical, or changes exactly as
// `roundtrip.json` describes. Codec level here; the store-level variant (sidecar, external edits) is below.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Block, type BlockId, newId } from "@mitori/core";
import { parseDocFile, serializeDocFile } from "../../codec/index.ts";
import type { CodecContext } from "../../contract.ts";
import { buildFixtureRepo } from "../fixture.ts";
import { seededRandom } from "../helpers.ts";

interface RtDoc {
  file: string;
  expect: "identical" | "assigns-ids" | "id-collision" | "normalizes-crlf";
  blocksWithoutId?: number;
  rewritten?: number;
  then?: { copy: string; reload: Record<string, number> };
}

const fx = buildFixtureRepo("doc-roundtrip");
afterAll(() => fx.dispose());
const spec = JSON.parse(readFileSync(join(fx.root, "roundtrip.json"), "utf8")) as { docDir: string; docs: RtDoc[] };
const ctxOf = (file: string): CodecContext => ({ lang: "ja", docFile: `doc/${file}`, docDirAbs: join(fx.root, ".mitori"), rootAbs: fx.root });
const rnd = seededRandom(7);

/** load → save through the codec: parse, give id-less blocks a fresh id, serialize. */
function roundTrip(text: string, file: string) {
  const ctx = ctxOf(file);
  const parsed = parseDocFile(text, ctx.docFile, ctx);
  const fresh: BlockId[] = [];
  const blocks = parsed.blocks.map((b) => {
    const id = b.id ?? newId("block", rnd);
    if (!b.id) fresh.push(id);
    return { id, kind: b.kindHint, md: b.md } as Block;
  });
  return { parsed, fresh, out: serializeDocFile(blocks, ctx), ctx };
}

describe("DOC-G-001 doc-roundtrip: load → save", () => {
  test("the fixture has 20 documents", () => expect(spec.docs.length).toBe(20));
  for (const doc of spec.docs) {
    test(`${doc.file} (${doc.expect})`, () => {
      const text = readFileSync(join(fx.root, spec.docDir, doc.file), "utf8");
      const { parsed, fresh, out, ctx } = roundTrip(text, doc.file);
      if (doc.expect === "identical") expect(out).toBe(text);
      if (doc.expect === "normalizes-crlf") {
        expect(text.includes("\r\n")).toBe(true);
        expect(out).toBe(text.replace(/\r\n/g, "\n"));
        expect(parsed.problems.filter((p) => p.code === "E_DOC_PARSE")).toEqual([]);
      }
      if (doc.expect === "assigns-ids") {
        expect(fresh.length).toBe(doc.blocksWithoutId ?? -1);
        let back = out;
        for (const id of fresh) back = back.replace(` <!-- ${id} -->`, "");
        expect(back).toBe(text);
      }
      if (doc.expect === "id-collision") {
        expect(parsed.problems.map((p) => p.code)).toContain("E_DOC_ID_COLLISION");
        expect(parsed.duplicates.length).toBe(doc.rewritten ?? -1);
        expect(fresh.length).toBe(doc.rewritten ?? -1);
        expect(out.replace(fresh[0] as string, parsed.duplicates[0] as string)).toBe(text);
      }
      // saving again is a fixed point
      const again = parseDocFile(out, ctx.docFile, ctx);
      expect(again.blocks.every((b) => b.id !== null)).toBe(true);
      expect(
        serializeDocFile(
          again.blocks.map((b) => ({ id: b.id, kind: b.kindHint, md: b.md }) as Block),
          ctx,
        ),
      ).toBe(out);
      if (doc.then) {
        const edited = readFileSync(join(fx.root, doc.then.copy), "utf8");
        expect(roundTrip(edited, doc.file).out).toBe(edited);
      }
    });
  }
});
