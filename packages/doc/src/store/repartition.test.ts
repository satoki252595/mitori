/**
 * EX-01 (expert audit, critical): opening a generated `.mitori/` at a new path / with a fresh home re-partitioned the
 * modules, and the static refresh tombstoned every module page whose id changed — 14 of 16 generated pages became
 * 「未生成」 stubs within a second, with no copy left anywhere. A page with model- or human-written blocks now follows
 * its files to the new module id (byte for byte when the files are the same), or is kept under `orphaned/`.
 */
import { describe, expect, test } from "bun:test";
import type { BlockId, ClaimChecks, ModuleId, SectionId } from "@mitori/core";
import type { GeneratedBlock, StaticDocInput } from "../contract.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { partitionOverlap, REATTACH_MIN } from "./apply.ts";

const checks: ClaimChecks = { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S6", promptVer: "gen.module@1", indexDigest: "0".repeat(16) } as const;
const opts = { mode: "write" as const, deletes: [] as BlockId[], source: { kind: "regen" as const, id: "gr_00000001" }, reason: "test", listed: 0 };

function aiBlock(section: SectionId, path: string, md: string): GeneratedBlock {
  return {
    id: null,
    section,
    aspect: "responsibility",
    kind: "prose",
    depth: "L1",
    audience: ["dev"],
    lang: "ja",
    md,
    claims: [
      {
        n: 1,
        kind: "behavior",
        quote: "",
        cites: [{ path, start: 1, end: 3, blob: "b".repeat(40), snippet: "s".repeat(16), precision: "exact" }],
        checks,
        verdict: "verified",
      },
    ],
    gen,
  };
}

/** ts-small with one AI-written module page, flushed. */
async function generated() {
  const h = harness();
  const input = staticInputFromTruth("ts-small");
  h.store.applyStatic(input);
  const m = [...input.modules].sort((a, b) => b.paths.length - a.paths.length)[0];
  if (!m) throw new Error("no module");
  const entry = h.store.index().modules.find((e) => e.id === m.id);
  if (!entry) throw new Error("no module row");
  const md = `この部屋は設定を読み込み、検証してから渡す[[1]]。`;
  h.store.applyGenerated([aiBlock(entry.section, m.paths[0] as string, md)], opts);
  await h.store.flush({ force: true });
  const file = `doc/modules/${entry.slug}.md`;
  const bytes = h.mem?.files.get(file);
  if (!bytes) throw new Error(`no ${file}`);
  return { h, input, m, entry, file, bytes };
}

const NEW_ID = "md_zzzzzzzz" as ModuleId;
const renamed = (input: StaticDocInput, from: ModuleId, over: Partial<StaticDocInput["modules"][number]> = {}): StaticDocInput => ({
  ...input,
  modules: input.modules.map((x) => (x.id === from ? { ...x, id: NEW_ID, slug: `${x.slug}-2`, ...over } : x)),
});

describe("EX-01 a re-partition never stubs a generated module page", () => {
  test("the doc index carries the full member list of every module (the exact partition to restore)", async () => {
    const { h, input } = await generated();
    for (const m of input.modules) {
      const e = h.store.index().modules.find((x) => x.id === m.id);
      expect(e?.members).toEqual([...m.paths].sort());
    }
  });

  test("same files under a new module id: the page keeps its slug, section and bytes; nothing is tombstoned", async () => {
    const { h, input, m, entry, file, bytes } = await generated();
    const res = h.store.applyStatic(renamed(input, m.id));
    await h.store.flush({ force: true });
    expect(h.store.index().modules.find((e) => e.id === NEW_ID)).toMatchObject({ slug: entry.slug, section: entry.section, name: entry.name });
    expect(h.mem?.files.get(file)).toBe(bytes);
    expect(h.mem?.files.has(`doc/modules/${entry.slug}-2.md`)).toBe(false);
    const ai = h.store.section(entry.section)?.blocks.filter((b) => b.origin === "ai") ?? [];
    expect(ai).toHaveLength(1);
    expect(res.deleted.filter((id) => ai.some((b) => b.id === id))).toEqual([]);
    expect(ai[0]?.freshness).not.toBe("stale"); // identical membership: nothing to doubt
  });

  test("most files kept (a file joined the module): the page follows, marked possibly stale, with a notice", async () => {
    const { h, input, m, entry } = await generated();
    if (m.paths.length < 2) throw new Error("fixture module too small for the overlap case");
    const grown = [...m.paths, "src/ui/extra.ts"];
    expect(partitionOverlap(h.store.index().modules.find((e) => e.id === m.id) as never, grown)).toBeGreaterThanOrEqual(REATTACH_MIN);
    // a different module taking only one of the files is not a match
    expect(partitionOverlap(h.store.index().modules.find((e) => e.id === m.id) as never, [m.paths[0] as string, "a.ts", "b.ts"])).toBeLessThan(REATTACH_MIN);
    h.store.applyStatic(renamed(input, m.id, { paths: grown }));
    const ai = h.store.section(entry.section)?.blocks.filter((b) => b.origin === "ai") ?? [];
    expect(ai.map((b) => b.freshness)).toEqual(["stale"]);
    expect(h.events.events.some((e) => e.type === "notice" && e.key === "notice.doc.moduleReattached")).toBe(true);
  });

  test("no module holds those files any more: the page is kept as orphaned/<slug>.md before its section goes", async () => {
    const { h, input, m, entry, bytes } = await generated();
    const without = { ...input, modules: input.modules.filter((x) => x.id !== m.id) };
    h.store.applyStatic(without);
    await h.store.flush({ force: true });
    const kept = h.mem?.files.get(`orphaned/${entry.slug}.md`);
    expect(kept).toBeDefined();
    expect(kept).toContain("この部屋は設定を読み込み、検証してから渡す");
    expect(kept).toBe(bytes);
    expect(h.events.events.some((e) => e.type === "notice" && e.key === "notice.doc.moduleOrphaned")).toBe(true);
  });

  test("a parent module gets a new id: its children's pages are NOT taken with it, and the parent page follows its children", async () => {
    // the crit case: `internal` / `web` (parents) came back as md_… new ids and the cascade stubbed 14 child pages
    const h = harness();
    const base = staticInputFromTruth("ts-small");
    const [a, b] = base.modules;
    if (!a || !b) throw new Error("need two modules");
    const P = "md_pppppppp" as ModuleId;
    const parent = { ...a, id: P, slug: "parent", name: "親", paths: [], children: [a.id, b.id], loc: a.loc + b.loc };
    const input: StaticDocInput = { ...base, modules: [parent, ...base.modules.map((m) => (m.id === a.id || m.id === b.id ? { ...m, parent: P } : m))] };
    h.store.applyStatic(input);
    const rowOf = (id: ModuleId) => h.store.index().modules.find((e) => e.id === id);
    const childSec = rowOf(a.id)?.section as SectionId;
    const parentSec = rowOf(P)?.section as SectionId;
    h.store.applyGenerated([aiBlock(childSec, a.paths[0] as string, "子の部屋の説明[[1]]。")], opts);
    h.store.applyGenerated([{ ...aiBlock(parentSec, a.paths[0] as string, "親の部屋の説明[[1]]。"), aspect: "structure" }], opts);
    await h.store.flush({ force: true });
    const childFile = `doc/modules/${rowOf(a.id)?.slug}.md`;
    const childBytes = h.mem?.files.get(childFile);
    // re-partition: the same children under a parent with a new id
    const Q = "md_qqqqqqqq" as ModuleId;
    const moved: StaticDocInput = {
      ...input,
      modules: input.modules.map((m) => (m.id === P ? { ...m, id: Q, slug: "parent-2" } : m.parent === P ? { ...m, parent: Q } : m)),
    };
    h.store.applyStatic(moved);
    await h.store.flush({ force: true });
    expect(h.store.section(childSec)?.blocks.some((x) => x.origin === "ai" && x.md.includes("子の部屋の説明"))).toBe(true);
    expect(h.mem?.files.get(childFile)).toBe(childBytes);
    expect(rowOf(Q)).toMatchObject({ slug: "parent", section: parentSec });
    expect(h.store.section(parentSec)?.blocks.some((x) => x.origin === "ai" && x.md.includes("親の部屋の説明"))).toBe(true);
    expect(h.mem?.files.has("orphaned/parent.md")).toBe(false);
  });

  test("a page with static text only still goes with its module (no orphan file for stubs)", () => {
    const h = harness();
    const input = staticInputFromTruth("ts-small");
    h.store.applyStatic(input);
    const m = input.modules[0];
    if (!m) throw new Error("no module");
    const entry = h.store.index().modules.find((e) => e.id === m.id);
    h.store.applyStatic({ ...input, modules: input.modules.filter((x) => x.id !== m.id) });
    expect(h.store.section(entry?.section as SectionId)).toBeNull();
  });

  test("an untrusted doc.index.json member list is filtered to path strings on load", async () => {
    const { h } = await generated();
    const ix = h.store.index();
    expect(ix.modules.every((e) => (e.members ?? []).every((p) => typeof p === "string"))).toBe(true);
  });
});
