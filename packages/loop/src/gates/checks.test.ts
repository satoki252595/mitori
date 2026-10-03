// LOOP-U-040 (check part, WP-08c): typecheck / test / lint detection per ecosystem — repo-local or SAFE_PATH binaries
// only, `executesRepoCode: true` for every check (ADR-0013 2), the lockfile in the trust hash (RT-31 re-trust), the
// package manager from the lockfile, related tests from the conventions; the gate-set trust rule.
import { describe, expect, test } from "bun:test";
import type { FileEntry, GateSpec } from "@mitori/core";
import { createHasher } from "@mitori/platform";
import { detectGates, gateConfigCandidates, packageManager, relatedTests } from "./checks.ts";
import type { DetectInput } from "./detect.ts";
import { expandGate } from "./expand.ts";
import { gatePreview, gateSetHash, gateTrust } from "./trust.ts";

const hasher = createHasher();
const env = { pathDirs: ["/tool/bin"], root: "/repo", hasher };
const entry = (path: string, blob = "0".repeat(40)): FileEntry =>
  ({ path, blob, size: 1, lang: "generic", class: "source", lines: 1, loc: 1, tokensEst: 1 }) as FileEntry;

function input(files: Record<string, string>, changed: string[], bins: string[], blobs: Record<string, string> = {}): DetectInput {
  return {
    files: Object.keys(files).map((p) => entry(p, blobs[p])),
    facts: [],
    changed,
    readConfig: (p) => files[p] ?? null,
    binaryExists: (abs) => bins.includes(abs),
  };
}
const ids = (gs: readonly GateSpec[]) => gs.map((g) => g.id);
const noVars = { pkgsOf: (ps: readonly string[]) => ps.map((p) => `./${p}`), testsOf: (ps: readonly string[]) => [...ps] };

