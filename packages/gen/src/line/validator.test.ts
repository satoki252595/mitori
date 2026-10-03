import { describe, expect, test } from "bun:test";
import type { BlockAspect, BlockId, ModuleId, SectionId } from "@mitori/core";
import type { CitableSet, ExistingRef, GenBlockLine, GenLineType, LineVerdict, ValidationContext } from "../contract.ts";
import { sectionAspects } from "./aspects.ts";
import { parseCompactClaim } from "./claims.ts";
import { createLineValidator } from "./index.ts";

const MOD = "md_7hq2m4xa" as ModuleId;
const B1 = "b_k3f9a2cq" as BlockId;
const B2 = "b_m3p5a7s9" as BlockId;

function citable(files: Record<string, number>, shown?: Record<string, [number, number]>): CitableSet {
  return {
    lines: (p) => files[p] ?? null,
    allows: (p, s, e) => {
      const r = shown?.[p];
      return r ? s >= r[0] - 2 && e <= r[1] + 2 : files[p] !== undefined;
    },
  };
}

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  const sections = over.sections ?? (["s6/internal-session"] as SectionId[]);
  return {
    prompt: "gen.module",
    form: "compact",
    lang: "ja",
    lineTypes: ["block", "keep", "delete", "module", "term", "question", "end"] satisfies GenLineType[],
    primarySection: sections[0] as SectionId,
    sections,
    aspectsOf: (s) => sectionAspects(s, "leaf"),
    existing: new Map(),
    modules: new Set([MOD]),
    citable: citable({ "internal/session/store.go": 400, "internal/session/ttl.go": 40 }),
    flows: { min: 0, max: 0 },
    requiredAspects: ["responsibility", "interface"],
    moduleLineRequired: true,
    ...over,
  };
}

function run(lines: string[], c = ctx()) {
  const v = createLineValidator(c);
  const verdicts = lines.map((l, i) => v.validate(l, i + 1));
  return { verdicts, v };
}

function blockOf(v: LineVerdict | undefined): GenBlockLine {
  if (v?.value?.t !== "block") throw new Error(`not a block verdict: ${JSON.stringify(v)}`);
  return v.value;
}

const rules = (v: LineVerdict) => v.errors.map((e) => e.expected.split(" ")[0]);
const j = (o: unknown) => JSON.stringify(o);

const responsibility = j({
  t: "block",
  id: "new:2",
  aspect: "responsibility",
  md: "ブラウザごとのセッションを発行・検証・失効させる[[1]]。認可の判定は行わない[[2]]。",
  claims: { "1": "architecture internal/session/store.go:12-30", "2": "architecture" },
});
const iface = j({
  t: "block",
  id: "new:3",
  aspect: "interface",
  md: "- `Store.Get` は期限切れなら `ErrExpired` を返す[[1]]。\n- `Store.Put` は保存する[[2]]。",
  claims: { "1": "behavior internal/session/store.go:40-58", "2": "behavior internal/session/store.go:60-71" },
});

describe("GEN-U-010 NDJSON line validation — valid lines of every type", () => {
  test("compact block, full block, keep, delete, module, flow, term, question, verdict, end are all accepted", () => {
    const existing = new Map<BlockId, ExistingRef>([
      [B1, { id: B1, aspect: "learn", kind: "learn", origin: "ai", stale: false, claims: 0 }],
      [B2, { id: B2, aspect: "recap", kind: "recap", origin: "ai", stale: false, claims: 0 }],
    ]);
    const c = ctx({ existing, lineTypes: ["block", "keep", "delete", "module", "flow", "term", "question", "verdict", "end"], flows: { min: 0, max: 5 } });
    const { verdicts } = run(
      [
        responsibility,
        iface,
        j({
          t: "block",
          id: "new:4",
          section: "s6/internal-session",
          aspect: "data",
          kind: "table",
          depth: "L2",
          audience: ["dev"],
          md: "| a | b |\n|---|---|\n| 1 | 2 |",
          claims: [],
        }),
        j({ t: "keep", id: B1 }),
        j({ t: "delete", id: B2 }),
        j({ t: "module", module: MOD, name: "セッション管理", summary: "セッションを発行・検証・失効させる" }),
        j({ t: "flow", key: "login", title: "ログイン" }),
        j({ t: "term", term: "セッション", yomi: "せっしょん", en: "session", def: "ログイン状態を保つ記録。" }),
        j({ t: "question", section: "s6/internal-session", text: "期限はどこで設定するか", cites: [{ path: "internal/session/ttl.go", start: 3, end: 5 }] }),
        j({ t: "verdict", claim: "cl_a1b2c3d4", v: "S" }),
        j({ t: "end", blocks: 3 }),
      ],
      c,
    );
    for (const v of verdicts) expect(v.errors).toEqual([]);
    expect(verdicts.map((v) => v.value?.t)).toEqual(["block", "block", "block", "keep", "delete", "module", "flow", "term", "question", "verdict", "end"]);
    const b = blockOf(verdicts[1]);
    expect(b.section).toBe("s6/internal-session");
    expect(b.kind).toBe("list");
    expect(b.depth).toBe("L2");
    expect(b.audience).toEqual(["dev"]);
    expect(b.claims).toEqual([
      { n: 1, kind: "behavior", cites: [{ path: "internal/session/store.go", start: 40, end: 58 }] },
      { n: 2, kind: "behavior", cites: [{ path: "internal/session/store.go", start: 60, end: 71 }] },
    ]);
  });
});

