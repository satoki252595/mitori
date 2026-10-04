import { describe, expect, test } from "bun:test";
import type { BlockId, Cite, ClaimId, ExcludeReason, FileEntry, RepoPath, SectionId } from "@mitori/core";
import { DEFAULT_DENY_GLOBS } from "@mitori/core";
import { codeAnchor, docAnchor, entry, thread } from "../bundle/test/builders.ts";
import { deriveWriteScope, isSensitiveJob } from "./index.ts";

const cite = (path: string, start: number, end: number): Cite => ({ path, start, end, blob: "1".repeat(40), snippet: "0".repeat(16), precision: "exact" });

interface World {
  files?: Record<string, Partial<FileEntry>>;
  blocks?: Record<string, Cite[]>;
  claims?: Record<string, Cite[]>;
  sections?: Record<string, RepoPath[]>;
  sectionOf?: Record<string, SectionId>;
  deny?: string[];
}

/** A tiny repo: every listed file exists. */
function ctx(world: World, mode: "patch" | "agent" | "answer" = "patch", extra: { path: string; start: number; end: number }[] = []) {
  const files = new Map(Object.entries(world.files ?? {}).map(([p, e]) => [p, entry(p, e)]));
  return {
    mode,
    extra,
    deny: world.deny ?? [],
    citesOfBlock: (b: BlockId) => world.blocks?.[b] ?? [],
    citesOfClaim: (c: ClaimId) => world.claims?.[c] ?? [],
    moduleFilesOfSection: (s: SectionId) => world.sections?.[s] ?? [],
    sectionOfBlock: (b: BlockId) => world.sectionOf?.[b] ?? null,
    fileExists: (p: RepoPath) => files.has(p),
    fileEntry: (p: RepoPath) => files.get(p) ?? null,
  };
}
const derive = (
  threads: ReturnType<typeof thread>[],
  world: World,
  mode: "patch" | "agent" | "answer" = "patch",
  extra: { path: string; start: number; end: number }[] = [],
) => deriveWriteScope(threads, ctx(world, mode, extra));
const val = (r: ReturnType<typeof derive>) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};

const A: World = { files: { "src/a.ts": {}, "src/b.ts": {}, "src/c.ts": {} } };