describe("LOOP-U-040 check gate detection", () => {
  test("Go: go vet + go test on the changed packages (no `--`), every check executes repo code", () => {
    const gs = detectGates(env, input({ "go.mod": "module x\n", "a/b.go": "" }, ["a/b.go"], ["/tool/bin/go", "/tool/bin/gofmt"]));
    expect(ids(gs)).toEqual(["fmt:gofmt", "test:go", "typecheck:go-vet"]);
    const vet = gs.find((g) => g.id === "typecheck:go-vet") as GateSpec;
    expect(vet).toMatchObject({ kind: "typecheck", executesRepoCode: true, autofix: false, endOfOptions: false });
    expect(expandGate(vet, ["a/b.go"], { ...noVars, pkgsOf: () => ["./a"] })).toEqual(["go", "vet", "./a"]);
    const t = gs.find((g) => g.id === "test:go") as GateSpec;
    expect(t.argvTemplate.slice(0, 3)).toEqual(["go", "test", "-count=1"]);
    // no toolchain ⇒ no gate (never a download)
    expect(detectGates(env, input({ "go.mod": "", "a.go": "" }, ["a.go"], []))).toEqual([]);
  });

  test("JS: a package script wins (pm from the lockfile), else tsc on tsconfig; vitest / jest / bun test for related tests; never npx", () => {
    const pkg = JSON.stringify({ scripts: { typecheck: "tsc -p .", test: "bun test" } });
    const files = { "package.json": pkg, "bun.lock": "", "src/a.ts": "", "src/a.test.ts": "" };
    const gs = detectGates(env, input(files, ["src/a.ts"], ["/tool/bin/bun"]));
    expect(ids(gs)).toEqual(["test:bun", "typecheck:bun"]);
    expect(gs.find((g) => g.id === "typecheck:bun")?.argvTemplate).toEqual(["bun", "run", "typecheck"]);
    expect(gs.every((g) => g.executesRepoCode)).toBe(true);
    // no script: tsc from node_modules/.bin with the tsconfig of the package
    const plain = { "package.json": "{}", "tsconfig.json": "{}", "src/a.ts": "" };
    const tsc = detectGates(env, input(plain, ["src/a.ts"], ["/repo/node_modules/.bin/tsc"]));
    expect(tsc.map((g) => g.argvTemplate)).toEqual([["node_modules/.bin/tsc", "--noEmit", "-p", "tsconfig.json"]]);
    // vitest beats jest; both only from the repo's own node_modules
    const vi = { "package.json": '{"devDependencies":{"vitest":"2","jest":"29"}}', "src/a.ts": "" };
    const v = detectGates(env, input(vi, ["src/a.ts"], ["/repo/node_modules/.bin/vitest", "/repo/node_modules/.bin/jest"]));
    expect(v.map((g) => g.argvTemplate.slice(0, 3))).toEqual([["node_modules/.bin/vitest", "related", "--run"]]);
    expect(detectGates(env, input(vi, ["src/a.ts"], []))).toEqual([]);
    // the injection fixture: an untrusted `typecheck` script is detected (and shown to the human), never auto-run
    const evil = JSON.stringify({ scripts: { typecheck: 'echo PWNED > "$TMPDIR/x"' } });
    const e = detectGates(env, input({ "package.json": evil, "src/a.ts": "" }, ["src/a.ts"], ["/tool/bin/npm"]));
    expect(e.map((g) => [g.id, g.argvTemplate])).toEqual([["typecheck:npm", ["npm", "run", "typecheck"]]]);
  });

  test("Python: ruff check (lint), mypy before pyright, pytest only when declared; the venv first", () => {
    const pyproject = "[tool.ruff]\n[tool.mypy]\n[tool.pytest.ini_options]\n";
    const gs = detectGates(env, input({ "pyproject.toml": pyproject, "app/x.py": "" }, ["app/x.py"], ["/repo/.venv/bin/ruff", "/repo/.venv/bin/python"]));
    expect(ids(gs)).toEqual(["fmt:ruff", "lint:ruff", "test:pytest", "typecheck:mypy"]);
    expect(gs.find((g) => g.id === "typecheck:mypy")?.argvTemplate.slice(0, 3)).toEqual([".venv/bin/python", "-m", "mypy"]);
    expect(gs.find((g) => g.id === "test:pytest")?.argvTemplate).toEqual([".venv/bin/python", "-m", "pytest", "-q", "-x", { var: "tests" }]);
    // no pytest declaration ⇒ no test gate
    const bare = detectGates(env, input({ "pyproject.toml": "[project]\n", "x.py": "" }, ["x.py"], ["/tool/bin/python3"]));
    expect(ids(bare)).toEqual([]);
  });

  test("Rust: cargo check --offline as the typecheck; nested crates own their files", () => {
    const files = { "Cargo.toml": "[workspace]\n", "src/lib.rs": "", "tools/Cargo.toml": "[package]\n", "tools/src/main.rs": "" };
    const gs = detectGates(env, input(files, ["src/lib.rs", "tools/src/main.rs"], ["/tool/bin/cargo"]));
    expect(ids(gs)).toEqual(["typecheck:cargo-check", "typecheck:cargo-check@tools"]);
    expect(gs[0]?.argvTemplate).toEqual(["cargo", "check", "--offline", "--quiet", "--message-format=short"]);
    expect(gs[0]?.appliesTo).toContain("!tools/**");
  });

  test("RT-31 re-trust: a lockfile change changes the trust hash of the checks (not of the pure formatter)", () => {
    const files = { "go.mod": "module x\n", "go.sum": "", "a.go": "" };
    const bins = ["/tool/bin/go", "/tool/bin/gofmt"];
    const a = detectGates(env, input(files, ["a.go"], bins, { "go.sum": "1".repeat(40) }));
    const b = detectGates(env, input(files, ["a.go"], bins, { "go.sum": "2".repeat(40) }));
    const hash = (gs: GateSpec[], id: string) => gs.find((g) => g.id === id)?.trustHash;
    expect(hash(a, "typecheck:go-vet")).not.toBe(hash(b, "typecheck:go-vet"));
    expect(hash(a, "test:go")).not.toBe(hash(b, "test:go"));
    expect(hash(a, "fmt:gofmt")).toBe(hash(b, "fmt:gofmt"));
  });

  test("package manager by the nearest lockfile; npm without one", () => {
    const i = (files: string[]) => input(Object.fromEntries(files.map((f) => [f, ""])), [], []);
    expect(packageManager(i(["pnpm-lock.yaml"]), "web")).toBe("pnpm");
    expect(packageManager(i(["web/bun.lock", "package-lock.json"]), "web")).toBe("bun");
    expect(packageManager(i(["yarn.lock"]), "")).toBe("yarn");
    expect(packageManager(i([]), "")).toBe("npm");
  });

  test("related tests: a changed test itself, the conventional neighbours that exist, nothing else", () => {
    const have = new Set(["src/a.test.ts", "src/__tests__/b.test.ts", "test/c.test.ts", "pkg/test_mod.py", "tests/test_mod.py", "pkg/mod_test.py"]);
    const exists = (p: string) => have.has(p);
    expect(relatedTests("", ["src/a.ts", "src/b.ts", "src/c.ts", "src/none.ts"], exists)).toEqual([
      "src/__tests__/b.test.ts",
      "src/a.test.ts",
      "test/c.test.ts",
    ]);
    expect(relatedTests("", ["pkg/mod.py"], exists)).toEqual(["pkg/mod_test.py", "pkg/test_mod.py", "tests/test_mod.py"]);
    expect(relatedTests("", ["src/a.test.ts"], exists)).toEqual(["src/a.test.ts"]);
  });

  test("config candidates include the check configs of every ancestor", () => {
    const c = gateConfigCandidates(["web/src/a.ts"]);
    expect(c).toContain("web/tsconfig.json");
    expect(c).toContain("tsconfig.json");
    expect(c).toContain("web/src/vitest.config.ts");
    expect(c).toContain("pytest.ini");
  });
});