describe("GEN-U-011 / GEN-U-012 non-JSON lines are rejected, other lines still commit", () => {
  test("V01 for prose, a lone brace, trailing comma and two objects on one line", () => {
    const { verdicts } = run(["Here is the page:", "{", '{"t":"end","blocks":0,}', '{"t":"end","blocks":0}{"t":"end","blocks":0}', responsibility]);
    expect(verdicts.slice(0, 4).map(rules)).toEqual([["V01"], ["V01"], ["V01"], ["V01"]]);
    expect(verdicts[4]?.value?.t).toBe("block");
    expect(verdicts[0]?.errors[0]?.code).toBe("E_GEN_OUTPUT_INVALID");
    expect(verdicts[0]?.errors[0]?.at).toBe("L1");
  });
});

describe("GEN-U-013 unknown type, missing fields, wrong types", () => {
  test("V02 unknown / disallowed t, V03 missing md and bad depth, at most 5 errors per line", () => {
    const { verdicts } = run([
      j({ t: "paragraph" }),
      j({ t: "flow", key: "x", title: "y" }),
      j({ t: "block", id: "new:1", aspect: "responsibility" }),
      j({ t: "block", id: "new:1", aspect: "responsibility", depth: "L4", md: "x" }),
      j({ t: "block", id: "nope", aspect: "interface", kind: 7, depth: "L9", audience: "dev", md: "", claims: 5, after: 9 }),
    ]);
    expect(rules(verdicts[0] as LineVerdict)).toEqual(["V02"]);
    expect(rules(verdicts[1] as LineVerdict)).toEqual(["V02"]);
    expect(rules(verdicts[2] as LineVerdict)).toEqual(["V03"]);
    expect(verdicts[2]?.errors[0]?.at).toBe("L3/md");
    expect(rules(verdicts[3] as LineVerdict)).toEqual(["V03"]);
    expect(verdicts[4]?.errors.length).toBe(5);
  });

  test("V07 kind not allowed for the aspect, V08 depth outside default ± 1, V06 aspect not in section", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", aspect: "interface", kind: "prose", md: "x", claims: {} }),
      j({ t: "block", id: "new:2", aspect: "interface", depth: "L0", md: "x", claims: {} }),
      j({ t: "block", id: "new:3", aspect: "tldr", md: "x", claims: {} }),
      j({ t: "block", id: "new:4", aspect: "nonsense", md: "x" }),
    ]);
    expect(verdicts.map(rules)).toEqual([["V07"], ["V08"], ["V06"], ["V06"]]);
  });

  test("full form requires kind, depth and audience", () => {
    const { verdicts } = run([j({ t: "block", id: "new:1", aspect: "responsibility", md: "x", claims: [] })], ctx({ form: "full" }));
    expect(rules(verdicts[0] as LineVerdict)).toEqual(["V03", "V03", "V03"]);
  });
});

