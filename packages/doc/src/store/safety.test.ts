// RT-25 … RT-29 (ADR-0014, SEC-01/02): whatever the repo contains, the doc store writes nothing outside
// `<root>/<docDir>` — checked with a write spy and by hashing the directories it must not touch.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { canonicalJson, type ModuleId } from "@mitori/core";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { hasher, nodeFs, spySafeWriter } from "../test/helpers.ts";
import { resolveDocDir } from "./paths.ts";

const tmp: string[] = [];
afterAll(() => {
  for (const t of tmp) rmSync(t, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
/** Digest of a directory tree (paths + bytes). */
function treeDigest(root: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${relative(root, p)}\u0000${e.isSymbolicLink() ? "link" : hasher.xxh3(readFileSync(p))}`);
    }
  };
  walk(root);
  return hasher.xxh3(out.join("\n"));
}
const inside = (abs: string, root: string) => abs.startsWith(`${root}/`);

describe("RT-25 … RT-29 doc writes stay inside the doc directory", () => {
  test("native doc paths keep relative containment and accept server-chosen absolute shadow paths", () => {
    const root = dir("mitori-doc-native-");
    const ws = harness({ root }).ws;
    expect(resolveDocDir(ws, nodeFs).rootReal).toBe(join(root, ".mitori"));
    for (const docDir of [".", "", "..", "../outside", "docs/../nested", "docs\\nested", "docs\0nested", join(`${root}-sibling`, ".mitori")])
      expect(() => resolveDocDir({ ...ws, docDir }, nodeFs)).toThrow(expect.objectContaining({ code: "E_PATH_OUTSIDE" }));
    const outside = dir("mitori-doc-shadow-");
    const docDir = join(outside, "nested", "doc");
    expect(resolveDocDir({ ...ws, kind: "shadow", docDir }, nodeFs).rootReal).toBe(docDir);
    if (sep === "\\") {
      for (const docDir of ["C:foo", "docs:stream", "\\foo", "/foo", join(outside, "doc:stream")]) {
        for (const kind of ["git", "shadow"] as const)
          expect(() => resolveDocDir({ ...ws, kind, docDir }, nodeFs)).toThrow(expect.objectContaining({ code: "E_PATH_OUTSIDE" }));
      }
      // A differently cased spelling of the same Windows root is still the forbidden repository root.
      expect(() => resolveDocDir({ ...ws, kind: "shadow", docDir: root.toUpperCase() }, nodeFs)).toThrow(expect.objectContaining({ code: "E_PATH_OUTSIDE" }));
    }
  });

  test("a missing doc directory beneath a symlink ancestor is refused", () => {
    const root = dir("mitori-doc-ancestor-");
    const outside = dir("mitori-doc-ancestor-out-");
    mkdirSync(join(root, "docs"));
    symlinkSync(outside, join(root, "docs", "linked"));
    const ws = harness({ root, docDir: "docs/linked/missing" }).ws;
    expect(() => resolveDocDir(ws, nodeFs)).toThrow(expect.objectContaining({ code: "E_PATH_SYMLINK" }));
  });

  test("RT-25 a committed `.mitori` symlink to another directory: no write, load reports E_PATH_SYMLINK", async () => {
    const root = dir("mitori-rt25-");
    const outside = dir("mitori-rt25-home-");
    writeFileSync(join(outside, "CLAUDE.md"), "keep me\n");
    symlinkSync(outside, join(root, ".mitori"));
    const before = treeDigest(outside);
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer });
    const report = await h.store.load();
    expect(report.problems[0]?.code).toBe("E_PATH_SYMLINK");
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await expect(h.store.flush({ force: true })).rejects.toMatchObject({ code: "E_PATH_SYMLINK" });
    expect(writer.writes).toEqual([]);
    expect(treeDigest(outside)).toBe(before);
  });

  test("RT-26 slug traversal in the doc.index.json seed is re-slugified (notice) and written under doc/modules/", async () => {
    const root = dir("mitori-rt26-");
    mkdirSync(join(root, ".mitori"), { recursive: true });
    const id = "md_00000001" as ModuleId;
    writeFileSync(
      join(root, ".mitori/doc.index.json"),
      canonicalJson({
        kind: "mitori/doc-index",
        schemaVersion: 1,
        sections: [],
        blocks: {},
        claims: {},
        diagrams: {},
        glossary: [],
        readingPaths: [],
        modules: [{ id, section: "s6/x", ifaceDigest: "0", slug: "../../../.claude/CLAUDE", name: "セッション", reps: [] }],
      }),
    );
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer });
    await h.store.load();
    expect(h.events.events.some((e) => e.type === "notice" && e.key === "notice.slug.rewritten")).toBe(true);
    const input = staticInputFromTruth("go-small");
    input.modules = [{ ...(input.modules[0] as (typeof input.modules)[number]), id, slug: "../../../.claude/CLAUDE" }];
    h.store.applyStatic(input);
    await h.store.flush({ force: true });
    const docDir = join(root, ".mitori");
    expect(writer.writes.length).toBeGreaterThan(0);
    expect(writer.writes.every((w) => inside(w.abs, docDir))).toBe(true);
    const pages = writer.writes.filter((w) => w.abs.includes("/doc/modules/")).map((w) => relative(docDir, w.abs));
    expect(pages.length).toBe(1);
    expect(pages[0]).toMatch(/^doc\/modules\/[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?\.md$/);
  });

  test("RT-27 a forged SectionNode.file is ignored; an absolute docDir outside the repo is refused", async () => {
    const root = dir("mitori-rt27-");
    mkdirSync(join(root, ".mitori"), { recursive: true });
    writeFileSync(
      join(root, ".mitori/doc.index.json"),
      canonicalJson({
        kind: "mitori/doc-index",
        schemaVersion: 1,
        sections: [{ id: "s1", title: "x", file: "../../etc/passwd", blocks: [], children: [], state: "static_only", readingSec: 0 }],
        blocks: {},
        claims: {},
        diagrams: {},
        glossary: [],
        readingPaths: [],
        modules: [],
      }),
    );
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true });
    expect(writer.writes.every((w) => inside(w.abs, join(root, ".mitori")))).toBe(true);
    expect(h.store.section("s1")?.node.file).toBe("doc/01-what-why.md");
    const outside = dir("mitori-rt27-out-");
    const w2 = spySafeWriter();
    const h2 = harness({ root, fs: true, writer: w2, docDir: outside });
    expect((await h2.store.load()).problems[0]?.code).toBe("E_PATH_OUTSIDE");
    h2.store.applyStatic(staticInputFromTruth("ts-small"));
    await expect(h2.store.flush({ force: true })).rejects.toMatchObject({ code: "E_PATH_OUTSIDE" });
    expect(w2.writes).toEqual([]);
  });

  test("RT-28 instruction-file symlinks are never doc targets", async () => {
    const root = dir("mitori-rt28-");
    const outside = dir("mitori-rt28-out-");
    writeFileSync(join(outside, "hosts"), "127.0.0.1 localhost\n");
    symlinkSync(join(outside, "hosts"), join(root, "AGENTS.md"));
    symlinkSync(join(outside, "hosts"), join(root, "CLAUDE.md"));
    const before = treeDigest(outside);
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true });
    expect(writer.writes.every((w) => inside(w.abs, join(root, ".mitori")))).toBe(true);
    expect(treeDigest(outside)).toBe(before);
  });

  test("RT-29 a root manifest pointing docDir at docs/ never overwrites the existing docs/README.md; the root itself is refused", async () => {
    const root = dir("mitori-rt29-");
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "mitori.json"), JSON.stringify({ docDir: "docs" }));
    const readme = "# Existing docs\n\nHand-written; must not be overwritten.\n";
    writeFileSync(join(root, "docs/README.md"), readme);
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer, docDir: "docs" });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true });
    expect(readFileSync(join(root, "docs/README.md"), "utf8")).toBe(readme);
    expect(writer.writes.some((w) => w.abs.endsWith("docs/README.md"))).toBe(false);
    expect(h.events.events.some((e) => e.type === "notice" && e.key === "notice.doc.notOwned")).toBe(true);
    expect(writer.writes.every((w) => inside(w.abs, join(root, "docs")))).toBe(true);
    for (const docDir of [".", ""]) {
      const w = spySafeWriter();
      const hr = harness({ root, fs: true, writer: w, docDir });
      expect((await hr.store.load()).problems[0]?.code).toBe("E_PATH_OUTSIDE");
      hr.store.applyStatic(staticInputFromTruth("ts-small"));
      await expect(hr.store.flush({ force: true })).rejects.toMatchObject({ code: "E_PATH_OUTSIDE" });
      expect(w.writes).toEqual([]);
    }
  });

  test("a lost sidecar (new machine, no DB) is rebuilt: static blocks are re-adopted by their ids, Markdown unchanged", async () => {
    const root = dir("mitori-lost-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("rust-small"));
    await h.store.flush({ force: true });
    const before = treeDigest(join(root, ".mitori/doc"));
    rmSync(join(root, ".mitori/doc.index.json"));
    const writer = spySafeWriter();
    const h2 = harness({ root, fs: true, writer });
    await h2.store.load();
    h2.store.applyStatic(staticInputFromTruth("rust-small"));
    await h2.store.flush({ force: true });
    expect(treeDigest(join(root, ".mitori/doc"))).toBe(before);
    expect(writer.writes.filter((w) => w.abs.includes("/doc/")).length).toBe(0);
    const odd = h2.store
      .sections()
      .flatMap((s) => h2.store.section(s.id)?.blocks ?? [])
      .filter((b) => b.origin !== "static" || b.lock !== undefined);
    expect(odd.map((b) => [b.section, b.slot ?? null, b.kind, b.origin])).toEqual([]);
  });

  test("a doc file changed on disk after mitori wrote it is not overwritten before it is imported", async () => {
    const root = dir("mitori-own-");
    const writer = spySafeWriter();
    const h = harness({ root, fs: true, writer });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("py-small"));
    await h.store.flush({ force: true });
    const abs = join(root, ".mitori/doc/04-quickstart.md");
    const edited = `${readFileSync(abs, "utf8")}\n人が足した段落。\n`;
    writeFileSync(abs, edited);
    h.store.applyStatic({ ...staticInputFromTruth("py-small"), license: "Apache-2.0" });
    await h.store.flush({ force: true });
    expect(readFileSync(abs, "utf8")).toBe(edited);
    const r = await h.store.load();
    expect(r.assignedIds.length).toBe(1);
    await h.store.flush({ force: true });
    expect(readFileSync(abs, "utf8")).toContain("人が足した段落。 <!-- b_");
  });
});
