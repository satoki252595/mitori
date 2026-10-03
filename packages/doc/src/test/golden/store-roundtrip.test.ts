// DOC-G-001 through the DocStore (real files): load → save leaves the 20 doc-roundtrip documents byte-identical
// (or changes exactly as roundtrip.json says), and the acceptance case "one block edited in an external editor ⇒
// imported as human-edited, every other block unchanged" (DOC-U-006). The rt-NN documents are placed at a
// template file path so the store owns them.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockId } from "@mitori/core";
import { buildFixtureRepo } from "../fixture.ts";
import { harness } from "../harness.ts";
import { spySafeWriter } from "../helpers.ts";

interface RtDoc {
  file: string;
  expect: string;
  blocksWithoutId?: number;
  rewritten?: number;
  then?: { copy: string; reload: { externallyEdited?: number; orphaned?: number } };
}

const fx = buildFixtureRepo("doc-roundtrip");
const tmp: string[] = [];
afterAll(() => {
  fx.dispose();
  for (const t of tmp) rmSync(t, { recursive: true, force: true });
});
const spec = JSON.parse(readFileSync(join(fx.root, "roundtrip.json"), "utf8")) as { docDir: string; docs: RtDoc[] };
const TARGET = "doc/01-what-why.md";

/** A repo whose docDir holds one rt document at the template path. */
function repoWith(text: string): { root: string; abs: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mitori-doc-rt-")));
  tmp.push(root);
  cpSync(join(fx.root, "src"), join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".mitori/doc"), { recursive: true });
  writeFileSync(join(root, ".mitori", TARGET), text);
  return { root, abs: join(root, ".mitori", TARGET) };
}

describe("DOC-G-001 store load → save (20 documents)", () => {
  for (const doc of spec.docs) {
    test(`${doc.file} (${doc.expect})`, async () => {
      const text = readFileSync(join(fx.root, spec.docDir, doc.file), "utf8");
      const { root, abs } = repoWith(text);
      const writer = spySafeWriter();
      const h = harness({ root, fs: true, writer });
      const report = await h.store.load();
      await h.store.flush({ force: true });
      const saved = readFileSync(abs, "utf8");
      if (doc.expect === "identical") {
        expect(saved).toBe(text);
        expect(writer.writes.some((w) => w.abs === abs)).toBe(false);
      }
      if (doc.expect === "assigns-ids") expect(report.assignedIds.length).toBe(doc.blocksWithoutId ?? -1);
      if (doc.expect === "id-collision") {
        expect(report.problems.map((p) => p.code)).toContain("E_DOC_ID_COLLISION");
        expect(report.assignedIds.length).toBe(doc.rewritten ?? -1);
      }
      if (doc.expect === "normalizes-crlf") expect(saved).toBe(text.replace(/\r\n/g, "\n"));
      // a second load of what was saved is a fixed point
      const h2 = harness({ root, fs: true, writer: spySafeWriter(), db: h.db });
      const again = await h2.store.load();
      expect(again.assignedIds).toEqual([]);
      expect(again.externallyEdited).toEqual([]);
      if (doc.then) {
        const before = h2.store.section("s1")?.blocks.map((b) => [b.id, b.hash, b.lock ?? null]) ?? [];
        writeFileSync(abs, readFileSync(join(fx.root, doc.then.copy), "utf8"));
        const r = await h2.store.load();
        if (doc.then.reload.externallyEdited !== undefined) expect(r.externallyEdited.length).toBe(doc.then.reload.externallyEdited);
        if (doc.then.reload.orphaned !== undefined) expect(r.orphaned.length).toBe(doc.then.reload.orphaned);
        const after = new Map((h2.store.section("s1")?.blocks ?? []).map((b) => [b.id, b] as const));
        for (const [id, hash, lock] of before) {
          if (r.externallyEdited.includes(id as BlockId)) {
            expect(after.get(id as BlockId)?.lock).toBe("human-edited");
            expect(h2.store.history(id as BlockId).at(-1)?.source).toBe("import_external");
          } else if (r.orphaned.includes(id as BlockId)) expect(after.has(id as BlockId)).toBe(false);
          else expect([after.get(id as BlockId)?.hash, after.get(id as BlockId)?.lock ?? null]).toEqual([hash, lock]);
        }
      }
    });
  }
});