describe("GEN-U-014 markers vs claims (V14) and compact claim grammar (V03)", () => {
  test("missing claim, missing marker, repeated marker, marker only inside code", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "A[[1]]。B[[2]]。", claims: { "1": "fact" } }),
      j({ t: "block", id: "new:2", aspect: "responsibility", md: "A。", claims: { "1": "fact" } }),
      j({ t: "block", id: "new:3", aspect: "responsibility", md: "A[[1]]。B[[1]]。", claims: { "1": "fact" } }),
      j({ t: "block", id: "new:4", aspect: "responsibility", md: "`x[[1]]` だ。", claims: { "1": "fact" } }),
    ]);
    expect(verdicts.map(rules)).toEqual([["V14"], ["V14"], ["V14"], ["V14"]]);
    expect(verdicts[3]?.errors[0]?.actual).toContain("code span");
  });

  test("compact grammar violations are V03", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "A[[1]]。", claims: { "1": "claimy internal/session/store.go:1-2" } }),
      j({ t: "block", id: "new:2", aspect: "responsibility", md: "A[[1]]。", claims: { "1": "behavior internal/session/store.go" } }),
      j({ t: "block", id: "new:3", aspect: "responsibility", md: "A[[1]]。", claims: { x: "behavior" } }),
    ]);
    expect(verdicts.map(rules)).toEqual([
      ["V03", "V14"],
      ["V03", "V14"],
      ["V03", "V14"],
    ]);
  });
});

describe("GEN-U-040 compact claims grammar (PT-03)", () => {
  test("kind alone, single line, range, bare file name reusing the directory, spaces after commas", () => {
    expect(parseCompactClaim("architecture")).toEqual({ kind: "architecture", cites: [] });
    expect(parseCompactClaim("fact pkg/a.go:42")).toEqual({ kind: "fact", cites: [{ path: "pkg/a.go", start: 42, end: 42 }] });
    expect(parseCompactClaim("behavior internal/session/store.go:40-58,store.go:70-72, ttl.go:3-4")).toEqual({
      kind: "behavior",
      cites: [
        { path: "internal/session/store.go", start: 40, end: 58 },
        { path: "internal/session/store.go", start: 70, end: 72 },
        { path: "internal/session/ttl.go", start: 3, end: 4 },
      ],
    });
    expect(parseCompactClaim("behavior a/x.go:1-2,b/y.go:3-4,z.go:5")).toEqual({
      kind: "behavior",
      cites: [
        { path: "a/x.go", start: 1, end: 2 },
        { path: "b/y.go", start: 3, end: 4 },
        { path: "b/z.go", start: 5, end: 5 },
      ],
    });
    expect(typeof parseCompactClaim("unknown a.go:1")).toBe("string");
    expect(typeof parseCompactClaim("behavior a.go")).toBe("string");
    expect(typeof parseCompactClaim("behavior a.go:x-y")).toBe("string");
  });
});

describe("GEN-U-015 cite ranges: ≤ 2 lines past the end is clamped (W04), more is V18", () => {
  test("clamp, swap, start 0, too far, too long, path not shown", () => {
    const mk = (n: number, cite: string) => j({ t: "block", id: `new:${n}`, aspect: "responsibility", md: "A[[1]]。", claims: { "1": `behavior ${cite}` } });
    const { verdicts } = run([
      mk(1, "internal/session/ttl.go:38-42"),
      mk(2, "internal/session/ttl.go:12-10"),
      mk(3, "internal/session/ttl.go:0-3"),
      mk(4, "internal/session/ttl.go:38-43"),
      mk(5, "internal/session/store.go:1-201"),
      mk(6, "internal/other.go:1-3"),
    ]);
    expect(verdicts.slice(0, 3).map((v) => [v.errors.length, v.warnings])).toEqual([
      [0, ["W04"]],
      [0, ["W04"]],
      [0, ["W04"]],
    ]);
    expect(verdicts.slice(3).map(rules)).toEqual([["V18"], ["V18"], ["V17"]]);
    const raw = blockOf(verdicts[0]).claims as { cites: unknown[] }[];
    expect(raw[0]?.cites).toEqual([{ path: "internal/session/ttl.go", start: 38, end: 42 }]);
  });

  test("V17 when the range was not shown to the task", () => {
    const c = ctx({ citable: citable({ "a.go": 300 }, { "a.go": [10, 20] }) });
    const { verdicts } = run([j({ t: "block", id: "new:1", aspect: "responsibility", md: "A[[1]]。", claims: { "1": "behavior a.go:100-110" } })], c);
    expect(rules(verdicts[0] as LineVerdict)).toEqual(["V17"]);
  });
});

