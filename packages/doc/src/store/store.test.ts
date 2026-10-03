import { describe, expect, test } from "bun:test";
import { type BlockId, type Cite, type ClaimChecks, canonicalJson, type Decision, DOC_TEMPLATE, type SectionId } from "@mitori/core";
import type { GeneratedBlock } from "../contract.ts";
import { harness, staticInputFromTruth } from "../test/harness.ts";
import { createAiMarkdownValidator } from "./index.ts";

const FIXTURES = ["ts-small", "py-small", "go-small", "rust-small", "mixed", "nongit", "injection", "secrets", "edge-inventory"];
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
    md: "課題を解く[[1]]。",
    claims: [],
    gen,
    ...over,
  };
}

function seeded() {
  const h = harness();
  h.store.applyStatic(staticInputFromTruth("ts-small"));
  return h;
}

describe("DOC-U-015 applyStatic", () => {
  test("every section of the TOC has content from static data alone (9 fixtures)", () => {
    for (const name of FIXTURES) {
      const h = harness();
      h.store.applyStatic(staticInputFromTruth(name));
      for (const s of h.store.sections()) {
        const kinds = h.store.section(s.id)?.blocks.map((b) => b.kind) ?? [];
        expect({ name, section: s.id, empty: kinds.filter((k) => k !== "heading").length === 0 }).toEqual({ name, section: s.id, empty: false });
      }
      expect(h.store.sections().filter((s) => !s.id.includes("/")).length).toBe(DOC_TEMPLATE.length);
    }
  });
  test("placeholders carry the estimate (≈N tok) and the section gets `est`", () => {
    const h = harness();
    const input = { ...staticInputFromTruth("go-small"), estimates: { s1: { inTokens: 4200, outTokens: 1800 }, s9: { inTokens: 12000, outTokens: 3100 } } };
    h.store.applyStatic(input);
    const ph = (s: SectionId) => h.store.section(s)?.blocks.find((b) => b.kind === "placeholder")?.md ?? "";
    expect(ph("s1")).toContain("「生成する ≈6k tok」");
    expect(ph("s9")).toContain("「生成する ≈15k tok」");
    expect(h.store.section("s1")?.node.est).toEqual({ inTokens: 4200, outTokens: 1800 });
  });
  test("static ids are staticBlockId(docId, slot); a second apply changes nothing", async () => {
    const h = seeded();
    const again = h.store.applyStatic(staticInputFromTruth("ts-small"));
    expect(again.written).toEqual([]);
    expect(again.proposals).toEqual([]);
    const ids = h.store.sections().flatMap((s) => s.blocks);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^b_[0-9a-hjkmnp-tv-z]{8}$/.test(id))).toBe(true);
  });
});

describe("DOC-U-009 deterministic serialize", () => {
  test("same input ⇒ same bytes; the sidecar equals canonicalJson(index); open+save writes nothing", async () => {
    const run = async () => {
      const h = seeded();
      h.store.applyGenerated(
        [block({ md: "課題を解く[[1]]。", claims: [{ n: 1, kind: "behavior", quote: "", cites: [cite("src/index.ts", 3, 9)], checks, verdict: "verified" }] })],
        opts,
      );
      await h.store.flush({ force: true });
      return h;
    };
    const a = await run();
    const b = await run();
    expect([...(a.mem?.files ?? [])]).toEqual([...(b.mem?.files ?? [])]);
    expect(a.mem?.files.get("doc.index.json")).toBe(canonicalJson(a.store.index()));
    expect(a.store.manifest()?.generatedAt).toBeNull();
    const writes = a.mem?.writes ?? 0;
    expect(await a.store.flush({ force: true })).toEqual([]);
    expect(a.mem?.writes).toBe(writes);
  });
});

