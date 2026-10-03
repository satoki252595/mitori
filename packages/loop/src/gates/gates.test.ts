// LOOP-U-040 (format part): detection per ecosystem, template expansion, trust hash stability; LOOP-I-041 excerpt rules.
import { describe, expect, test } from "bun:test";
import type { FileEntry, GateSpec } from "@mitori/core";
import { createHasher } from "@mitori/platform";
import { type DetectInput, detectFormatGates, gateTrustHash, supportFiles } from "./detect.ts";
import { excerpt } from "./excerpt.ts";
import { expandGate } from "./expand.ts";
import { gateExcerpt } from "./index.ts";
import { sandboxed, seatbeltProfile } from "./sandbox.ts";

const hasher = createHasher();
const env = { pathDirs: ["/tool/bin", ""], root: "/repo", hasher };
const entry = (path: string): FileEntry =>
  ({ path, blob: "0".repeat(40), size: 1, lang: "generic", class: "source", lines: 1, loc: 1, tokensEst: 1 }) as FileEntry;

function input(files: Record<string, string>, changed: string[], bins: string[]): DetectInput {
  return {
    files: Object.keys(files).map(entry),
    facts: [],
    changed,
    readConfig: (p) => files[p] ?? null,
    binaryExists: (abs) => bins.includes(abs),
  };
}

describe("LOOP-U-040 format gate detection", () => {
  test("Go: gofmt on SAFE_PATH per go.mod directory, executesRepoCode false, -- before the files", () => {
    const i = input(
      { "go.mod": "module x\n", "a.go": "", "tools/go.mod": "module t\n", "tools/b.go": "" },
      ["a.go", "tools/b.go", "README.md"],
      ["/tool/bin/gofmt"],
    );
    const gates = detectFormatGates(env, i);
    expect(gates.map((g) => [g.id, g.cwd, g.executesRepoCode])).toEqual([
      ["fmt:gofmt", "", false],
      ["fmt:gofmt@tools", "tools", false],
    ]);
    const root = gates[0] as GateSpec;
    // the nested module's file belongs to its own gate; a name starting with "-" cannot become an option
    expect(root.appliesTo).toEqual(["**/*.go", "!tools/**"]);
    expect(expandGate(root, ["a.go", "tools/b.go", "-x.go"], { pkgsOf: () => [], testsOf: () => [] })).toEqual(["gofmt", "-w", "--", "./-x.go", "a.go"]);
    expect(expandGate(gates[1] as GateSpec, ["tools/b.go"], { pkgsOf: () => [], testsOf: () => [] })).toEqual(["gofmt", "-w", "--", "b.go"]);
    // no gofmt on PATH ⇒ no gate (never a download)
    expect(detectFormatGates(env, input({ "go.mod": "", "a.go": "" }, ["a.go"], []))).toEqual([]);
  });

  test("JS: biome (JSON config, local binary) wins over prettier; prettier counts as repo code; no npx", () => {
    const files = { "package.json": '{"devDependencies":{"prettier":"3.0.0"}}', "biome.json": "{}", "src/a.ts": "" };
    const both = detectFormatGates(env, input(files, ["src/a.ts"], ["/repo/node_modules/.bin/biome", "/repo/node_modules/.bin/prettier"]));
    expect(both.map((g) => [g.id, g.argvTemplate[0], g.executesRepoCode])).toEqual([["fmt:biome", "node_modules/.bin/biome", false]]);
    const { "biome.json": _, ...noBiome } = files;
    const prettier = detectFormatGates(env, input(noBiome, ["src/a.ts"], ["/repo/node_modules/.bin/prettier"]));
    expect(prettier.map((g) => [g.id, g.executesRepoCode])).toEqual([["fmt:prettier", true]]);
    expect(detectFormatGates(env, input(noBiome, ["src/a.ts"], []))).toEqual([]);
  });

  test("Python: ruff with [tool.ruff], black with [tool.black] (venv first); Rust: cargo fmt with the crate sources", () => {
    const py = detectFormatGates(env, input({ "pyproject.toml": "[tool.ruff]\nline-length = 100\n", "app/x.py": "" }, ["app/x.py"], ["/repo/.venv/bin/ruff"]));
    expect(py.map((g) => [g.id, g.argvTemplate.slice(0, 2)])).toEqual([["fmt:ruff", [".venv/bin/ruff", "format"]]]);
    const black = detectFormatGates(env, input({ "pyproject.toml": "[tool.black]\n", "x.py": "" }, ["x.py"], ["/tool/bin/black"]));
    expect(black.map((g) => g.id)).toEqual(["fmt:black"]);
    const rs = { "Cargo.toml": "[package]\nname='x'\n", "rustfmt.toml": "", "src/lib.rs": "", "src/meta.rs": "" };
    const rust = detectFormatGates(env, input(rs, ["src/meta.rs"], ["/tool/bin/cargo", "/tool/bin/rustfmt"]));
    expect(rust.map((g) => g.id)).toEqual(["fmt:cargo-fmt"]);
    expect(supportFiles(rust[0] as GateSpec, Object.keys(rs))).toEqual(["Cargo.toml", "rustfmt.toml", "src/lib.rs", "src/meta.rs"]);
  });

  test("trust hash: stable for the same template + configs, changes with a config edit", () => {
    const i = (mod: string) => input({ "go.mod": mod, "a.go": "" }, ["a.go"], ["/tool/bin/gofmt"]);
    const a = detectFormatGates(env, i("module x\n"))[0] as GateSpec;
    const b = detectFormatGates(env, i("module x\n"))[0] as GateSpec;
    const c = detectFormatGates(env, i("module y\n"))[0] as GateSpec;
    expect(a.trustHash).toBe(b.trustHash);
    expect(a.trustHash).not.toBe(c.trustHash);
    const { trustHash: _, ...rest } = a;
    expect(gateTrustHash(hasher, rest, [{ path: "go.mod", text: "module x\n" }])).toBe(a.trustHash);
  });
});

