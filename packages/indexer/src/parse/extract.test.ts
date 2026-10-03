// IDX-AT-11 (per-language symbol rules), IDX-AT-12 (hash robustness), IDX-AT-13 (Flow), IDX-AT-15 (failures stay
// local), test names, imports / refs folding, docs and rationale — through the real Worker handler, in-thread.
import { describe, expect, test } from "bun:test";
import { parseResult, parseText, syms } from "./test/parse-text.ts";

describe("IDX-AT-11 TypeScript / JavaScript", () => {
  test("exports, class members, overloads, arrow functions, later declarators", async () => {
    const r = await parseText(
      "src/a.ts",
      `/** Adds. */
export function add(a: number, b: number): number { return a + b; }
export const A = 1, B = 2;
const hidden = () => 1;
export default class Box extends Base implements I {
  private secret = 1;
  #hash = 2;
  constructor(v: string) { super(); }
  open(): void {}
  protected guard(): void {}
}
function over(a: string): void;
function over(a: number): void;
function over(a: any) { return a; }
export { over as o };
export interface Shape { area(): number; name: string }
export type Id = string;
export enum Kind { A, B }
namespace NS { export const k = 1; }
`,
    );
    expect(syms(r)).toEqual([
      "add function 2-2 exp",
      "A const 3-3 exp",
      "B const 3-3 exp",
      "hidden function 4-4",
      "Box class 5-11 exp",
      "Box.secret field 6-6",
      "Box.#hash field 7-7",
      "Box.constructor constructor 8-8 exp",
      "Box.open method 9-9 exp",
      "Box.guard method 10-10",
      "over function 12-14 exp",
      "Shape interface 16-16 exp",
      "Shape.area method 16-16 exp",
      "Shape.name field 16-16 exp",
      "Id type 17-17 exp",
      "Kind enum 18-18 exp",
      "NS namespace 19-19", // namespace-level consts are not in the §3.5 query (program-level only)
    ]);
    const sig = Object.fromEntries(r.symbols.map((s) => [s.qualname, s.signature]));
    expect(sig.add).toBe("export function add(a: number, b: number): number");
    expect(sig.A).toBe("export const A");
    expect(sig.over).toBe("function over(a: any)");
    expect(sig.Box).toBe("export default class Box extends Base implements I");
    expect(r.symbols[0]?.doc).toBe("Adds.");
    expect(r.symbols.find((s) => s.qualname === "Box.open")?.parent).toBe("src/a.ts#Box");
  });

  test("CommonJS exports and JSX references (javascript grammar)", async () => {
    const r = await parseText(
      "lib/w.jsx",
      `const join = require("node:path").join;
function helper(x) { return x; }
module.exports.run = function (args) { return helper(args); };
exports.stop = () => {};
class W extends Base { render() { return <Panel.Item><Child /></Panel.Item>; } }
module.exports = { helper, W };
`,
    );
    expect(syms(r)).toEqual([
      "join const 1-1",
      "helper function 2-2 exp",
      "run function 3-3 exp",
      "stop function 4-4 exp",
      "W class 5-5 exp",
      "W.render method 5-5 exp",
    ]);
    expect(r.imports).toEqual([{ spec: "node:path", line: 1, kind: "dynamic", names: [] }]);
    const refs = r.refs.map((x) => `${x.kind}:${x.name}${x.count > 1 ? `×${x.count}` : ""}`).sort();
    expect(refs).toEqual(["call:helper", "call:require", "jsx:Child", "jsx:Item", "type:Base"]);
  });

  test("imports: named, default, type-only, side-effect assets, re-exports", async () => {
    const r = await parseText(
      "src/i.ts",
      `import a, { b, c as d } from "./x";
import type { T } from "./types";
import "./style.css";
export * from "./all";
export { e, f } from "./ef";
const lazy = () => import("./lazy");
`,
    );
    expect(r.imports).toEqual([
      { spec: "./x", line: 1, kind: "static", names: ["a", "b", "c"] },
      { spec: "./types", line: 2, kind: "type", names: ["T"] },
      { spec: "./style.css", line: 3, kind: "asset", names: [] },
      { spec: "./all", line: 4, kind: "reexport", names: [] },
      { spec: "./ef", line: 5, kind: "reexport", names: ["e", "f"] },
      { spec: "./lazy", line: 6, kind: "dynamic", names: [] },
    ]);
  });

  test("a self reference is not a ref; duplicate captures of one node count once", async () => {
    const r = await parseText("src/r.ts", "class C implements I { m(x: I): C { return new C(); } }\n");
    const by = Object.fromEntries(r.refs.map((x) => [`${x.kind}:${x.name}`, x.count]));
    expect(by).toEqual({ "type:I": 2, "type:C": 1, "new:C": 1 });
  });

  test("JS/TS test names: describe chains joined with ›", async () => {
    const r = await parseText(
      "test/a.test.ts",
      `describe("Repo", () => {
  it("lists", () => {});
  describe.skip("create", () => { test.each([1])("rejects %s", () => {}); });
});
test("top", () => {});
`,
      { profile: "lite", cls: "test" },
    );
    expect(r.tests).toEqual([
      { name: "Repo › lists", line: 2 },
      { name: "Repo › create › rejects %s", line: 3 },
      { name: "top", line: 5 },
    ]);
  });
});