describe("applyGenerated", () => {
  test("writes blocks with aspect headings, cite links and removes the placeholder", async () => {
    const h = seeded();
    const res = h.store.applyGenerated(
      [
        block({
          ref: "new:1",
          md: "積読を減らす[[1]]。読む順番も決める[[2]]。",
          claims: [
            { n: 1, kind: "behavior", quote: "", cites: [cite("src/index.ts", 3, 9)], checks, verdict: "verified" },
            { n: 2, kind: "behavior", quote: "", cites: [], checks, verdict: "inferred" },
          ],
        }),
        block({ ref: "new:2", aspect: "users", kind: "list", depth: "L1", md: "- 本を買いすぎる人" }),
      ],
      opts,
    );
    expect(Object.keys(res.idMap)).toEqual(["new:1", "new:2"]);
    const s1 = h.store.section("s1");
    expect(s1?.blocks.map((b) => [b.kind, b.aspect ?? null])).toEqual([
      ["heading", null],
      ["heading", "problem"],
      ["prose", "problem"],
      ["heading", "users"],
      ["list", "users"],
    ]);
    const prose = s1?.blocks[2];
    expect(prose?.md).toBe("積読を減らす（[index.ts:3-9](../../src/index.ts#L3-L9)）。読む順番も決める（推測）。");
    expect(h.store.markerForm(prose?.id as BlockId)).toBe("積読を減らす[[1]]。読む順番も決める[[2]]。");
    expect(h.store.claims(prose?.id as BlockId).map((c) => c.quote)).toEqual(["積読を減らす", "読む順番も決める"]);
    await h.store.flush({ force: true });
    expect(h.mem?.files.get("doc/01-what-why.md")).toBe(
      [
        "# 1. これは何か・誰のためか・なぜあるか <!-- b_hym5mfqc -->",
        "",
        `## 解決する課題 <!-- ${s1?.blocks[1]?.id} -->`,
        "",
        `積読を減らす（[index.ts:3-9](../../src/index.ts#L3-L9)）。読む順番も決める（推測）。 <!-- ${prose?.id} -->`,
        "",
        `## 利用者 <!-- ${s1?.blocks[3]?.id} -->`,
        "",
        `- 本を買いすぎる人 <!-- ${s1?.blocks[4]?.id} -->`,
        "",
      ].join("\n"),
    );
    // unchanged text is a no-op
    const again = h.store.applyGenerated([block({ id: prose?.id as BlockId, md: "積読を減らす[[1]]。読む順番も決める[[2]]。", claims: [] })], opts);
    expect(again.unchanged).toEqual([prose?.id as BlockId]);
  });
  test("DOC-U-008 locked blocks become proposals, never overwritten; mass delete is guarded", async () => {
    const h = seeded();
    const ids = Object.values(
      h.store.applyGenerated(
        [1, 2, 3, 4].map((i) => block({ ref: `new:${i}`, md: `文${i}。` })),
        opts,
      ).idMap,
    );
    const first = h.store.block(ids[0] as BlockId);
    await h.store.editBlock(ids[0] as BlockId, first?.hash as string, "人が直した文。", "human");
    const res = h.store.applyGenerated([block({ id: ids[0] as BlockId, md: "AI の新しい文。" })], opts);
    expect(res.written).toEqual([]);
    expect(res.proposals.length).toBe(1);
    expect(h.store.block(ids[0] as BlockId)?.md).toBe("人が直した文。");
    const del = h.store.applyGenerated([], { ...opts, deletes: ids.slice(1) as BlockId[], listed: 4 });
    expect(del.deleted.length).toBe(2);
    expect(del.proposals.length).toBe(1);
  });
});