describe("LOOP-I-041 failure excerpt", () => {
  const ctx = { worktree: "/home/u/.mitori/wt/ws_x/j_1", estimateTokens: (t: string) => t.length / 3 };

  test("ANSI stripped, paths repo-relative, matches + 2 following lines, duplicates once", () => {
    const out = [
      "\u001b[31mcompiling\u001b[0m",
      "/home/u/.mitori/wt/ws_x/j_1/src/a.go:12:3: expected ';', found 'IDENT' (error)",
      "  detail one",
      "  detail two",
      "  detail three",
      "/home/u/.mitori/wt/ws_x/j_1/src/a.go:12:3: expected ';', found 'IDENT' (error)",
      "--- FAIL: TestX (0.00s)",
      "panic: boom",
    ].join("\n");
    expect(gateExcerpt(out, ctx).split("\n")).toEqual([
      "src/a.go:12:3: expected ';', found 'IDENT' (error)",
      "  detail one",
      "  detail two",
      "--- FAIL: TestX (0.00s)",
      "panic: boom",
    ]);
  });

  test("nothing matched ⇒ the last 40 lines; ≤ 60 lines and ≤ 1k tokens; secrets redacted", () => {
    const tail = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const ex = excerpt(tail, ctx).split("\n");
    expect(ex[0]).toBe("line 60");
    expect(ex).toHaveLength(40);
    const many = Array.from({ length: 200 }, (_, i) => `a.go:${i}:1: error number ${i}`).join("\n");
    expect(excerpt(many, ctx).split("\n").length).toBeLessThanOrEqual(60);
    const big = Array.from({ length: 50 }, (_, i) => `a.go:${i}:1: error ${"x".repeat(200)}`).join("\n");
    expect(ctx.estimateTokens(excerpt(big, ctx))).toBeLessThanOrEqual(1000);
    expect(excerpt('a.go:1:1: error: key "AKIAIOSFODNN7EXAMPL3"', ctx)).toContain("«redacted");
  });
});

describe("ADR-0013 sandbox wrapping", () => {
  const paths = {
    tree: "/m/repos/ws/tmp/j/tree",
    jobTmp: "/m/repos/ws/tmp/j/tmp",
    cargoTarget: "/m/cache/cargo/ws",
    userHome: "/Users/u",
    mitoriHome: "/m",
    claudeEntries: ["/Users/u/.claude", "/Users/u/.claude.json"],
    exists: () => true,
  };
  test("macOS: network denied, writes only to the tree / job tmp / cargo target, sensitive reads denied, tree re-allowed", () => {
    const p = seatbeltProfile(paths);
    expect(p).toContain("(deny network*)");
    expect(p).toContain("(deny file-write*)");
    expect(p).toContain('(subpath "/Users/u/.ssh")');
    expect(p).toContain('(subpath "/m")');
    expect(p.indexOf('(allow file-read* (subpath "/m/repos/ws/tmp/j/tree")')).toBeGreaterThan(p.indexOf('(subpath "/m")'));
    expect(sandboxed("sandbox-exec", paths, "/x", ["gofmt", "-w"]).slice(0, 2)).toEqual(["/usr/bin/sandbox-exec", "-p"]);
    expect(sandboxed("none", paths, "/x", ["gofmt"])).toEqual(["gofmt"]);
  });
  test("Linux: bwrap without network, hidden secrets, bound writable dirs", () => {
    const a = sandboxed("bwrap", paths, "/m/repos/ws/tmp/j/tree", ["gofmt", "-w", "--", "a.go"]);
    expect(a).toContain("--unshare-net");
    expect(a.join(" ")).toContain("--tmpfs /Users/u/.aws");
    expect(a.join(" ")).toContain("--bind /m/repos/ws/tmp/j/tree /m/repos/ws/tmp/j/tree");
    expect(a.slice(-5)).toEqual(["--", "gofmt", "-w", "--", "a.go"]);
  });
});
