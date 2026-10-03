import { describe, expect, test } from "bun:test";
import type { ModuleId, RepoPath } from "@mitori/core";
import type { Skeleton, SkeletonTier } from "../contract.ts";
import { imp, input, sf } from "../resolve/test/stage-files.ts";
import { estimateCode, runPipeline, xxh3 } from "../structure/test/pipeline.ts";
import { hotBodies, moduleContext, moduleSkeleton, type PackIo, type PackState, rationaleComments } from "./module-context.ts";

/** A Go-ish file: an exported struct with an exported and a private field, a private struct with exported fields, functions. */
const X_TEXT = [
  "package a", // 1
  "",
  "type T struct {", // 3
  "\tA int", // 4
  "\tb int", // 5
  "}",
  "",
  "type u struct {", // 8
  "\tC int", // 9
  "\tD int", // 10
  "}",
  "",
  "// Run runs, because the queue needs a drain step.", // 13
  "func Run() int {", // 14
  "\tx := 1",
  "\tx++",
  "\treturn x",
  "}", // 18
  "func helper() int {", // 19
  "\treturn 2",
  "}", // 21
].join("\n");

const xFile = sf("a/x.go", {
  loc: 18,
  lines: 21,
  headings: [{ level: 0, line: 1, text: "a" }],
  symbols: [
    { name: "T", kind: "struct", start: 3, end: 6, exported: true },
    { name: "A", qualname: "T.A", kind: "field", start: 4, end: 4, exported: true, parent: "a/x.go#T" },
    { name: "b", qualname: "T.b", kind: "field", start: 5, end: 5, exported: false, parent: "a/x.go#T" },
    { name: "u", kind: "struct", start: 8, end: 11, exported: false },
    { name: "C", qualname: "u.C", kind: "field", start: 9, end: 9, exported: true, parent: "a/x.go#u" },
    { name: "D", qualname: "u.D", kind: "field", start: 10, end: 10, exported: true, parent: "a/x.go#u" },
    { name: "Run", kind: "function", start: 14, end: 18, exported: true, bodyStart: 15, bodyEnd: 18, complexity: 3 },
    { name: "helper", kind: "function", start: 19, end: 21, exported: false, bodyStart: 20, bodyEnd: 21, complexity: 1 },
  ],
});
const yFile = sf("a/y.go", {
  loc: 10,
  lines: 12,
  headings: [{ level: 0, line: 1, text: "a" }],
  symbols: [{ name: "Y", kind: "function", start: 3, end: 12, exported: true, bodyStart: 4, bodyEnd: 12 }],
  imports: [imp("./x.go")],
});

const FRAGMENTS: Record<string, string> = {
  "a/x.go": `=== a/x.go · go · 21 lines ===\n1|package a\n3|type T struct {\n4|\tA int\n5|\tb int\n8|type u struct {\n9|\tC int\n10|\tD int\n14|func Run() int {\n⋮\n19|func helper() int {\n⋮\n`,
  "a/y.go": "=== a/y.go · go · 12 lines ===\n1|package a\n3|func Y() {\n⋮\n",
};

function state(): { s: PackState; id: ModuleId; io: PackIo } {
  const p = runPipeline(input([xFile, yFile]));
  const st = p.structure;
  const details = new Map(st.modules.map((m) => [m.id, m]));
  const s: PackState = { structure: st, facts: p.facts, files: new Map(p.input.files.map((f) => [f.path, f])), details };
  const texts: Record<string, string> = { "a/x.go": X_TEXT, "a/y.go": `package a\n\nfunc Y() {\n${"\ty()\n".repeat(8)}}` };
  const io: PackIo = {
    fileSkeleton: (path: RepoPath, tier: SkeletonTier): Skeleton | null => {
      const text = FRAGMENTS[path];
      if (text === undefined || tier === "l0") return null;
      return { tier, text, tokens: estimateCode(text), files: [path], omitted: [], perFile: [], redactions: 0, key: xxh3(text) };
    },
    text: (path) => texts[path] ?? null,
    estimate: estimateCode,
    xxh3,
  };
  return { s, id: (st.modules[0] as { id: ModuleId }).id, io };
}

