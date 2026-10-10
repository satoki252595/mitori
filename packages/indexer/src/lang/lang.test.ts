// IDX-AT-10 (queries compile; capture names ⊂ §3.4) and language detection (spec §2.4, IDX-D5).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Language, Query } from "web-tree-sitter";
import { CAPTURE_NAMES, type GrammarId } from "../contract.ts";
import { env, REPO_ROOT, workerInit, xxh3 } from "../parse/test/env.ts";
import { createWorkerHandler } from "../parse/worker.ts";
import { CX_QUERIES, ERROR_QUERY, TEST_QUERIES } from "./auxiliary.ts";
import { dialectOf, grammarFor, hasFlowPragma, langOfPath, needsShebang, shebangLang } from "./detect.ts";
import { TAGS_QUERIES } from "./queries.ts";
import { isTestFile } from "./testfile.ts";
import { extractorSetVersion, extractorVersion, langOfExtractor } from "./versions.ts";

const SPEC_Q = join(REPO_ROOT, "docs/design/specs/indexer/queries");
const GRAMMARS: GrammarId[] = ["typescript", "tsx", "javascript", "python", "go", "rust"];

describe("IDX-AT-10 tags queries", () => {
  test("embedded queries are byte-identical to the spec .scm files", () => {
    const f = (n: string) => readFileSync(join(SPEC_Q, `${n}.scm`), "utf8");
    expect(TAGS_QUERIES.typescript).toBe(f("typescript"));
    expect(TAGS_QUERIES.tsx).toBe(`${f("typescript")}\n${f("tsx-addendum")}`);
    expect(TAGS_QUERIES.javascript).toBe(f("javascript"));
    expect(TAGS_QUERIES.python).toBe(f("python"));
    expect(TAGS_QUERIES.go).toBe(f("go"));
    expect(TAGS_QUERIES.rust).toBe(f("rust"));
  });

  test("all six grammars compile the tags + aux queries; tags capture names ⊂ the §3.4 contract", async () => {
    const init = workerInit();
    await createWorkerHandler(env, init); // initializes the per-thread WASM runtime once

    const allowed = new Set<string>(CAPTURE_NAMES);
    for (const g of GRAMMARS) {
      const lang = await Language.load(init.grammars[g] as Uint8Array);
      const q = new Query(lang, TAGS_QUERIES[g]);
      for (const c of q.captureNames) if (!c.startsWith("_")) expect([g, c, allowed.has(c)]).toEqual([g, c, true]);
      new Query(lang, `${TAGS_QUERIES[g]}\n${CX_QUERIES[g]}`).delete();
      new Query(lang, ERROR_QUERY).delete();
      const t = TEST_QUERIES[g];
      if (t !== undefined) new Query(lang, t).delete();
      q.delete();
    }
  });
});

describe("IDX-U-001 language detection", () => {
  test("extensions, compound first", () => {
    expect(langOfPath("a/b.d.ts")).toEqual({ lang: "typescript", decl: true });
    expect(langOfPath("x.mts").lang).toBe("typescript");
    expect(langOfPath("x.tsx").lang).toBe("tsx");
    expect(langOfPath("x.jsx").lang).toBe("jsx");
    expect(langOfPath("x.cjs").lang).toBe("javascript");
    expect(langOfPath("x.pyi").lang).toBe("python");
    expect(langOfPath("main.go").lang).toBe("go");
    expect(langOfPath("lib.rs").lang).toBe("rust");
    expect(langOfPath("Foo.java").lang).toBe("generic");
    expect(langOfPath("Dockerfile").lang).toBe("generic");
    expect(langOfPath(".ts").lang).toBe("generic");
  });
  test("shebang only for extension-less paths", () => {
    expect(needsShebang("bin/tool")).toBe(true);
    expect(needsShebang("bin/tool.sh")).toBe(false);
    expect(needsShebang("Makefile")).toBe(false);
    expect(shebangLang("#!/usr/bin/env node")).toBe("javascript");
    expect(shebangLang("#!/usr/bin/env -S deno run")).toBe("typescript");
    expect(shebangLang("#!/usr/bin/python3.12")).toBe("python");
    expect(shebangLang("#!/bin/sh")).toBeNull();
    expect(shebangLang("// not a shebang")).toBeNull();
  });
  test("IDX-D5 Flow pragma in the first 2 KiB switches js/jsx to tsx", () => {
    expect(hasFlowPragma("/**\n * @flow strict\n */")).toBe(true);
    expect(hasFlowPragma(`${" ".repeat(3000)}@flow`)).toBe(false);
    expect(grammarFor("javascript", "// @flow\nconst x = 1")).toBe("tsx");
    expect(grammarFor("jsx", "const x = 1")).toBe("javascript");
    expect(grammarFor("typescript", "// @flow")).toBe("typescript");
  });
  test("dialects for generic files", () => {
    expect(dialectOf("a/b.java", "generic")).toBe("java");
    expect(dialectOf("run.sh", "generic")).toBe("shell");
    expect(dialectOf("Makefile", "generic")).toBe("makefile");
    expect(dialectOf("a.ts", "typescript")).toBeNull();
  });
  test("test-file heuristics", () => {
    expect(isTestFile("a/x_test.go", "go")).toBe(true);
    expect(isTestFile("a/x.go", "go")).toBe(false);
    expect(isTestFile("tests/test_repo.py", "python")).toBe(true);
    expect(isTestFile("conftest.py", "python")).toBe(true);
    expect(isTestFile("src/a.spec.tsx", "tsx")).toBe(true);
    expect(isTestFile("src/__tests__/a.ts", "typescript")).toBe(true);
    expect(isTestFile("src/a.ts", "typescript")).toBe(false);
  });
});

describe("IDX-U-002 extractor versions", () => {
  test("format, determinism and sensitivity to the query text", () => {
    const v = extractorVersion("go", xxh3);
    expect(v).toMatch(/^go@0\.25\.0\+[0-9a-f]{8}$/);
    expect(extractorVersion("go", xxh3)).toBe(v);
    expect(extractorVersion("go", xxh3, { go: `${TAGS_QUERIES.go}\n` })).not.toBe(v);
    expect(langOfExtractor(v)).toBe("go");
    expect(extractorVersion("generic", xxh3)).toMatch(/^generic@0\.0\.0\+/);
    // js depends on the tsx query too (Flow files)
    expect(extractorVersion("javascript", xxh3, { tsx: "x" })).not.toBe(extractorVersion("javascript", xxh3));
    expect(extractorSetVersion(xxh3)).toMatch(/^[0-9a-f]{16}$/);
  });
});