describe("GEN-U-016 forbidden Markdown", () => {
  test("raw HTML V11, ID comment / link / image / autolink V13, headings V12; code is exempt", () => {
    const mk = (n: number, md: string) => j({ t: "block", id: `new:${n}`, aspect: "responsibility", md, claims: {} });
    const { verdicts } = run([
      mk(1, "これは <b>強調</b> だ。"),
      mk(2, "説明 <!-- b_k3f9a2cq -->"),
      mk(3, "[README](README.md) を見る。"),
      mk(4, "![図](x.png)"),
      mk(5, "<https://example.com>"),
      mk(6, "# 見出し\n本文"),
      mk(7, "本文\n==="),
      mk(8, "`<div>` と `[a](b)` はコードなので許す。"),
      mk(9, "```html\n<div>\n# not a heading\n```"),
    ]);
    expect(verdicts.map(rules)).toEqual([["V11"], ["V13"], ["V13"], ["V13"], ["V13"], ["V12"], ["V12"], [], []]);
  });

  test("V27 table kind must be a GFM table, V10 md over the kind limit", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", aspect: "interface", kind: "table", md: "a | b\nnot a separator", claims: {} }),
      j({ t: "block", id: "new:2", aspect: "responsibility", md: "あ".repeat(901), claims: {} }),
      j({ t: "block", id: "new:3", aspect: "responsibility", md: "あ".repeat(900), claims: {} }),
    ]);
    expect(verdicts.map(rules)).toEqual([["V27"], ["V10"], []]);
  });
});

describe("GEN-U-017 sections, foreign ids, duplicate new refs, unknown after", () => {
  test("V05 / V04 / V03 / V04", () => {
    const { verdicts } = run([
      responsibility,
      j({ t: "block", id: "new:5", section: "s7", aspect: "responsibility", md: "x", claims: {} }),
      j({ t: "block", id: B1, aspect: "responsibility", md: "x", claims: {} }),
      j({ t: "block", id: "new:2", aspect: "responsibility", md: "x", claims: {} }),
      j({ t: "block", id: "new:6", aspect: "responsibility", md: "x", claims: {}, after: "new:9" }),
      j({ t: "block", id: "new:7", aspect: "responsibility", md: "x", claims: {}, after: "new:2" }),
    ]);
    expect(verdicts.map(rules)).toEqual([[], ["V05"], ["V04"], ["V03"], ["V04"], []]);
  });

  test("W03 normalizes a bare section suffix and case / separator variants", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", section: "internal-session", aspect: "Responsibility", md: "x", claims: {} }),
      j({ t: "block", id: "new:2", section: "S6/Internal_Session", aspect: "edge-cases", md: "x", claims: {} }),
    ]);
    expect(verdicts[0]?.errors).toEqual([]);
    expect(verdicts[0]?.warnings).toEqual(["W03"]);
    expect(blockOf(verdicts[0]).section).toBe("s6/internal-session");
    expect(rules(verdicts[1] as LineVerdict)).toEqual(["V06"]);
  });
});

describe("GEN-U-020 framing noise", () => {
  test("CRLF and BOM are stripped, fence lines are W01, prose is V01", () => {
    const { verdicts } = run(["﻿```json", `${responsibility}\r`, "```", "", "Sure! Here you go."]);
    expect(verdicts[0]?.warnings).toEqual(["W01"]);
    expect(verdicts[0]?.value).toBeUndefined();
    expect(verdicts[1]?.value?.t).toBe("block");
    expect(verdicts[2]?.warnings).toEqual(["W01"]);
    expect(verdicts[3]).toEqual({ line: 4, errors: [], warnings: [] });
    expect(rules(verdicts[4] as LineVerdict)).toEqual(["V01"]);
  });
});

describe("GEN-U-021 the end line is informational; coverage is checked independently", () => {
  test("missing end or wrong count does not fail coverage when the aspects and module line are present", () => {
    const { v } = run([responsibility, iface, j({ t: "module", module: MOD, name: "セッション" }), j({ t: "end", blocks: 9 })]);
    expect(v.finish("end").ok).toBe(true);
    const r2 = run([responsibility, iface, j({ t: "module", module: MOD, name: "セッション" })]);
    expect(r2.v.finish("end").ok).toBe(true);
  });

  test("required aspect, module line and truncation drive coverage", () => {
    const { v } = run([responsibility]);
    expect(v.finish("end")).toEqual({
      missingAspects: ["interface"],
      unaccounted: [],
      moduleLineMissing: true,
      flows: 0,
      blocks: 1,
      truncated: false,
      ok: false,
    });
    const t = run([responsibility, iface, j({ t: "module", module: MOD, name: "x" })]);
    expect(t.v.finish("budget").truncated).toBe(true);
    expect(t.v.finish("budget").ok).toBe(false);
  });
});

