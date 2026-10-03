import { describe, expect, test } from "bun:test";
import type { BlockId, BlockKind, ErrorCode, ThreadId } from "@mitori/core";
import { parseContract } from "./index.ts";

const ctx = {
  taskThreads: ["th_aaaaaaaa", "th_bbbbbbbb"] as ThreadId[],
  docBlocks: ["b_aaaaaaa1", "b_aaaaaaa2"] as BlockId[],
  blockKinds: { b_aaaaaaa1: "prose", b_aaaaaaa2: "heading" } as Record<BlockId, BlockKind>,
  write: ["src/a.ts", "src/b.ts"],
  primaryBlock: "b_aaaaaaa1" as BlockId | null,
};

const edit = { path: "src/a.ts", start: 3, end: 4, first_line: "const a = 1;", new_text: "const a = 2;", base: "a1b2c3d" };
const patch = (over: Record<string, unknown> = {}) => ({
  summary: "bump a",
  edits: [edit],
  doc_updates: [{ block: "b_aaaaaaa1", md: "a is two." }],
  threads: [{ id: "th_aaaaaaaa", status: "done", body: "done" }],
  ...over,
});
const parsePatch = (structured: unknown, c = ctx) => parseContract("patch/1", { structured }, c);
type Cited = { path: string; start: number; end: number; exists: boolean }[];
/** The contract types answer cites as an intersection of array types; the value carries `exists`. */
const citesOf = (r: { ok: boolean }): Cited => (r.ok ? (r as unknown as { value: { cites: Cited } }).value.cites : []);

