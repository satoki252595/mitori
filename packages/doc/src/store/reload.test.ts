// Re-opening and re-loading a doc directory (§10.4, §10.9, AC-29, SEC-02): a store-written doc reopens without a
// single write, the ownership ledger recognizes our own bytes, a reload merges external edits block by block with
// changes not flushed yet, and nothing is read or written through a symlink inside docDir.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockId, Cite, ClaimChecks, ModuleId, SectionId } from "@mitori/core";
import type { GeneratedBlock } from "../contract.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { spySafeWriter } from "../test/helpers.ts";

const tmp: string[] = [];
afterAll(() => {
  for (const t of tmp) rmSync(t, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const cite = (path: string, start: number, end: number): Cite => ({ path, start, end, blob: "b".repeat(40), snippet: "s".repeat(16), precision: "exact" });
const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
const opts = { mode: "write" as const, deletes: [] as BlockId[], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "test", listed: 0 };
function block(over: Partial<GeneratedBlock>): GeneratedBlock {
  return {
    id: null,
    section: "s1",
    aspect: "problem",
    kind: "prose",
    depth: "L0",
    audience: ["newcomer"],
    lang: "ja",
    md: "課題を解く。",
    claims: [],
    gen,
    ...over,
  };
}
const claim = (path: string, start: number, end: number) => ({
  n: 1,
  kind: "behavior" as const,
  quote: "",
  cites: [cite(path, start, end)],
  checks,
  verdict: "verified" as const,
});

/** Every file under `root` (relative path → text). */
function snap(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p.slice(root.length + 1), readFileSync(p, "utf8"));
    }
  };
  walk(root);
  return out;
}

/** A store-written doc (static + two generated blocks with cites) in a temp repo. */
async function written(fixture: string) {
  const root = dir("mitori-reopen-");
  const h = harness({ root, fs: true, writer: spySafeWriter() });
  await h.store.load();
  h.store.applyStatic(staticInputFromTruth(fixture));
  h.store.applyGenerated(
    [
      block({ md: "課題を解く[[1]]。", claims: [claim("src/a.ts", 3, 9)] }),
      block({ section: "s0", aspect: "tldr", md: "これは `x` のツール[[1]]。", claims: [claim("src/b.ts", 1, 2)] }),
    ],
    opts,
  );
  await h.store.flush({ force: true });
  return { root, h };
}

describe("AC-29 reopening a store-written doc writes nothing", () => {
  for (const fixture of ["ts-small", "mixed", "go-small"]) {
    test(`${fixture}: load → flush → applyStatic(same input) → flush, with the same DB and with a lost DB`, async () => {
      const { root, h } = await written(fixture);
      const before = snap(join(root, ".mitori"));
      for (const sameDb of [true, false]) {
        const w = spySafeWriter();
        const h2 = harness({ root, fs: true, writer: w, ...(sameDb ? { db: h.db } : {}) });
        const r = await h2.store.load();
        expect([r.externallyEdited, r.assignedIds, r.orphaned]).toEqual([[], [], []]);
        await h2.store.settled();
        await h2.store.flush({ force: true });
        h2.store.applyStatic(staticInputFromTruth(fixture));
        await h2.store.flush({ force: true });
        // README.md / .gitignore are not rewritten either (the ledger knows their bytes)
        expect({ sameDb, writes: w.writes.map((x) => x.abs) }).toEqual({ sameDb, writes: [] });
        expect(snap(join(root, ".mitori"))).toEqual(before);
      }
    });
  }

  test("the appendix source index and section reading times follow generated blocks without an applyStatic", async () => {
    const { h } = await written("ts-small");
    const sources = h.store.section("appendix")?.blocks.find((b) => b.slot === "ap:sources");
    expect(sources?.md).toContain("`src/a.ts`");
    const appendix = h.store.section("appendix");
    expect(appendix?.node.readingSec).toBe(appendix?.blocks.reduce((a, b) => a + b.readingSec, 0));
  });

  test("the 30-minute path takes the two highest-ranked module pages", () => {
    const h = harness();
    const input = staticInputFromTruth("ts-small");
    h.store.applyStatic(input);
    const top = [...input.modules]
      .filter((m) => !m.parent)
      .sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1))
      .slice(0, 2)
      .map((m) => h.store.index().modules.find((e) => e.id === m.id)?.section);
    const path = h.store.index().readingPaths.find((p) => p.id === "30min");
    expect(path?.steps.map((s) => s.section).filter((s) => s.startsWith("s6/"))).toEqual(top as SectionId[]);
  });
});