describe("IDX-AT-11 Python", () => {
  test("__all__, decorators, methods, dunder exported, docstrings", async () => {
    const r = await parseText(
      "pkg/m.py",
      `"""Module doc."""
__all__ = ["Repo", "run"]

@dec
@other.thing(1)
def run(a, b=2):
    """Run it."""
    return a if b else None


def helper():
    pass


class Repo(Base):
    """A repo."""
    count = 0

    def __init__(self):
        self._x = 1

    def _private(self):
        pass

    def __len__(self):
        return 0
`,
    );
    expect(syms(r)).toEqual([
      "__all__ const 2-2",
      "run function 4-8 exp",
      "helper function 11-12",
      "Repo class 15-26 exp",
      "Repo.count field 17-17 exp",
      "Repo.__init__ constructor 19-20 exp",
      "Repo._private method 22-23",
      "Repo.__len__ method 25-26 exp",
    ]);
    const run = r.symbols.find((s) => s.qualname === "run");
    expect(run?.signature).toBe("@dec @other.thing(1) def run(a, b=2)");
    expect(run?.decorators).toEqual(["@dec", "@other.thing(1)"]);
    expect(run?.doc).toBe("Run it.");
    expect([run?.docStart, run?.docEnd]).toEqual([7, 7]);
    expect(run?.complexity).toBe(1);
  });
  test("test cases in test files: test_* and TestClass::test_*", async () => {
    const r = await parseText(
      "tests/test_x.py",
      "def test_a():\n    pass\n\nclass TestB:\n    def test_c(self):\n        pass\n    def helper(self):\n        pass\n",
      { profile: "lite", cls: "test" },
    );
    expect(r.tests).toEqual([
      { name: "test_a", line: 1 },
      { name: "TestB::test_c", line: 5 },
    ]);
    expect(r.symbols.filter((s) => s.kind === "test").map((s) => s.qualname)).toEqual(["test_a", "TestB.test_c"]);
  });
});

describe("IDX-AT-11 Go", () => {
  test("receivers, single vs grouped specs, exported by case, package line", async () => {
    const r = await parseText(
      "store/s.go",
      `// Package store keeps books.
package store

// Store is the interface.
type Store interface {
	Get(id int) (Book, error)
}

type (
	ID   int
	name = string
)

const Max = 10

type mem struct{ n int }

// Get returns a book.
func (m *mem) Get(id int) (Book, error) {
	if id < 0 || id > Max {
		return Book{}, nil
	}
	return Book{}, nil
}

func New() Store { return &mem{} }
`,
    );
    expect(syms(r)).toEqual([
      "Store interface 5-7 exp",
      "Store.Get method 6-6 exp",
      "ID type 10-10 exp",
      "name type 11-11",
      "Max const 14-14 exp",
      "mem struct 16-16",
      "mem.n field 16-16",
      "mem.Get method 19-24 exp",
      "New function 26-26 exp",
    ]);
    const s = Object.fromEntries(r.symbols.map((x) => [x.qualname, x]));
    expect(s.Store?.signature).toBe("type Store interface");
    expect([s.Store?.start, s.Store?.docStart]).toEqual([5, 4]); // single-spec type: starts at the `type` keyword
    expect(s.ID?.signature).toBe("type ID int");
    expect(s.Max?.signature).toBe("const Max");
    expect(s["mem.Get"]?.parent).toBe("store/s.go#mem");
    expect(s["mem.Get"]?.complexity).toBe(2); // if + ||
    expect(r.headings).toEqual([{ level: 0, line: 2, text: "store" }]);
  });
  test("tests and subtests; qualified refs only through import aliases", async () => {
    const r = await parseText(
      "x/x_test.go",
      `package x

import (
	"testing"
	str "strings"
)

func TestParse(t *testing.T) {
	t.Run("empty", func(t *testing.T) { _ = str.ToLower("") })
	v := thing{}
	_ = v.Field
}

func helper() {}
`,
      { profile: "lite", cls: "test" },
    );
    expect(r.tests).toEqual([
      { name: "TestParse", line: 8 },
      { name: "TestParse/empty", line: 9 },
    ]);
    expect(r.symbols.map((s) => `${s.qualname}:${s.kind}`)).toEqual(["TestParse:test", "helper:function"]);
    expect(r.imports.map((i) => [i.spec, i.names])).toEqual([
      ["testing", []],
      ["strings", ["str"]],
    ]);
    expect(r.refs.filter((x) => x.kind === "qual")).toEqual([]); // lite profile: qualified refs disabled
  });
});