describe("IDX-U module skeleton degradation (spec §7.2)", () => {
  test("no budget: the fragments by rank, every line a DATA line (IDX-AT-47)", () => {
    const { s, id, io } = state();
    const sk = moduleSkeleton(s, id, "sig", undefined, io);
    expect(sk.files.sort()).toEqual(["a/x.go", "a/y.go"]);
    for (const l of sk.text.split("\n").slice(0, -1)) expect(/^(=== |\d+\||⋮|> )/.test(l)).toBe(true);
    expect(sk.text.endsWith("\n")).toBe(true);
    expect(sk.omitted).toEqual([]);
  });

  test("over budget: private fields go first, then the fields of private types, then low-ranked files fold", () => {
    const { s, id, io } = state();
    const full = moduleSkeleton(s, id, "sig", undefined, io);
    const step1 = moduleSkeleton(s, id, "sig", full.tokens - 1, io);
    expect(step1.text).not.toContain("5|\tb int");
    expect(step1.text).toContain("4|\tA int");
    expect(step1.text).toContain("9|\tC int");
    const step2 = moduleSkeleton(s, id, "sig", step1.tokens - 1, io);
    expect(step2.text).not.toContain("9|\tC int");
    expect(step2.text).toContain("8|type u struct {");
    const folded = moduleSkeleton(s, id, "sig", 10, io);
    expect(folded.omitted.length).toBe(1);
    expect(folded.text).toMatch(/=== a\/[xy]\.go \(\d+ declarations not shown\)\n/);
    expect(new Set([full.key, step1.key, step2.key, folded.key]).size).toBe(4);
  });
});

describe("IDX-AT-44 hot bodies and moduleContext (spec §7.2–7.3)", () => {
  test("bodies by score within the budget, numbered lines equal the source, same input ⇒ same selection", () => {
    const { s, id, io } = state();
    const hot = hotBodies(s, id, 200, io);
    expect(hot.length).toBeGreaterThan(0);
    expect(hot.reduce((n, h) => n + h.tokens, 0)).toBeLessThanOrEqual(200);
    const lines = X_TEXT.split("\n");
    for (const h of hot.filter((x) => x.path === "a/x.go"))
      for (const l of h.text.split("\n")) {
        const m = /^(\d+)\|(.*)$/.exec(l);
        if (m) expect(m[2]).toBe(lines[Number(m[1]) - 1]);
      }
    expect(hotBodies(s, id, 200, io)).toEqual(hot);
    expect(hotBodies(s, id, 0, io)).toEqual([]);
  });

  test("hot bodies stay ≤ 25 % of the module input; the key is stable", () => {
    const { s, id, io } = state();
    const info = { id, slug: "a", name: "a", children: [], paths: [], loc: 0, rank: 1, membersDigest: "", ifaceDigest: "", crossCutting: false, topoOrder: 0 };
    const ctx = moduleContext(s, id, info, { budget: 4000 }, io);
    expect(ctx.tokens.hot).toBeLessThanOrEqual(0.25 * (ctx.tokens.skeleton + ctx.tokens.hot + ctx.tokens.tests + ctx.tokens.facts) + 1);
    expect(ctx.tokens.total).toBe(ctx.tokens.skeleton + ctx.tokens.hot + ctx.tokens.tests + ctx.tokens.facts + ctx.tokens.neighbors);
    expect(moduleContext(s, id, info, { budget: 4000 }, io).key).toBe(ctx.key);
    expect(moduleContext(s, id, info, { budget: 4000, hotBudget: 0 }, io).hot).toEqual([]);
  });

  test("IDX-AT-49 rationale comments: ±2 lines around the comment, numbered as in the source", () => {
    const { s, io } = state();
    const rc = rationaleComments(s, (p) => (p === "a/x.go" ? [{ start: 13, end: 13 }] : []), 60, io);
    expect(rc).toHaveLength(1);
    expect(rc[0]).toMatchObject({ path: "a/x.go", start: 11, end: 15, numbered: true });
    expect(rc[0]?.text.split("\n")[2]).toBe("13|// Run runs, because the queue needs a drain step.");
  });
});