describe("SEC-02 ownership ledger", () => {
  test("a touched large sidecar (no digest above 1 MB) is still recognized as ours and rewritten", async () => {
    const root = dir("mitori-bigidx-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const many = Array.from({ length: 800 }, (_, i) =>
      block({ section: "s9", aspect: "hotpaths", depth: "L3", md: `段落 ${i}。${"あ".repeat(200)}[[1]]。`, claims: [claim("src/a.ts", i + 1, i + 2)] }),
    );
    h.store.applyGenerated(many, opts);
    await h.store.flush({ force: true });
    const ix = join(root, ".mitori/doc.index.json");
    expect(statSync(ix).size).toBeGreaterThan(1 << 20);
    const later = new Date(Date.now() + 5000);
    utimesSync(ix, later, later);
    const [id] = h.store.applyGenerated([block({ md: "新しい段落。" })], opts).written as BlockId[];
    expect(await h.store.flush({ force: true })).toContain("doc.index.json");
    expect(readFileSync(ix, "utf8")).toContain(`"${id}"`);
    expect(h.events.events.some((e) => e.type === "notice" && e.key === "notice.doc.notOwned")).toBe(false);
  });
});

describe("DOC-U-006 reload: external edits merge block by block with unflushed changes", () => {
  test("a generated block not flushed yet survives an external edit of its file (not orphaned)", async () => {
    const root = dir("mitori-pending-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const [a] = h.store.applyGenerated([block({ md: "最初の段落。" })], opts).written as BlockId[];
    await h.store.flush({ force: true });
    const res = h.store.applyGenerated([block({ md: "生成されたばかりの段落。" })], opts);
    const fresh = res.written.find((x) => x !== a && h.store.block(x)?.kind === "prose") as BlockId;
    const abs = join(root, ".mitori/doc/01-what-why.md");
    writeFileSync(abs, readFileSync(abs, "utf8").replace("最初の段落。", "最初の段落を人が直した。"));
    const r = await h.store.load();
    expect(r.externallyEdited).toEqual([a as BlockId]);
    expect(r.orphaned).toEqual([]);
    expect(h.store.block(fresh)?.md).toBe("生成されたばかりの段落。");
    expect(h.store.block(fresh)?.lock).toBeUndefined();
    const order = h.store.section("s1")?.node.blocks ?? [];
    expect(order.indexOf(fresh)).toBe(order.indexOf(a as BlockId) + 1);
    await h.store.flush({ force: true });
    const text = readFileSync(abs, "utf8");
    expect(text).toContain("最初の段落を人が直した。");
    expect(text).toContain("生成されたばかりの段落。");
  });

  test("a static update not flushed yet is not mistaken for an external edit", async () => {
    const root = dir("mitori-pending2-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true });
    h.store.applyStatic({ ...staticInputFromTruth("ts-small"), license: "MIT" });
    const badges = h.store.section("s0")?.blocks.find((b) => b.slot === "s0:badges");
    const abs = join(root, ".mitori/doc/00-tldr.md");
    writeFileSync(abs, readFileSync(abs, "utf8").replace("- 読んだファイル", "- 人が足した行\n- 読んだファイル"));
    const r = await h.store.load();
    expect(r.externallyEdited.length).toBe(1);
    expect(r.externallyEdited).not.toContain(badges?.id as BlockId);
    expect(h.store.block(badges?.id as BlockId)?.md).toContain("ライセンス: MIT");
    expect(h.store.block(badges?.id as BlockId)?.lock).toBeUndefined();
  });

  test("an edit made while mitori was not running reaches the sidecar on the next flush", async () => {
    const root = dir("mitori-cold-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true });
    const abs = join(root, ".mitori/doc/00-tldr.md");
    writeFileSync(abs, readFileSync(abs, "utf8").replace("ライセンス: 不明", "ライセンス: MIT"));
    const h2 = harness({ root, fs: true, writer: spySafeWriter(), db: h.db });
    const r = await h2.store.load();
    expect(r.externallyEdited.length).toBe(1);
    await h2.store.flush({ force: true });
    const idx = JSON.parse(readFileSync(join(root, ".mitori/doc.index.json"), "utf8"));
    expect(idx.blocks[r.externallyEdited[0] as string]?.lock).toBe("human-edited");
  });

  test("a block deleted in the Markdown while mitori was not running leaves the sidecar too", async () => {
    const root = dir("mitori-cold2-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const [id] = h.store.applyGenerated([block({ md: "消される段落。" })], opts).written as BlockId[];
    await h.store.flush({ force: true });
    const abs = join(root, ".mitori/doc/01-what-why.md");
    writeFileSync(abs, readFileSync(abs, "utf8").replace(`\n消される段落。 <!-- ${id} -->\n`, ""));
    const h2 = harness({ root, fs: true, writer: spySafeWriter(), db: h.db });
    const r = await h2.store.load();
    expect(r.orphaned).toContain(id as BlockId);
    await h2.store.flush({ force: true });
    expect(readFileSync(join(root, ".mitori/doc.index.json"), "utf8")).not.toContain(`"${id}"`);
  });

  test("the watcher echo of our own flush is a no-op (no reconcile, no outline event)", async () => {
    const { h } = await written("ts-small");
    const n = h.events.events.length;
    const r = await h.store.load();
    expect(r).toEqual({ manifest: h.store.manifest(), externallyEdited: [], assignedIds: [], orphaned: [], problems: [] });
    expect(h.events.events.slice(n)).toEqual([]);
  });
});

describe("a sidecar of the wrong shape", () => {
  for (const [name, mutate] of [
    ["sections is an object", (ix: Record<string, unknown>) => ({ ...ix, sections: {} })],
    [
      "block metadata of the wrong types",
      (ix: Record<string, unknown>) => ({ ...ix, blocks: Object.fromEntries(Object.keys(ix.blocks as object).map((k) => [k, { section: "s1", claims: 5 }])) }),
    ],
    [
      "claims without cites",
      (ix: Record<string, unknown>) => ({ ...ix, claims: Object.fromEntries(Object.keys(ix.claims as object).map((k) => [k, { block: 1 }])) }),
    ],
  ] as const) {
    test(`${name}: load reports E_FORMAT_INVALID and keeps the Markdown text`, async () => {
      const { root } = await written("ts-small");
      const abs = join(root, ".mitori/doc.index.json");
      writeFileSync(abs, JSON.stringify(mutate(JSON.parse(readFileSync(abs, "utf8")))));
      const md = readFileSync(join(root, ".mitori/doc/01-what-why.md"), "utf8");
      const h = harness({ root, fs: true, writer: spySafeWriter() });
      const r = await h.store.load();
      if (name !== "claims without cites") expect(r.problems.map((p) => p.code)).toContain("E_FORMAT_INVALID");
      expect(h.store.section("s1")?.blocks.some((b) => b.md.startsWith("課題を解く"))).toBe(true);
      await h.store.flush({ force: true });
      expect(readFileSync(join(root, ".mitori/doc/01-what-why.md"), "utf8")).toBe(md);
    });
  }
});

describe("SEC-01 symlinks inside docDir", () => {
  test("a doc/ symlink is neither read nor written through", async () => {
    const root = dir("mitori-innerlink-");
    const outside = dir("mitori-innerlink-out-");
    writeFileSync(join(outside, "00-tldr.md"), "秘密のメモ <!-- b_aaaaaaaa -->\n");
    mkdirSync(join(root, ".mitori"));
    symlinkSync(outside, join(root, ".mitori/doc"));
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    expect(h.store.block("b_aaaaaaaa" as BlockId)).toBeNull();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    await h.store.flush({ force: true }).catch(() => []);
    expect(snap(outside)).toEqual(new Map([["00-tldr.md", "秘密のメモ <!-- b_aaaaaaaa -->\n"]]));
  });
});

describe("text that enters the Markdown keeps the block structure", () => {
  test("an ID comment pasted into an edit is dropped; an unclosed fence is closed — the reload keeps every block", async () => {
    const root = dir("mitori-edit-");
    const h = harness({ root, fs: true, writer: spySafeWriter() });
    await h.store.load();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    h.store.applyGenerated([block({ md: "一つ目。" }), block({ md: "二つ目。" }), block({ aspect: "users", kind: "list", depth: "L1", md: "- 三つ目" })], opts);
    const [one, two] = (h.store.section("s1")?.blocks ?? []).filter((b) => b.kind === "prose");
    await h.store.editBlock(one?.id as BlockId, one?.hash as string, "前半。 <!-- b_aaaaaaaa -->\n\n後半。", "human");
    const edited = await h.store.editBlock(two?.id as BlockId, two?.hash as string, "例:\n\n```ts\nconst x = 1;", "human");
    expect(h.store.block(one?.id as BlockId)?.md).toBe("前半。\n\n後半。");
    expect(edited.block.md).toBe("例:\n\n```ts\nconst x = 1;\n```");
    await h.store.flush({ force: true });
    const ids = h.store.section("s1")?.node.blocks;
    const h2 = harness({ root, fs: true, writer: spySafeWriter(), db: h.db });
    const r = await h2.store.load();
    expect([r.externallyEdited, r.assignedIds, r.orphaned]).toEqual([[], [], []]);
    expect(h2.store.section("s1")?.node.blocks).toEqual(ids as BlockId[]);
    expect(h2.store.block(two?.id as BlockId)?.kind).toBe("prose");
  });

  test("repo text with HTML in a locked static block becomes a proposal; applyStatic never throws", async () => {
    const h = harness();
    const input = staticInputFromTruth("ts-small");
    const todo = {
      kind: "todo" as const,
      detector: "todo@1",
      path: "src/a.ts",
      line: 3,
      blob: "0".repeat(40),
      marker: "TODO" as const,
      text: "replace <div> with\n<section>",
    };
    h.store.applyStatic({ ...input, facts: [...input.facts, todo] });
    const b = h.store.section("s11")?.blocks.find((x) => x.slot === "s11:todos");
    expect(b?.md).toContain("| TODO | replace &lt;div> with &lt;section> |");
    await h.store.editBlock(b?.id as BlockId, b?.hash as string, `${b?.md}\n\n人のメモ。`, "human");
    const res = h.store.applyStatic({ ...input, facts: [...input.facts, { ...todo, text: "use <main>" }] });
    expect(res.proposals.length).toBe(1);
  });

  test("newlines and markup in module names and flow titles stay inside their heading", () => {
    const h = harness();
    h.store.applyStatic(staticInputFromTruth("ts-small"));
    const m = h.store.index().modules[0];
    h.store.setModuleLabels([{ module: m?.id as ModuleId, name: "名前\n<!-- b_aaaaaaaa -->" }]);
    h.store.upsertFlowSection("login", "ログイン\n## 乗っ取り", 0);
    const heads = h.store
      .sections()
      .flatMap((s) => h.store.section(s.id)?.blocks ?? [])
      .filter((b) => b.kind === "heading");
    expect(heads.filter((x) => x.md.includes("\n") || x.md.includes("<!--"))).toEqual([]);
    expect(h.store.section("s3/login")?.blocks[0]?.md).toBe("## 3.1 ログイン ## 乗っ取り");
  });
});