describe("DOC-U-007 editBlock", () => {
  test("base mismatch, lock, cite links re-stamped, dropped claims reported", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated(
      [
        block({
          md: "`main` が起動する[[1]]。設定を読む[[2]]。",
          claims: [
            { n: 1, kind: "behavior", quote: "", cites: [cite("src/index.ts", 1, 5)], checks, verdict: "verified" },
            { n: 2, kind: "behavior", quote: "", cites: [cite("src/config.ts", 20, 26)], checks, verdict: "verified" },
          ],
        }),
      ],
      opts,
    ).written as BlockId[];
    const b = h.store.block(id as BlockId);
    await expect(h.store.editBlock(id as BlockId, "0".repeat(16), "x", "human")).rejects.toMatchObject({ code: "E_DOC_BASE_MISMATCH" });
    const keep = b?.md.split("。")[0];
    const res = await h.store.editBlock(id as BlockId, b?.hash as string, `${keep}。新しい出典（[a.ts:9999](../../src/a.ts#L9999)）。`, "human");
    expect(res.block.lock).toBe("human-edited");
    expect(res.block.origin).toBe("human");
    expect(res.dropped.length).toBe(1);
    expect(h.stamper.calls).toBe(1);
    expect(res.checks.map((c) => c.expected)).toEqual(["L0: the cited range exists"]);
    expect(h.store.claims(id as BlockId).map((c) => c.verdict)).toEqual(["verified", "unsupported"]);
    expect(h.store.history(id as BlockId).map((x) => x.source)).toEqual(["generate", "human_edit"]);
  });
});