describe("IDX-AT-11 Rust", () => {
  test("impl / trait impl naming, duplicate methods ~2, pub(crate), inherited visibility, #[test]", async () => {
    const r = await parseText(
      "src/s.rs",
      `use std::fmt;

/// A struct.
#[derive(Debug)]
pub struct S { pub a: u32, b: u8 }

impl S {
    pub fn new() -> Self { S { a: 1, b: 0 } }
    fn private(&self) {}
}

impl fmt::Display for S {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }
}

impl fmt::Debug for S {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }
}

pub(crate) trait T { fn t(&self); }
pub(super) fn sup() {}

#[macro_export]
macro_rules! m { () => {}; }

#[cfg(test)]
mod tests {
    #[test]
    fn works() {}
}
`,
    );
    expect(syms(r)).toEqual([
      "S struct 5-5 exp",
      "S.a field 5-5 exp",
      "S.b field 5-5",
      "impl S impl 7-10 exp",
      "S.new method 8-8 exp",
      "S.private method 9-9",
      "impl Display for S impl 12-14 exp",
      "S.fmt method 13-13 exp",
      "impl Debug for S impl 16-18 exp",
      "S.fmt~2 method 17-17 exp",
      "T trait 20-20 exp",
      "T.t method 20-20 exp",
      "sup function 21-21",
      "m macro 24-24 exp",
      "tests module 27-30",
      "tests.works test 29-29",
    ]);
    const s = r.symbols.find((x) => x.qualname === "S");
    expect([s?.doc, s?.docStart, s?.decorators]).toEqual(["A struct.", 3, ["#[derive(Debug)]"]]);
    expect(r.symbols.find((x) => x.qualname === "T.t")?.signature).toBe("fn t(&self)");
    expect(r.tests).toEqual([{ name: "tests::works", line: 29 }]);
    expect(r.imports).toEqual([{ spec: "std::fmt", line: 1, kind: "static", names: ["fmt"] }]);
  });
});

describe("IDX-AT-12 hash robustness", () => {
  const base = `export function f(a: number, b: string): string {
  // a comment
  return b + a;
}
`;
  test("whitespace / newline / comment changes keep sigHash and bodyHash", async () => {
    const a = (await parseText("h.ts", base)).symbols[0];
    const b = (await parseText("h.ts", "export   function f(a: number,\n    b: string): string {\n  return   b + a; // trailing\n}\n")).symbols[0];
    expect(b?.sigHash).toBe(a?.sigHash as string);
    expect(b?.bodyHash).toBe(a?.bodyHash as string);
  });
  test("renaming a parameter changes sigHash; a body edit changes only bodyHash", async () => {
    const a = (await parseText("h.ts", base)).symbols[0];
    const renamed = (await parseText("h.ts", base.replace("b: string", "c: string"))).symbols[0];
    expect(renamed?.sigHash).not.toBe(a?.sigHash as string);
    const body = (await parseText("h.ts", base.replace("b + a", "a + b"))).symbols[0];
    expect(body?.sigHash).toBe(a?.sigHash as string);
    expect(body?.bodyHash).not.toBe(a?.bodyHash as string);
  });
});