describe("CR safe-6: a removed cited target (`write:<path>`) leaves WRITE, its code stays context", () => {
  test("a doc anchor citing two files, one taken out: one file is written, both ranges are still read", () => {
    const world: World = { ...A, blocks: { b_flow0002: [cite("src/a.ts", 1, 5), cite("src/b.ts", 7, 9)] } };
    const t = thread({ anchor: docAnchor("b_flow0002") });
    expect(val(derive([t], world)).writeScope).toEqual(["src/a.ts", "src/b.ts"]);
    const v = val(deriveWriteScope([t], { ...ctx(world), removedWrite: new Set(["src/b.ts" as RepoPath]) }));
    expect(v.writeScope).toEqual(["src/a.ts"]);
    expect(v.ranges.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("AC-L20 deriveWriteScope — intents (spec §3.3)", () => {
  test("change: the anchored code range is the scope", () => {
    const v = val(derive([thread({ anchor: codeAnchor("src/a.ts", 10, 29) })], A));
    expect(v).toEqual({ writeScope: ["src/a.ts"], newFiles: [], anchoredLines: 20, ranges: [{ path: "src/a.ts", start: 10, end: 29 }] });
  });
  test("a note never writes (R1, UXP-02): its code is context only, chips add no path", () => {
    const v = val(derive([thread({ intent: "note" })], A, "patch", [{ path: "new.ts", start: 0, end: 0 }]));
    expect(v).toEqual({ writeScope: [], newFiles: [], anchoredLines: 10, ranges: [{ path: "src/a.ts", start: 1, end: 10 }] });
  });
  test("question and review write nothing but still report the anchored code", () => {
    for (const intent of ["question", "review"] as const) {
      const v = val(derive([thread({ intent })], A));
      expect(v.writeScope).toEqual([]);
      expect(v.anchoredLines).toBe(10);
      expect(v.ranges).toHaveLength(1);
    }
  });
  test("answer mode never writes, whatever the intent", () => {
    const v = val(derive([thread({ intent: "change" })], A, "answer", [{ path: "new.ts", start: 0, end: 0 }]));
    expect(v.writeScope).toEqual([]);
    expect(v.newFiles).toEqual([]);
    expect(v.anchoredLines).toBe(10);
  });
  test("doc-primary: the claim's cites, else every cite of the block", () => {
    const world: World = {
      ...A,
      claims: { cl_aaaaaaaa: [cite("src/a.ts", 1, 5), cite("src/b.ts", 7, 9)] },
      blocks: { b_aaaaaaa1: [cite("src/a.ts", 1, 5), cite("src/c.ts", 2, 3)] },
    };
    const withClaim = val(derive([thread({ anchor: docAnchor("b_aaaaaaa1", { claim: "cl_aaaaaaaa" }) })], world));
    expect(withClaim.writeScope).toEqual(["src/a.ts", "src/b.ts"]);
    expect(withClaim.anchoredLines).toBe(5 + 3);
    const noClaim = val(derive([thread({ anchor: docAnchor("b_aaaaaaa1") })], world));
    expect(noClaim.writeScope).toEqual(["src/a.ts", "src/c.ts"]);
  });
  test("doc_edit: the cited files of the block", () => {
    const world: World = { ...A, blocks: { b_aaaaaaa1: [cite("src/b.ts", 1, 5)] } };
    expect(val(derive([thread({ intent: "doc_edit", anchor: docAnchor("b_aaaaaaa1") })], world)).writeScope).toEqual(["src/b.ts"]);
  });
  test("doc_edit with no cites in an s6 module section: the module's files, largest LOC first, at most 8", () => {
    const files: Record<string, Partial<FileEntry>> = {};
    const names = Array.from({ length: 10 }, (_, i) => `m/f${i}.ts`);
    for (const [i, n] of names.entries()) files[n] = { loc: 100 + i };
    const world: World = { files, sections: { "s6/mod": names }, sectionOf: { b_aaaaaaa1: "s6/mod" } };
    const v = val(derive([thread({ intent: "doc_edit", anchor: docAnchor("b_aaaaaaa1") })], world));
    expect(v.writeScope).toEqual(names.slice(2).sort());
    expect(v.writeScope).toHaveLength(8);
    expect(v.writeScope).not.toContain("m/f0.ts");
  });
  test("doc_edit with no cites outside an s6 section (or unknown section): empty", () => {
    const world: World = { files: { "m/a.ts": {} }, sections: { "s3/flow": ["m/a.ts"] }, sectionOf: { b_aaaaaaa1: "s3/flow" } };
    expect(val(derive([thread({ intent: "doc_edit", anchor: docAnchor("b_aaaaaaa1") })], world)).writeScope).toEqual([]);
    expect(val(derive([thread({ intent: "doc_edit", anchor: docAnchor("b_aaaaaaa2") })], world)).writeScope).toEqual([]);
  });
  test("a diagram-primary anchor uses its code member when the server derived one", () => {
    const t = thread({
      anchor: {
        primary: "diagram",
        diagram: { diagram: "dg_aaaaaaaa", node: "n1" },
        code: { path: "src/b.ts", start: 3, end: 4, blob: "0".repeat(40), snippet: "0".repeat(16) },
      },
    });
    expect(val(derive([t], A)).writeScope).toEqual(["src/b.ts"]);
    expect(val(derive([thread({ anchor: { primary: "diagram", diagram: { diagram: "dg_aaaaaaaa" } } })], A)).writeScope).toEqual([]);
  });
});

describe("AC-L20 deriveWriteScope — anchored lines (spec §3.2)", () => {
  test("overlapping and adjacent ranges of one file merge; different files add up", () => {
    const threads = [
      thread({ id: "th_00000001", anchor: codeAnchor("src/a.ts", 1, 10) }),
      thread({ id: "th_00000002", anchor: codeAnchor("src/a.ts", 8, 20) }),
      thread({ id: "th_00000003", anchor: codeAnchor("src/a.ts", 21, 25) }),
      thread({ id: "th_00000004", anchor: codeAnchor("src/a.ts", 40, 41) }),
      thread({ id: "th_00000005", anchor: codeAnchor("src/b.ts", 1, 3) }),
    ];
    const v = val(derive(threads, A));
    expect(v.ranges).toEqual([
      { path: "src/a.ts", start: 1, end: 25 },
      { path: "src/a.ts", start: 40, end: 41 },
      { path: "src/b.ts", start: 1, end: 3 },
    ]);
    expect(v.anchoredLines).toBe(25 + 2 + 3);
    expect(v.writeScope).toEqual(["src/a.ts", "src/b.ts"]);
  });
  test("a thread with no range counts 0 lines and no scope", () => {
    const v = val(derive([thread({ anchor: { primary: "doc", doc: { block: "b_aaaaaaa1", blockHash: "x" } } })], A));
    expect(v).toEqual({ writeScope: [], newFiles: [], anchoredLines: 0, ranges: [] });
  });
});

describe("AC-L20 deriveWriteScope — chips", () => {
  test("@ adds a context range and, for a change, its path to the scope", () => {
    const v = val(derive([thread({ anchor: codeAnchor("src/a.ts", 1, 5) })], A, "patch", [{ path: "src/b.ts", start: 4, end: 9 }]));
    expect(v.writeScope).toEqual(["src/a.ts", "src/b.ts"]);
    expect(v.ranges).toContainEqual({ path: "src/b.ts", start: 4, end: 9 });
    expect(v.anchoredLines).toBe(5 + 6);
  });
  test("for a question the chip is context only", () => {
    const v = val(derive([thread({ intent: "question" })], A, "patch", [{ path: "src/b.ts", start: 4, end: 9 }]));
    expect(v.writeScope).toEqual([]);
    expect(v.ranges).toHaveLength(2);
  });
  test("start = end = 0 declares a new file", () => {
    const v = val(derive([thread()], A, "patch", [{ path: "src/new.ts", start: 0, end: 0 }]));
    expect(v.writeScope).toEqual(["src/a.ts", "src/new.ts"]);
    expect(v.newFiles).toEqual(["src/new.ts"]);
    expect(v.ranges.map((r) => r.path)).toEqual(["src/a.ts"]);
  });
  test("declaring an existing file adds it whole to the scope without making it new", () => {
    const v = val(derive([thread()], A, "patch", [{ path: "src/b.ts", start: 0, end: 0 }]));
    expect(v.writeScope).toEqual(["src/a.ts", "src/b.ts"]);
    expect(v.newFiles).toEqual([]);
  });
  test("a new file on a deny glob is dropped; an invalid chip path is E_INVALID_INPUT", () => {
    expect(val(derive([thread()], { ...A, deny: [".github/**"] }, "patch", [{ path: ".github/workflows/x.yml", start: 0, end: 0 }])).newFiles).toEqual([]);
    const r = derive([thread()], A, "patch", [{ path: "../x", start: 0, end: 0 }]);
    expect(r.ok === false && r.error.code).toBe("E_INVALID_INPUT");
    const r2 = derive([thread()], A, "patch", [{ path: "src/b.ts", start: 9, end: 3 }]);
    expect(r2.ok === false && r2.error.code).toBe("E_INVALID_INPUT");
  });
});

describe("AC-L20 deriveWriteScope — deny globs and unwritable files", () => {
  const withDeny: World = { files: { "src/a.ts": {}, ".env": {}, "k/server.pem": {}, ".github/workflows/ci.yml": {} }, deny: [...DEFAULT_DENY_GLOBS] };
  test.each([".env", "k/server.pem", ".github/workflows/ci.yml"])("an anchor only on %s is E_DENY_GLOB (copy_prompt)", (path) => {
    const r = derive([thread({ anchor: codeAnchor(path, 1, 3) })], withDeny);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_DENY_GLOB");
      expect(r.error.params?.actions).toBe("copy_prompt");
    }
  });
  test("denied paths are removed from scope AND ranges (their text never reaches a bundle); the rest stays", () => {
    const world: World = { ...withDeny, blocks: { b_aaaaaaa1: [cite(".env", 1, 2), cite("src/a.ts", 5, 6)] } };
    const v = val(derive([thread({ anchor: docAnchor("b_aaaaaaa1") })], world));
    expect(v.writeScope).toEqual(["src/a.ts"]);
    expect(v.ranges).toEqual([{ path: "src/a.ts", start: 5, end: 6 }]);
  });
  test("deny globs reach dot-directories and .env.* (picomatch dot:true)", () => {
    for (const p of [".envrc", "docs/.env.md", ".claude/settings.json"]) {
      const r = derive([thread({ anchor: codeAnchor(p, 1, 2) })], { files: { [p]: {} }, deny: [...DEFAULT_DENY_GLOBS] });
      expect(r.ok === false && r.error.code).toBe("E_DENY_GLOB");
    }
  });
  test.each(["binary", "special", "oversize"] as ExcludeReason[])("%s files cannot be read or written: dropped", (excluded) => {
    const r = derive([thread({ anchor: codeAnchor("src/a.ts", 1, 3) })], { files: { "src/a.ts": { excluded } } });
    expect(val(r)).toEqual({ writeScope: [], newFiles: [], anchoredLines: 0, ranges: [] });
  });
  test.each(["minified", "data_large", "gitignored"] as ExcludeReason[])("%s files can be read as context but never written", (excluded) => {
    const v = val(derive([thread({ anchor: codeAnchor("src/a.ts", 1, 3) })], { files: { "src/a.ts": { excluded } } }));
    expect(v.writeScope).toEqual([]);
    expect(v.anchoredLines).toBe(3);
  });
  test("a file that no longer exists is dropped", () => {
    expect(val(derive([thread({ anchor: codeAnchor("src/gone.ts", 1, 3) })], A))).toEqual({ writeScope: [], newFiles: [], anchoredLines: 0, ranges: [] });
  });
});

describe("AC-L20 deriveWriteScope — limits and agent tests", () => {
  test("more than 12 paths is E_PRECONDITION (narrow_scope)", () => {
    const names = Array.from({ length: 13 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
    const world: World = { files: Object.fromEntries(names.map((n) => [n, {}])) };
    const threads = names.map((n, i) => thread({ id: `th_${String(i + 1).padStart(8, "0")}`, anchor: codeAnchor(n, 1, 2) }));
    const r = derive(threads, world);
    expect(r.ok === false && r.error.code).toBe("E_PRECONDITION");
    expect(r.ok === false && r.error.params?.actions).toBe("narrow_scope");
    expect(val(derive(threads.slice(0, 12), world)).writeScope).toHaveLength(12);
  });
  const lang = (path: string, tests: string[]): World => ({ files: Object.fromEntries([path, ...tests].map((p) => [p, {}])) });
  test.each([
    ["internal/store/memory.go", ["internal/store/memory_test.go"]],
    ["src/foo.ts", ["src/foo.test.ts", "src/foo.spec.ts", "src/__tests__/foo.test.ts"]],
    ["pkg/mod.py", ["pkg/test_mod.py", "tests/test_mod.py", "pkg/mod_test.py"]],
    ["foo.ts", ["foo.test.ts"]],
  ])("agent mode adds the existing related tests of %s", (path, tests) => {
    const v = val(derive([thread({ anchor: codeAnchor(path, 1, 2) })], lang(path, tests), "agent"));
    expect(v.writeScope).toEqual([path, ...tests].sort());
    // patch mode does not
    expect(val(derive([thread({ anchor: codeAnchor(path, 1, 2) })], lang(path, tests), "patch")).writeScope).toEqual([path]);
  });
  test("agent mode adds only tests that already exist, and none for Rust (inline mod tests) or for test files", () => {
    expect(val(derive([thread({ anchor: codeAnchor("src/foo.ts", 1, 2) })], lang("src/foo.ts", ["src/foo.test.ts"]), "agent")).writeScope).toEqual([
      "src/foo.test.ts",
      "src/foo.ts",
    ]);
    expect(val(derive([thread({ anchor: codeAnchor("src/foo.ts", 1, 2) })], lang("src/foo.ts", []), "agent")).writeScope).toEqual(["src/foo.ts"]);
    expect(
      val(derive([thread({ anchor: codeAnchor("src/lib.rs", 1, 2) })], lang("src/lib.rs", ["src/lib_test.rs", "tests/lib.rs"]), "agent")).writeScope,
    ).toEqual(["src/lib.rs"]);
    expect(val(derive([thread({ anchor: codeAnchor("src/foo.test.ts", 1, 2) })], lang("src/foo.test.ts", []), "agent")).writeScope).toEqual([
      "src/foo.test.ts",
    ]);
  });
  test("new test files are never added: a human declares them with a chip", () => {
    const v = val(
      derive([thread({ anchor: codeAnchor("src/foo.ts", 1, 2) })], lang("src/foo.ts", []), "agent", [{ path: "src/foo.test.ts", start: 0, end: 0 }]),
    );
    expect(v.writeScope).toEqual(["src/foo.test.ts", "src/foo.ts"]);
    expect(v.newFiles).toEqual(["src/foo.test.ts"]);
  });
  test("results are sorted and deterministic", () => {
    const threads = [thread({ id: "th_00000002", anchor: codeAnchor("src/c.ts", 1, 2) }), thread({ id: "th_00000001", anchor: codeAnchor("src/a.ts", 1, 2) })];
    expect(val(derive(threads, A)).writeScope).toEqual(["src/a.ts", "src/c.ts"]);
    expect(derive(threads, A)).toEqual(derive([...threads].reverse(), A));
  });
});

describe("isSensitiveJob (SEC-12)", () => {
  test("every agent-mode job is sensitive", () => {
    expect(isSensitiveJob("agent", ["src/a.ts"])).toBe(true);
    expect(isSensitiveJob("agent", [])).toBe(true);
  });
  test("patch / answer jobs are sensitive only when they touch a SENSITIVE_GLOBS file", () => {
    expect(isSensitiveJob("patch", ["src/a.ts"])).toBe(false);
    expect(isSensitiveJob("answer", [])).toBe(false);
    for (const p of [
      "package.json",
      "apps/web/package.json",
      "Makefile",
      "build.rs",
      "vite.config.ts",
      "CLAUDE.md",
      "sub/AGENTS.md",
      "Dockerfile",
      "flake.nix",
      ".github/copilot-instructions.md",
    ]) {
      expect([p, isSensitiveJob("patch", ["src/a.ts", p])]).toEqual([p, true]);
    }
  });
});