describe("LOOP-U-040 gate-set trust (spec §7.6.2: one dialog for the gates of a change)", () => {
  const sha = (t: string) => hasher.sha256(t);
  const g = (id: string, h: string): GateSpec =>
    ({
      id,
      kind: "format",
      argvTemplate: ["x", { var: "files" }],
      endOfOptions: false,
      cwd: "",
      appliesTo: ["**"],
      autofix: false,
      executesRepoCode: true,
      timeoutMs: 1,
      source: "detected",
      trustHash: h,
    }) as GateSpec;
  const a = g("fmt:a", "a".repeat(64));
  const b = g("test:b", "b".repeat(64));

  test("the untrusted rest is one set; trusting the set trusts its members; a single denial still wins", () => {
    const states = new Map<string, "trusted" | "denied" | "pending">();
    const trust = (h: string) => states.get(h) ?? "pending";
    const first = gateTrust(trust, sha, [a, b]);
    expect(first.trusted).toEqual([false, false]);
    expect(first.setHash).toBe(gateSetHash(sha, [b, a]));
    states.set(first.setHash as string, "trusted");
    expect(gateTrust(trust, sha, [a, b]).trusted).toEqual([true, true]);
    states.set(b.trustHash, "denied");
    expect(gateTrust(trust, sha, [a, b]).trusted).toEqual([true, false]); // b alone is denied; the set still covers a
    // a member trusted on its own stays trusted in any set
    states.set(a.trustHash, "trusted");
    expect(gateTrust(trust, sha, [a, b]).trusted).toEqual([true, false]);
  });

  test("the preview lists every argv with its variables (RT-12: shown before anything runs)", () => {
    expect(gatePreview(b)).toBe("test:b (cwd .): x {files}");
  });
});