describe("DOC-U-017 proposals, accept / reject / undo", () => {
  test("accept rebases sentence-wise, supersedes siblings, undo restores", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ md: "一文目。二文目。三文目。" })], opts).written as BlockId[];
    const base = h.store.block(id as BlockId)?.hash as string;
    const p1 = h.store.propose({
      block: id as BlockId,
      section: "s1",
      op: "update",
      baseHash: base,
      md: "一文目。二文目を AI が直した。三文目。",
      source: { kind: "sync", id: "j_1" },
      reason: "sync",
    });
    const p2 = h.store.propose({
      block: id as BlockId,
      section: "s1",
      op: "update",
      baseHash: base,
      md: "別案。",
      source: { kind: "sync", id: "j_2" },
      reason: "sync",
    });
    // a human edits another sentence meanwhile
    await h.store.editBlock(id as BlockId, base, "一文目を人が直した。二文目。三文目。", "human");
    const accepted = h.store.acceptProposal(p1.id);
    expect(accepted.md).toBe("一文目を人が直した。二文目を AI が直した。三文目。");
    expect(
      h.store
        .proposals({ block: id as BlockId })
        .map((p) => p.state)
        .sort(),
    ).toEqual(["accepted", "superseded", "superseded"]);
    expect(h.store.proposals({ state: "pending" })).toEqual([]);
    void p2;
    const accId = h.store.proposals({ state: "accepted" })[0]?.id as never;
    expect(h.store.undoAccept([accId])).toEqual({ reverted: [id as BlockId], diverged: [] });
    expect(h.store.block(id as BlockId)?.md).toBe("一文目を人が直した。二文目。三文目。");
  });
  test("overlapping changes conflict; reject; images are refused; external links counted", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ md: "一文目。二文目。" })], opts).written as BlockId[];
    const base = h.store.block(id as BlockId)?.hash as string;
    const p = h.store.propose({
      block: id as BlockId,
      section: "s1",
      op: "update",
      baseHash: base,
      md: "一文目。二文目 A。",
      source: { kind: "job", id: "j_1" },
      reason: "x",
    });
    await h.store.editBlock(id as BlockId, base, "一文目。二文目 B。", "human");
    expect(() => h.store.acceptProposal(p.id)).toThrow(expect.objectContaining({ code: "E_DOC_BASE_MISMATCH" }));
    expect(h.store.proposals({ block: id as BlockId })[0]?.conflict).toBe(true);
    h.store.rejectProposal(p.id);
    expect(h.store.proposals({ block: id as BlockId })[0]?.state).toBe("rejected");
    expect(() =>
      h.store.propose({
        block: id as BlockId,
        section: "s1",
        op: "update",
        baseHash: base,
        md: "![x](https://e.example/x.png)",
        source: { kind: "job", id: "j" },
        reason: "x",
      }),
    ).toThrow();
    const ext = h.store.propose({
      block: id as BlockId,
      section: "s1",
      op: "update",
      baseHash: base,
      md: "[docs](https://example.com)",
      source: { kind: "job", id: "j" },
      reason: "x",
    });
    expect(ext.externalLinks).toBe(1);
  });
  test("a proposal that changes the kind (list → table) applies it on accept; undo restores the kind", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ aspect: "users", kind: "list", depth: "L1", md: "- 本を買う人" })], opts).written as BlockId[];
    const b = h.store.block(id as BlockId);
    await h.store.editBlock(id as BlockId, b?.hash as string, "- 本を買いすぎる人", "human");
    const table = "| 利用者 | 目的 |\n|---|---|\n| 本を買いすぎる人 | 積読を減らす |";
    const res = h.store.applyGenerated([block({ id: id as BlockId, aspect: "users", kind: "table", depth: "L1", md: table })], opts);
    const accepted = h.store.acceptProposal(res.proposals[0] as never);
    expect([accepted.kind, accepted.md]).toEqual(["table", table]);
    await h.store.flush({ force: true });
    expect(h.mem?.files.get("doc/01-what-why.md")).toContain(`${table}\n<!-- ${id} -->`);
    h.store.undoAccept([res.proposals[0] as never]);
    expect(h.store.block(id as BlockId)?.kind).toBe("list");
  });
  test("the manifest models / prompt versions and the appendix meta follow the AI blocks", async () => {
    const h = seeded();
    h.store.applyGenerated([block({ md: "一文。" }), block({ aspect: "users", kind: "list", md: "- 人", gen: { ...gen, promptVer: "gen.overview@2" } })], opts);
    expect([h.store.manifest()?.models, h.store.manifest()?.generator.prompts]).toEqual([["claude-sonnet-5-5"], { "gen.overview": "gen.overview@2" }]);
    expect(h.store.section("appendix")?.blocks.find((b) => b.slot === "ap:meta")?.md).toContain("- モデル: claude-sonnet-5-5");
    await h.store.flush({ force: true });
    expect(JSON.parse(h.mem?.files.get("mitori.json") ?? "{}").models).toEqual(["claude-sonnet-5-5"]);
  });
  test("§10.8 diagram IR weights are stored rounded to 4 decimals", () => {
    const h = seeded();
    const diagram = {
      kind: "flow" as const,
      nodes: [
        { id: "a", label: "A", weight: 0.123456 },
        { id: "b", label: "B" },
      ],
      edges: [{ id: "e1", from: "a", to: "b", kind: "calls" as const }],
      groups: [],
      direction: "RIGHT" as const,
      origin: "ai" as const,
    };
    const [id] = h.store.applyGenerated([block({ section: "s3", aspect: "intro", kind: "diagram", depth: "L1", md: "流れ", diagram })], opts)
      .written as BlockId[];
    const dg = h.store.block(id as BlockId)?.diagram as string;
    expect(h.store.index().diagrams[dg as never]?.nodes.map((n) => n.weight)).toEqual([0.1235, undefined]);
  });
  test("a proposal on a static block keeps its base: a later static update still merges sentence-wise on accept", () => {
    const h = seeded();
    const b = h.store.section("s0")?.blocks.find((x) => x.slot === "s0:badges");
    const proposed = (b?.md ?? "").replace("- 規模:", "- 規模（人が補足）:");
    const p = h.store.propose({
      block: b?.id as BlockId,
      section: "s0",
      op: "update",
      baseHash: b?.hash as string,
      md: proposed,
      source: { kind: "sync", id: "j_1" },
      reason: "x",
    });
    h.store.applyStatic({ ...staticInputFromTruth("ts-small"), license: "MIT" });
    const accepted = h.store.acceptProposal(p.id);
    expect(accepted.md).toContain("- 規模（人が補足）:");
    expect(accepted.md).toContain("- ライセンス: MIT");
  });
  test("insert proposals land after their anchor; undo removes them", () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ md: "既存。" })], opts).written as BlockId[];
    const p = h.store.propose({
      block: null,
      section: "s1",
      after: id as BlockId,
      op: "insert",
      baseHash: null,
      md: "追加の段落。",
      source: { kind: "answer_promote", id: "th_1" },
      reason: "x",
    });
    const b = h.store.acceptProposal(p.id);
    const order = h.store.section("s1")?.node.blocks ?? [];
    expect(order.indexOf(b.id)).toBe(order.indexOf(id as BlockId) + 1);
    expect(h.store.undoAccept([p.id])).toEqual({ reverted: [b.id], diverged: [] });
    expect(h.store.block(b.id)).toBeNull();
  });
});