describe("IDX-AT-13 Flow → tsx grammar", () => {
  test("a @flow js file with type annotations parses without errors and keeps lang javascript", async () => {
    const src = "/**\n * @flow\n */\ntype Props = { name: string };\nexport function greet(p: Props): string { return p.name; }\n";
    const r = await parseText("src/g.js", src);
    expect([r.lang, r.grammar, r.errors]).toEqual(["javascript", "tsx", 0]);
    expect(r.symbols.map((s) => s.qualname)).toContain("greet");
    const plain = await parseText("src/g2.js", src.replace("@flow", "plain"));
    expect(plain.grammar).toBe("javascript");
  });
});

describe("IDX-AT-15 failures stay local", () => {
  test("a broken file keeps its parsable definitions (recovered from ERROR regions)", async () => {
    const r = await parseText(
      "b.ts",
      "export function ok(): number {\n  return 1;\n}\n\nexport function broken(: number {\n  return ((1 + ;\n}\n\nexport function stillFine(): string {\n  return 'x';\n}\n",
    );
    expect(r.errors).toBeGreaterThan(0);
    expect(r.symbols.map((s) => `${s.qualname}:${s.start}-${s.end}:${s.exported}`)).toContain("stillFine:9-11:true");
  });
  test("pathologically deep nesting finishes (ok or generic fallback with a note)", async () => {
    const src = `const x = ${"[".repeat(100_000)}${"]".repeat(100_000)};\nexport function after() {}\n`;
    const t0 = performance.now();
    const r = await parseResult("deep.ts", src, { skipContentRules: true });
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(r.status).toBe("ok");
  });
  test("content rules exclude binary / minified / generated without parsing", async () => {
    expect(await parseResult("a.ts", new Uint8Array([0x61, 0, 0x62]))).toMatchObject({ status: "excluded", rule: "R11.binary_content", lines: 0 });
    expect(await parseResult("a.js", `${"x=1;".repeat(2_000)}\n`)).toMatchObject({ status: "excluded", rule: "R12.minified_content" });
    expect(await parseResult("a.go", "// Code generated by x. DO NOT EDIT.\npackage a\n")).toMatchObject({ status: "excluded", rule: "R13.generated_header" });
  });
});

describe("IDX-U-010 text profile, generic extraction, LOC, rationale", () => {
  test("Markdown headings outside fences; no symbols", async () => {
    const r = await parseText("docs/a.md", "# Title\n\nText\n\n```\n# not a heading\n```\n\nSub\n---\n", { profile: "text", cls: "docs" });
    expect(r.headings).toEqual([
      { level: 1, line: 1, text: "Title" },
      { level: 2, line: 9, text: "Sub" },
    ]);
    expect([r.symbols.length, r.extractor]).toEqual([0, null]);
  });
  test("generic languages: line-regex definitions", async () => {
    const r = await parseText("x.rb", "class Greeter\n  def hello\n    1\n  end\nend\ndef top\nend\n", { lang: "generic" });
    // a definition runs until the next definition at the same or a lower indent (spec §3.8)
    expect(syms(r)).toEqual(["Greeter class 1-5 exp", "hello function 2-5 exp", "top function 6-7 exp"]);
  });
  test("shebang refines a generic extension-less file", async () => {
    const r = await parseText("bin/tool", "#!/usr/bin/env node\nfunction main() {}\n", { lang: "generic" });
    expect([r.lang, r.grammar, r.symbols[0]?.qualname]).toEqual(["javascript", "javascript", "main"]);
  });
  test("LOC excludes blank and comment-only lines; rationale skips TODO and license headers", async () => {
    const r = await parseText(
      "r.ts",
      "// Copyright 2026 x. Licensed MIT because reasons.\n\n// We use a map here because lookups dominate.\nconst m = new Map(); // inline note\n/* TODO: why */\nexport const n = 1;\n",
    );
    expect(r.loc).toBe(2);
    expect(r.rationale).toEqual([{ start: 3, end: 4 }]); // adjacent matching comments merge
  });
  test("CJK characters are counted; a BOM does not shift lines", async () => {
    const r = await parseText("j.ts", "﻿export const 名前 = '日本語';\n");
    expect([r.cjk, r.lines, r.symbols[0]?.start]).toEqual([5, 1, 1]);
  });
  test("env templates (secret class) only feed detectors: no symbols, text or skeleton leave the Worker", async () => {
    const r = await parseText(".env.example", "API_KEY=sk-should-never-leave\n", { cls: "secret", profile: "text" });
    expect(JSON.stringify(r)).not.toContain("sk-should-never-leave");
    expect([r.symbols.length, r.skeleton, r.headings]).toEqual([0, undefined, undefined]);
  });
});
