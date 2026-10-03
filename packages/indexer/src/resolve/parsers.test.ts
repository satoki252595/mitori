import { describe, expect, test } from "bun:test";
import { jsonSectionKeyLines, parseJsonc } from "./jsonc.ts";
import { parseToml, tomlGet } from "./toml.ts";
import { yamlChildKeys, yamlList } from "./yaml.ts";

describe("IDX-U resolver config parsers (spec §4.1)", () => {
  test("TOML: tables, arrays of tables, dotted / quoted keys, strings, arrays, inline tables, line map", () => {
    const doc = parseToml(`# c
title = "x" # trailing
[package]
name = "my-crate"
"quoted.key" = 'lit'
[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio.workspace = true
[[bin]]
name = "a"
path = "src/a.rs"
[[bin]]
name = "b"
[project]
dependencies = [
  "fastapi>=0.1",
  "click",
]
multi = """
line1
line2"""
n = 1_000
`);
    expect(tomlGet(doc.root, "package", "name")).toBe("my-crate");
    expect(tomlGet(doc.root, "package", "quoted.key")).toBe("lit");
    expect(tomlGet(doc.root, "dependencies", "serde", "features")).toEqual(["derive"]);
    expect(tomlGet(doc.root, "dependencies", "tokio", "workspace")).toBe(true);
    expect(tomlGet(doc.root, "bin")).toEqual([{ name: "a", path: "src/a.rs" }, { name: "b" }]);
    expect(tomlGet(doc.root, "project", "dependencies")).toEqual(["fastapi>=0.1", "click"]);
    expect(tomlGet(doc.root, "project", "multi")).toBe("line1\nline2");
    expect(tomlGet(doc.root, "project", "n")).toBe(1000);
    expect(doc.lines.get("project.dependencies[1]")).toBe(17);
    expect(doc.lines.get("bin[1]")).toBe(12);
    expect(doc.lines.get("dependencies.serde")).toBe(7);
  });

  test("JSONC: comments and trailing commas; key lines from the raw text", () => {
    const text = `{\n  // c\n  "a": 1, /* b */\n  "scripts": {\n    "dev": "x",\n    "build": "y",\n  },\n}`;
    expect(parseJsonc(text)).toEqual({ a: 1, scripts: { dev: "x", build: "y" } });
    expect(parseJsonc("{nope")).toBeNull();
    expect([...jsonSectionKeyLines(text, "scripts")]).toEqual([
      ["dev", 5],
      ["build", 6],
    ]);
  });

  test("TOML from an untrusted repo never reaches Object.prototype (`[__proto__]`, dotted and inline keys)", () => {
    const probe = {} as Record<string, unknown>;
    const doc = parseToml(`[__proto__]\npolluted = "a"\n[x]\n__proto__.polluted = "b"\ny = { __proto__ = { polluted = "c" } }\n`);
    expect(probe.polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // the keys are ordinary data
    expect(tomlGet(doc.root, "__proto__", "polluted")).toBe("a");
    expect(tomlGet(doc.root, "x", "__proto__", "polluted")).toBe("b");
    expect(tomlGet(doc.root, "x", "y", "__proto__", "polluted")).toBe("c");
    expect(tomlGet(doc.root, "x", "y", "polluted")).toBeUndefined();
  });

  test("pathological lines stay linear (no catastrophic backtracking on 200k-character lines)", () => {
    const n = 200_000;
    const sp = " ".repeat(n);
    const t0 = performance.now();
    yamlChildKeys(`tasks:\n  a${sp}b\n`, "tasks");
    yamlList(`packages:\n  - a${sp}b\n`, "packages");
    yamlList(`packages: a${sp}#b\n`, "packages");
    expect(tomlGet(parseToml(`a = ${"[".repeat(n)}\nb = 1\n`).root, "b")).toBe(1); // too deep: skipped, never a stack overflow
    parseToml(`a = "${"\\".repeat(n)}`);
    parseToml(`${"k.".repeat(n)}k = 1`);
    parseJsonc(`{${", ".repeat(n)}`);
    expect(() => parseJsonc(`${"[".repeat(n)}${"]".repeat(n)}`)).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(500);
  });

  test("YAML helpers: block/flow lists and child keys", () => {
    expect(yamlList("packages:\n  - 'apps/*'\n  - packages/*\nother: 1\n", "packages")).toEqual(["apps/*", "packages/*"]);
    expect(yamlList("packages: [a, 'b/*']\n", "packages")).toEqual(["a", "b/*"]);
    expect(yamlList('packages:\n  - "apps/*"   # the apps\n  - libs#1\n', "packages")).toEqual(["apps/*", "libs#1"]);
    expect(yamlChildKeys('tasks:\n  "quoted key" : 1\n  plain:\n', "tasks").map((k) => k.key)).toEqual(["quoted key", "plain"]);
    expect(yamlChildKeys("version: 3\ntasks:\n  build:\n    cmds: [x]\n  test:\n    cmds: [y]\nvars:\n  A: 1\n", "tasks").map((k) => [k.key, k.line])).toEqual([
      ["build", 3],
      ["test", 5],
    ]);
  });
});