describe("DOC-U-018 flush cadence and DOC-U-030 cite moves", () => {
  test("changes are written ≤ 500 ms later (FakeClock), 2 s while generating", async () => {
    const h = harness();
    h.store.applyStatic(staticInputFromTruth("py-small"));
    expect(h.mem?.writes).toBe(0);
    h.clock.advance(499);
    await Promise.resolve();
    expect(h.mem?.writes).toBe(0);
    h.clock.advance(1);
    await h.store.flush();
    expect(h.mem?.files.has("doc/00-tldr.md")).toBe(true);
    const before = h.mem?.writes ?? 0;
    h.store.applyGenerated([block({ md: "生成中の文。" })], opts);
    h.clock.advance(600);
    await Promise.resolve();
    expect(h.mem?.writes).toBe(before);
    h.clock.advance(1400);
    await h.store.flush();
    expect(h.mem?.files.get("doc/01-what-why.md")).toContain("生成中の文。");
  });
  test("a 3-line re-anchor is visible at once; the Markdown cite flush waits until 10 s quiet", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated(
      [block({ md: "起動する[[1]]。", claims: [{ n: 1, kind: "behavior", quote: "", cites: [cite("src/index.ts", 10, 20)], checks, verdict: "verified" }] })],
      opts,
    ).written as BlockId[];
    await h.store.flush({ force: true });
    const [claim] = h.store.claims(id as BlockId);
    h.store.setClaimChecks([{ id: claim?.id as never, checks, cites: [cite("src/index.ts", 13, 23)] }]);
    expect(h.store.section("s1")?.blocks.find((b) => b.id === id)?.md).toBe("起動する（[index.ts:13-23](../../src/index.ts#L13-L23)）。");
    expect(h.store.blocksCiting("src/index.ts", 21, 21)).toEqual([id as BlockId]);
    await h.store.flush();
    expect(h.mem?.files.get("doc/01-what-why.md")).toContain("#L10-L20");
    h.clock.advance(10_000);
    await h.store.flush();
    expect(h.mem?.files.get("doc/01-what-why.md")).toContain("#L13-L23");
    expect(h.mem?.files.get("doc.index.json")).toContain('"start": 13');
  });
});