describe("AC-L25 parseContract patch/1 — happy path", () => {
  test("maps wire snake_case to the core shapes", () => {
    const r = parsePatch(patch());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.edits).toEqual([{ path: "src/a.ts", start: 3, end: 4, newText: "const a = 2;", firstLine: "const a = 1;", base: "a1b2c3d" }]);
    expect(r.value.core.docUpdate).toBe("a is two.");
    expect(r.value.docUpdates).toEqual([{ block: "b_aaaaaaa1", md: "a is two." }]);
    expect(r.value.threads).toEqual([{ id: "th_aaaaaaaa", status: "done", body: "done" }]);
    expect(r.value.core.needsMoreContext).toBeUndefined();
  });
  test("omitted end/base are omitted, not undefined", () => {
    const r = parsePatch(patch({ edits: [{ path: "src/a.ts", start: 3, first_line: "", new_text: "x" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value.edits[0] as object).sort()).toEqual(["firstLine", "newText", "path", "start"]);
  });
  test("primaryBlock null → docUpdate null; other block updates stay in docUpdates", () => {
    const r = parsePatch(patch(), { ...ctx, primaryBlock: null });
    expect(r.ok && r.value.core.docUpdate).toBeNull();
    const r2 = parsePatch(patch({ doc_updates: [{ block: "b_aaaaaaa2", md: "# Title" }] }));
    expect(r2.ok && r2.value.core.docUpdate).toBeNull();
    expect(r2.ok && r2.value.docUpdates.length).toBe(1);
  });
  test("JSON in text: bare, fenced, and wrapped in chatter", () => {
    const body = JSON.stringify(patch());
    for (const text of [body, `\`\`\`json\n${body}\n\`\`\``, `Here you go:\n${body}\nHope that helps.`]) {
      expect(parseContract("patch/1", { text }, ctx).ok).toBe(true);
    }
  });
  test("needs_more_context with no edits is valid, and is carried through", () => {
    const r = parsePatch(patch({ edits: [], needs_more_context: ["src/c.ts", "symbol Foo"] }));
    expect(r.ok && r.value.core.needsMoreContext).toEqual(["src/c.ts", "symbol Foo"]);
  });
  test("a thread the engine did not report is not an error", () => {
    const r = parsePatch(patch({ threads: [] }));
    expect(r.ok && r.value.threads).toEqual([]);
  });
});

describe("AC-L25 parseContract patch/1 — refusals", () => {
  const fails = (structured: unknown, at: string, code?: ErrorCode, c = ctx) => {
    const r = parsePatch(structured, c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.errors.map((e) => e.at)).toContain(at);
    if (code) expect(r.error.code).toBe(code);
    expect(r.error.errors.length).toBeLessThanOrEqual(20);
  };
  test("not JSON / not an object → E_AGENT_PROTOCOL", () => {
    const a = parseContract("patch/1", { text: "I could not do it." }, ctx);
    expect(a.ok === false && a.error.code).toBe("E_AGENT_PROTOCOL");
    const b = parseContract("patch/1", { structured: [1, 2] }, ctx);
    expect(b.ok).toBe(false);
    expect(parseContract("patch/1", {}, ctx).ok).toBe(false);
  });
  test("summary: 1–200 characters", () => {
    fails(patch({ summary: "" }), "/summary");
    fails(patch({ summary: "x".repeat(201) }), "/summary");
    fails(patch({ summary: 5 }), "/summary");
    expect(parsePatch(patch({ summary: "x".repeat(200) })).ok).toBe(true);
  });
  test("edits: ≤ 40; ≥ 1 unless needs_more_context; none when needs_more_context", () => {
    fails(patch({ edits: Array.from({ length: 41 }, () => edit) }), "/edits");
    fails(patch({ edits: [] }), "/edits");
    fails(patch({ needs_more_context: ["src/c.ts"] }), "/edits");
    fails(patch({ edits: "no" }), "/edits");
  });
  test("edit path: RepoPath rules, and WRITE membership is a scope violation", () => {
    fails(patch({ edits: [{ ...edit, path: "../x" }] }), "/edits/0/path", "E_AGENT_PROTOCOL");
    fails(patch({ edits: [{ ...edit, path: "/etc/passwd" }] }), "/edits/0/path");
    fails(patch({ edits: [{ ...edit, path: "src/other.ts" }] }), "/edits/0/path", "E_SCOPE_VIOLATION");
    // a scope violation wins over protocol noise
    fails(patch({ summary: "", edits: [{ ...edit, path: "src/other.ts" }] }), "/summary", "E_SCOPE_VIOLATION");
  });
  test("edit start/end/first_line/base shapes", () => {
    fails(patch({ edits: [{ ...edit, start: 0 }] }), "/edits/0/start");
    fails(patch({ edits: [{ ...edit, start: 1.5 }] }), "/edits/0/start");
    fails(patch({ edits: [{ ...edit, end: "4" }] }), "/edits/0/end");
    fails(patch({ edits: [{ ...edit, first_line: undefined }] }), "/edits/0/first_line");
    fails(patch({ edits: [{ ...edit, first_line: "a\nb" }] }), "/edits/0/first_line");
    fails(patch({ edits: [{ ...edit, first_line: "x".repeat(1001) }] }), "/edits/0/first_line");
    fails(patch({ edits: [{ ...edit, base: "XYZ" }] }), "/edits/0/base");
    fails(patch({ edits: [{ ...edit, base: "abc12" }] }), "/edits/0/base");
    expect(parsePatch(patch({ edits: [{ ...edit, base: "a".repeat(64) }] })).ok).toBe(true);
  });
  test("new_text: ≤ 2,000 lines, ≤ 200,000 bytes", () => {
    fails(patch({ edits: [{ ...edit, new_text: Array.from({ length: 2001 }, () => "x").join("\n") }] }), "/edits/0/new_text");
    fails(patch({ edits: [{ ...edit, new_text: "あ".repeat(70_000) }] }), "/edits/0/new_text");
    expect(parsePatch(patch({ edits: [{ ...edit, new_text: Array.from({ length: 600 }, () => "x").join("\n") }] })).ok).toBe(true);
  });
  test("total changed lines ≤ 600 (E_PATCH_APPLY: this belongs to agent mode)", () => {
    const big = (path: string) => ({ path, start: 1, end: 300, first_line: "a", new_text: Array.from({ length: 301 }, () => "x").join("\n") });
    fails(patch({ edits: [big("src/a.ts"), big("src/b.ts")] }), "/edits", "E_PATCH_APPLY");
  });
  test("doc_updates: ≤ 8, known block, each once, size", () => {
    fails(patch({ doc_updates: Array.from({ length: 9 }, () => ({ block: "b_aaaaaaa1", md: "x" })) }), "/doc_updates");
    fails(patch({ doc_updates: [{ block: "b_zzzzzzzz", md: "x" }] }), "/doc_updates/0/block");
    fails(
      patch({
        doc_updates: [
          { block: "b_aaaaaaa1", md: "x" },
          { block: "b_aaaaaaa1", md: "y" },
        ],
      }),
      "/doc_updates/1/block",
    );
    fails(patch({ doc_updates: [{ block: "b_aaaaaaa1", md: "x".repeat(20_001) }] }), "/doc_updates/0/md");
  });
  test("doc_updates md: raw HTML and ID comments are refused, not stripped", () => {
    for (const md of ["a <b>bold</b>", "text <!-- b_aaaaaaa1 -->", "<script>x</script>", "<img src=x>", "ok\n<div>\nno"]) {
      fails(patch({ doc_updates: [{ block: "b_aaaaaaa1", md }] }), "/doc_updates/0/md");
    }
  });
  test("doc_updates md: angle brackets in code are data, not HTML", () => {
    for (const md of ["use `Array<string>` here", "```ts\nconst x: Map<string, number> = new Map<string, number>();\n```", "1 < 2 and 3 > 2"]) {
      expect(parsePatch(patch({ doc_updates: [{ block: "b_aaaaaaa1", md }] })).ok).toBe(true);
    }
  });
  test("doc_updates md: headings only in heading blocks", () => {
    fails(patch({ doc_updates: [{ block: "b_aaaaaaa1", md: "intro\n\n## Sneaky heading" }] }), "/doc_updates/0/md");
    expect(parsePatch(patch({ doc_updates: [{ block: "b_aaaaaaa2", md: "## Title" }] })).ok).toBe(true);
    expect(parsePatch(patch({ doc_updates: [{ block: "b_aaaaaaa1", md: "```sh\n# a comment\n```" }] })).ok).toBe(true);
  });
  test("threads: known ids, each once, status enum, body ≤ 4000", () => {
    fails(patch({ threads: [{ id: "th_zzzzzzzz", status: "done", body: "" }] }), "/threads/0/id");
    fails(
      patch({
        threads: [
          { id: "th_aaaaaaaa", status: "done", body: "" },
          { id: "th_aaaaaaaa", status: "skip", body: "" },
        ],
      }),
      "/threads/1/id",
    );
    fails(patch({ threads: [{ id: "th_aaaaaaaa", status: "fixed", body: "" }] }), "/threads/0/status");
    fails(patch({ threads: [{ id: "th_aaaaaaaa", status: "done", body: "x".repeat(4001) }] }), "/threads/0/body");
  });
  test("needs_more_context: ≤ 10 items of ≤ 200 characters", () => {
    fails(patch({ edits: [], needs_more_context: Array.from({ length: 11 }, () => "x") }), "/needs_more_context");
    fails(patch({ edits: [], needs_more_context: ["x".repeat(201)] }), "/needs_more_context/0");
  });
  test("never more than 20 CheckErrors", () => {
    const r = parsePatch(patch({ edits: Array.from({ length: 40 }, () => ({ path: 5, start: "a", first_line: 1, new_text: 2 })) }));
    expect(r.ok === false && r.error.errors.length).toBe(20);
  });
});

describe("AC-L25 parseContract agent/1", () => {
  const agent = (over: Record<string, unknown> = {}) => ({
    summary: "done",
    files_changed: ["src/a.ts", "../escape", "bad path\u0000"],
    doc_updates: [{ block: "b_aaaaaaa1", md: "updated" }],
    threads: [{ id: "th_bbbbbbbb", status: "question", body: "need src/c.ts" }],
    notes: "n",
    ...over,
  });
  const actx = { taskThreads: ctx.taskThreads, docBlocks: ctx.docBlocks, blockKinds: ctx.blockKinds, primaryBlock: ctx.primaryBlock };
  test("valid; unusable files_changed entries are dropped (advisory only)", () => {
    const r = parseContract("agent/1", { structured: agent() }, actx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.core).toMatchObject({ summary: "done", filesChanged: ["src/a.ts"], docUpdate: "updated", notes: "n" });
    expect(r.value.threads).toEqual([{ id: "th_bbbbbbbb", status: "question", body: "need src/c.ts" }]);
  });
  test("limits: files_changed ≤ 50, notes ≤ 2000, summary, doc rules shared with patch", () => {
    for (const [over, at] of [
      [{ files_changed: Array.from({ length: 51 }, (_, i) => `f${i}`) }, "/files_changed"],
      [{ notes: "x".repeat(2001) }, "/notes"],
      [{ summary: "" }, "/summary"],
      [{ doc_updates: [{ block: "b_aaaaaaa1", md: "<b>x</b>" }] }, "/doc_updates/0/md"],
      [{ threads: [{ id: "th_nope0000", status: "done", body: "" }] }, "/threads/0/id"],
    ] as const) {
      const r = parseContract("agent/1", { structured: agent(over) }, actx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.errors.map((e) => e.at)).toContain(at);
    }
  });
});

describe("AC-L27 parseContract answer/1", () => {
  const exists = new Set(["src/a.ts:10-20", "src/a.ts:5-5", "weird:name/x.go:3-4"]);
  const actx = { citeExists: (p: string, s: number, e: number) => exists.has(`${p}:${s}-${e}`) };

  test("claude-cli text: inline cites are extracted in order, existence is recorded, text is untouched", () => {
    const text = "Because of [[src/a.ts:10-20]] and also [[src/a.ts:5]] but not [[src/gone.ts:1-2]].";
    const r = parseContract("answer/1", { text }, actx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.markdown).toBe(text);
    expect(citesOf(r)).toEqual([
      { path: "src/a.ts", start: 10, end: 20, exists: true },
      { path: "src/a.ts", start: 5, end: 5, exists: true },
      { path: "src/gone.ts", start: 1, end: 2, exists: false },
    ]);
  });
  test("a path containing a colon is split at the last colon", () => {
    const r = parseContract("answer/1", { text: "see [[weird:name/x.go:3-4]]" }, actx);
    expect(citesOf(r)[0]).toEqual({ path: "weird:name/x.go", start: 3, end: 4, exists: true });
  });
  test("invalid ranges and invalid paths are exists:false and never reach the host", () => {
    let calls = 0;
    const r = parseContract(
      "answer/1",
      { text: "[[src/a.ts:20-10]] [[../x:1-2]] [[src/a.ts:0-3]]" },
      {
        citeExists: () => {
          calls++;
          return true;
        },
      },
    );
    expect(citesOf(r).map((c) => c.exists)).toEqual([false, false, false]);
    expect(calls).toBe(0);
  });
  test("JSON form (structured, or JSON text): cites and inline cites are united without duplicates", () => {
    const json = {
      markdown: "see [[src/a.ts:10-20]]",
      cites: [
        { path: "src/a.ts", start: 10, end: 20 },
        { path: "src/a.ts", start: 5, end: 5 },
      ],
    };
    for (const raw of [{ structured: json }, { text: JSON.stringify(json) }]) {
      const r = parseContract("answer/1", raw, actx);
      expect(citesOf(r).map((c) => `${c.start}-${c.end}:${c.exists}`)).toEqual(["10-20:true", "5-5:true"]);
    }
  });
  test("limits: non-empty, ≤ 20,000 characters, ≤ 30 cites; malformed cites", () => {
    expect(parseContract("answer/1", { text: "  " }, actx).ok).toBe(false);
    expect(parseContract("answer/1", { text: "x".repeat(20_001) }, actx).ok).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => `[[src/a.ts:${i + 1}]]`).join(" ");
    expect(parseContract("answer/1", { text: many }, actx).ok).toBe(false);
    expect(parseContract("answer/1", { structured: { markdown: "x", cites: [{ path: "a" }] } }, actx).ok).toBe(false);
    expect(parseContract("answer/1", { structured: { markdown: 5, cites: [] } }, actx).ok).toBe(false);
  });
  test("a plain answer that merely starts with { is still text unless it is a JSON answer", () => {
    const r = parseContract("answer/1", { text: "{not json} just prose" }, actx);
    expect(r.ok && r.value.markdown).toBe("{not json} just prose");
  });
});

describe("parseContract findings/1", () => {
  const actx = { citeExists: (p: string) => p === "src/a.ts" };
  const f = (over: Record<string, unknown> = {}) => ({
    title: "T",
    body: "B",
    severity: "minor",
    cites: [{ path: "src/a.ts", start: 1, end: 2 }],
    suggest: "change",
    ...over,
  });

  test("stable-sorts by severity, most severe first", () => {
    const r = parseContract(
      "findings/1",
      {
        structured: {
          findings: [
            f({ title: "i", severity: "info" }),
            f({ title: "c1", severity: "critical" }),
            f({ title: "m", severity: "major" }),
            f({ title: "c2", severity: "critical" }),
          ],
        },
      },
      actx,
    );
    expect(r.ok && r.value.findings.map((x) => x.title)).toEqual(["c1", "c2", "m", "i"]);
  });
  test("cites that do not exist are dropped", () => {
    const r = parseContract(
      "findings/1",
      {
        structured: {
          findings: [
            f({
              cites: [
                { path: "src/a.ts", start: 1, end: 2 },
                { path: "src/x.ts", start: 1, end: 2 },
              ],
            }),
          ],
        },
      },
      actx,
    );
    expect(r.ok && r.value.findings[0]?.cites).toEqual([{ path: "src/a.ts", start: 1, end: 2 }]);
  });
  test("limits and enums", () => {
    const bad = (finding: unknown, at: string) => {
      const r = parseContract("findings/1", { structured: { findings: [finding] } }, actx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.errors.map((e) => e.at)).toContain(at);
    };
    bad(f({ title: "" }), "/findings/0/title");
    bad(f({ title: "x".repeat(121) }), "/findings/0/title");
    bad(f({ body: "x".repeat(2001) }), "/findings/0/body");
    bad(f({ severity: "blocker" }), "/findings/0/severity");
    bad(f({ suggest: "doc_edit" }), "/findings/0/suggest");
    bad(f({ cites: Array.from({ length: 6 }, () => ({ path: "src/a.ts", start: 1, end: 1 })) }), "/findings/0/cites");
    expect(parseContract("findings/1", { structured: { findings: Array.from({ length: 11 }, () => f()) } }, actx).ok).toBe(false);
    expect(parseContract("findings/1", { structured: { findings: [] } }, actx).ok).toBe(true);
    expect(parseContract("findings/1", { structured: {} }, actx).ok).toBe(false);
  });
});

describe("parseContract dispatch", () => {
  test("an unknown contract is E_INVALID_INPUT", () => {
    const r = (parseContract as (c: string, raw: object, ctx: object) => ReturnType<typeof parseContract>)("docpatch/1", {}, {});
    expect(r.ok === false && r.error.code).toBe("E_INVALID_INPUT");
  });
});