describe("GEN-U-022 lines over 16 KiB are V30", () => {
  test("V30 without parsing", () => {
    const big = j({ t: "block", id: "new:1", aspect: "responsibility", md: "あ".repeat(6000), claims: {} });
    const { verdicts } = run([big]);
    expect(rules(verdicts[0] as LineVerdict)).toEqual(["V30"]);
  });
});

describe("AC-10 LLM-written stamps are ignored (W02)", () => {
  test("blob / snippet / symbol / hash / model keys are dropped from the line and the cites", () => {
    const line = j({
      t: "block",
      id: "new:1",
      aspect: "responsibility",
      md: "A[[1]]。",
      model: "gpt",
      hash: "x",
      claims: [{ n: 1, kind: "fact", cites: [{ path: "internal/session/store.go", start: 1, end: 2, blob: "deadbeef", snippet: "x", symbol: "s" }] }],
    });
    const { verdicts } = run([line]);
    expect(verdicts[0]?.warnings).toEqual(["W02"]);
    const value = blockOf(verdicts[0]);
    expect(Object.keys(value).sort()).toEqual(["aspect", "audience", "claims", "depth", "id", "kind", "md", "section", "t"]);
    expect(value.claims).toEqual([{ n: 1, kind: "fact", cites: [{ path: "internal/session/store.go", start: 1, end: 2 }] }]);
  });
});

describe("W07 marker after the sentence terminator moves before it", () => {
  test("ja and en", () => {
    const { verdicts } = run([
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "返す。[[1]]Then it works.[[2]]", claims: { "1": "fact", "2": "fact" } }),
    ]);
    expect(verdicts[0]?.warnings).toEqual(["W07"]);
    expect(blockOf(verdicts[0]).md).toBe("返す[[1]]。Then it works[[2]].");
  });
});

describe("regeneration accounting (AC-12)", () => {
  const existing = new Map<BlockId, ExistingRef>([
    [B1, { id: B1, aspect: "responsibility", kind: "prose", origin: "ai", stale: false, claims: 0 }],
    [B2, { id: B2, aspect: "interface", kind: "list", origin: "human", lock: "human-edited", stale: true, claims: 1 }],
  ]);
  test("duplicate accounting V26, unlisted / static ids V29, missing ids are reported unaccounted (W06)", () => {
    const { verdicts, v } = run(
      [
        j({ t: "block", id: B1, aspect: "responsibility", md: "x", claims: {} }),
        j({ t: "keep", id: B1 }),
        j({ t: "delete", id: "b_zzzzzzzz" }),
        iface,
        j({ t: "module", module: MOD, name: "x" }),
      ],
      ctx({ existing }),
    );
    expect(verdicts.map(rules)).toEqual([[], ["V26"], ["V29"], [], []]);
    expect(v.finish("end").unaccounted).toEqual([B2]);
  });

  test("keep / delete outside regeneration are V02", () => {
    const { verdicts } = run([j({ t: "keep", id: B1 })]);
    expect(rules(verdicts[0] as LineVerdict)).toEqual(["V02"]);
  });
});