describe("verification, freshness, decisions, glossary, flows, translations", () => {
  test("setVerified marks claims human-verified with the git user, and back", () => {
    const h = seeded();
    const [id] = h.store.applyGenerated(
      [block({ md: "文[[1]]。", claims: [{ n: 1, kind: "fact", quote: "", cites: [cite("a.ts", 1, 1)], checks, verdict: "verified" }] })],
      opts,
    ).written as BlockId[];
    const v = h.store.setVerified(id as BlockId, true, "Satoki <s@example.com>");
    expect(v.lock).toBe("human-verified");
    expect(h.store.claims(id as BlockId)[0]?.verifiedBy?.name).toBe("Satoki <s@example.com>");
    expect(h.store.claims(id as BlockId)[0]?.verdict).toBe("human-verified");
    h.store.setVerified(id as BlockId, false, "Satoki <s@example.com>");
    expect(h.store.block(id as BlockId)?.lock).toBeUndefined();
    expect(h.store.claims(id as BlockId)[0]?.verdict).toBe("verified");
    h.store.setFreshness([id as BlockId], "stale");
    expect(h.events.events.some((e) => e.type === "doc.freshness")).toBe(true);
  });
  test("writeDecision validates, writes decisions/<id>.md and refreshes s10:decisions; supersedes rewrites the status line", async () => {
    const h = seeded();
    const d: Decision = {
      id: "dc_00000001",
      title: "再試行は 1 回",
      status: "accepted",
      blocks: [],
      cites: [],
      file: "decisions/dc_00000001.md",
      decidedAt: "2026-01-02T00:00:00.000Z",
    };
    expect(() => h.store.writeDecision({ ...d }, "no heading")).toThrow();
    h.store.writeDecision({ ...d }, "# DC: 再試行は 1 回\n\n- id: dc_00000001\n- status: accepted\n");
    h.store.writeDecision(
      { ...d, id: "dc_00000002", file: "decisions/dc_00000002.md", supersedes: "dc_00000001" },
      "# DC: 2 回にする\n\n- id: dc_00000002\n- status: accepted\n",
    );
    await h.store.flush({ force: true });
    expect(h.mem?.files.get("decisions/dc_00000001.md")).toContain("- status: superseded");
    expect(h.mem?.files.get("doc/10-decisions.md")).toContain("[再試行は 1 回](../decisions/dc_00000001.md)");
    expect(h.store.decisions().map((x) => x.status)).toEqual(["superseded", "accepted"]);
  });
  test("setGlossary: yomi order, romaji, usedIn, the s12 table replaces the placeholder", () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ md: "積読と認証の話。" })], opts).written as BlockId[];
    h.store.setGlossary([
      { term: "認証", yomi: "にんしょう", definition: "本人確認。" },
      { term: "積読", yomi: "つんどく", en: "tsundoku", definition: "買って読まない本。" },
    ]);
    const g = h.store.index().glossary;
    expect(g.map((x) => [x.term, x.romaji, x.usedIn])).toEqual([
      ["積読", "tsundoku", [id as BlockId]],
      ["認証", "ninshou", [id as BlockId]],
    ]);
    expect(h.store.section("s12")?.blocks.map((b) => b.kind)).toEqual(["heading", "table"]);
  });
  test("flow sub-sections are numbered by order and renumbered on reorder", () => {
    const h = seeded();
    h.store.upsertFlowSection("login", "ログイン", 0);
    h.store.upsertFlowSection("export", "書き出し", 0);
    const heads = () => ["s3/export", "s3/login"].map((s) => h.store.section(s as SectionId)?.blocks[0]?.md);
    expect(heads()).toEqual(["## 3.1 書き出し", "## 3.2 ログイン"]);
    h.store.removeSection("s3/export");
    expect(h.store.section("s3/login")?.blocks[0]?.md).toBe("## 3.1 ログイン");
    expect(() => h.store.upsertFlowSection("../x", "x", 0)).toThrow();
  });
  test("translations are cached per source hash", async () => {
    const h = seeded();
    const [id] = h.store.applyGenerated([block({ md: "原文。" })], opts).written as BlockId[];
    const b = h.store.block(id as BlockId);
    h.store.putTranslation({
      block: id as BlockId,
      srcHash: b?.hash as string,
      lang: "en",
      md: "Source.",
      promptVer: "doc.translate@1",
      model: "claude-haiku-4-5",
    });
    expect(h.store.translation(id as BlockId, "en")?.md).toBe("Source.");
    await h.store.editBlock(id as BlockId, b?.hash as string, "原文を直した。", "human");
    expect(h.store.translation(id as BlockId, "en")).toBeNull();
  });
});

describe("AiMarkdownValidator (V13)", () => {
  const v = createAiMarkdownValidator();
  test("images, raw HTML, ID comments and external autolinks are invalid; external links are counted", () => {
    const r = (md: string) => v.validate(md, { lang: "ja", allowRepoLinks: true });
    expect(r("文（[a.ts:1](../a.ts#L1)）。[設計](../README.md)").ok).toBe(true);
    expect(r("![x](a.png)").ok).toBe(false);
    expect(r("<b>x</b>").ok).toBe(false);
    expect(r("文 <!-- b_aaaaaaaa -->").ok).toBe(false);
    expect(r("<https://evil.example>").ok).toBe(false);
    expect(r("[x](javascript:alert(1))").ok).toBe(false);
    expect(r("[a](https://a.example) と [b](https://b.example)")).toEqual({ ok: true, errors: [], externalLinks: 2 });
    expect(v.validate("[設計](../README.md)", { lang: "ja", allowRepoLinks: false }).ok).toBe(false);
    expect(r("`<!-- b_aaaaaaaa -->` と `<b>`").ok).toBe(true);
  });
});