describe("module, term, flow lines", () => {
  test("V23 foreign module and long name, V22 missing yomi and > 3 sentences", () => {
    const { verdicts } = run([
      j({ t: "module", module: "md_aaaaaaaa", name: "x" }),
      j({ t: "module", module: MOD, name: "あ".repeat(21) }),
      j({ t: "term", term: "認証", def: "本人確認。" }),
      j({ t: "term", term: "認証", yomi: "にんしょう", def: "一。二。三。四。" }),
      j({ t: "term", term: "認証", yomi: "ninshou", def: "本人確認。" }),
    ]);
    expect(verdicts.map(rules)).toEqual([["V23"], ["V23"], ["V22"], ["V22"], ["V22"]]);
  });

  const flowsCtx = () =>
    ctx({
      prompt: "gen.flows",
      lineTypes: ["block", "flow", "question", "end"],
      sections: ["s3"],
      primarySection: "s3",
      aspectsOf: (s) => sectionAspects(s, "leaf"),
      flows: { min: 2, max: 2 },
      requiredAspects: ["intro", "summary", "steps"],
      moduleLineRequired: false,
      modules: new Set([MOD]),
    });

  test("flow blocks take the current flow's section; V24 for blocks before the flow line, duplicates and too many flows", () => {
    const { verdicts, v } = run(
      [
        j({ t: "block", id: "new:1", aspect: "intro", md: "入口から順に処理する。", claims: {} }),
        j({ t: "block", id: "new:2", aspect: "summary", md: "x", claims: {} }),
        j({ t: "flow", key: "login", title: "ログイン" }),
        j({ t: "block", id: "new:3", aspect: "summary", md: "ログインの流れ。", claims: {} }),
        j({ t: "block", id: "new:4", aspect: "steps", md: "1. 受け取る", claims: {} }),
        j({ t: "flow", key: "login", title: "again" }),
        j({ t: "flow", key: "logout", title: "ログアウト" }),
        j({ t: "block", id: "new:5", section: "s3/logout", aspect: "summary", md: "x", claims: {} }),
        j({ t: "flow", key: "third", title: "三つ目" }),
        j({ t: "block", id: "new:6", section: "s3/nope", aspect: "summary", md: "x", claims: {} }),
      ],
      flowsCtx(),
    );
    expect(verdicts.map(rules)).toEqual([[], ["V24"], [], [], [], ["V24"], [], [], ["V24"], ["V24"]]);
    expect(blockOf(verdicts[3]).section).toBe("s3/login");
    const cov = v.finish("end");
    expect(cov.flows).toBe(2);
    expect(cov.missingAspects).toEqual(["steps"]);
    expect(cov.ok).toBe(false);
  });

  test("V20 / V21 diagrams (flows limit 12 nodes, unknown edge node, seq gaps, unknown module ref)", () => {
    let n = 10;
    const seq = (over: object) =>
      j({
        t: "block",
        id: `new:${n++}`,
        aspect: "sequence",
        md: "流れの図。",
        claims: {},
        diagram: {
          kind: "sequence",
          nodes: [
            { id: "user", label: "利用者", shape: "actor" },
            { id: MOD, label: "セッション", ref: { module: MOD } },
          ],
          edges: [{ id: "e1", from: "user", to: MOD, kind: "calls", seq: 1 }],
          ...over,
        },
      });
    const lines = [
      j({ t: "flow", key: "login", title: "ログイン" }),
      seq({}),
      seq({ edges: [{ id: "e1", from: "user", to: "ghost", kind: "calls", seq: 1 }] }),
      seq({ edges: [{ id: "e1", from: "user", to: MOD, kind: "calls", seq: 2 }] }),
      seq({ nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: "x" })), edges: [] }),
      seq({ nodes: [{ id: "a", label: "x", ref: { module: "md_zzzzzzzz" } }], edges: [] }),
      j({ t: "block", id: "new:8", aspect: "sequence", md: "図。", claims: {} }),
    ];
    const { verdicts } = run(lines, flowsCtx());
    expect(verdicts.map(rules)).toEqual([[], [], ["V20"], ["V20"], ["V20"], ["V20"], ["V21"]]);
    const d = blockOf(verdicts[1]).diagram;
    expect(d?.groups).toEqual([]);
    expect(d?.direction).toBe("RIGHT");
  });
});

describe("question and verdict lines", () => {
  test("question cites are checked like claim cites; bad section is V05", () => {
    const { verdicts } = run([
      j({ t: "question", text: "?", cites: [{ path: "nope.go", start: 1, end: 2 }] }),
      j({ t: "question", section: "s9", text: "?" }),
      j({ t: "question", text: "?", from: ["x1"] }),
    ]);
    expect(verdicts.map(rules)).toEqual([["V17"], ["V05"], ["V03"]]);
  });

  test("required aspects are matched against the accepted lines only", () => {
    const { v } = run([
      j({ t: "block", id: "new:1", aspect: "interface", kind: "prose", md: "x" }),
      responsibility,
      j({ t: "module", module: MOD, name: "x" }),
    ]);
    const cov = v.finish("end");
    expect(cov.missingAspects).toEqual(["interface" as BlockAspect]);
  });
});
