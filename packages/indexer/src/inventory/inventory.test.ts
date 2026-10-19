// IDX-AT-01 (rule boundaries, one case per rule) and IDX-AT-07 (indexDigest) on the pure S0 functions.
import { describe, expect, test } from "bun:test";
import { DEFAULT_DENY_GLOBS } from "@mitori/core";
import { INVENTORY_LIMITS } from "../contract.ts";
import { xxh3 } from "../parse/test/env.ts";
import { contentRule, hasGeneratedHeader, invalidUtf8Bytes, isBinaryContent, isMinifiedContent } from "./content.ts";
import { classifyByPath, computeIndexDigest } from "./index.ts";

const settings = { denyGlobs: [...DEFAULT_DENY_GLOBS, ".mitori/**"], include: [] as string[], exclude: [] as string[] };
const cls = (path: string, size = 100, extra: Partial<Parameters<typeof classifyByPath>[0]> = {}) => {
  const r = classifyByPath({ path, size, mode: "100644", attrs: {}, settings, ...extra });
  return [r.class, r.excluded ?? "-", r.rule] as const;
};

describe("IDX-AT-01 path rules R00–R20 (first match wins)", () => {
  test("R00 special: submodule, symlink, nested repository", () => {
    expect(cls("sub", 0, { mode: "160000" })).toEqual(["ignored", "special", "R00.special"]);
    expect(cls("link", 10, { mode: "120000" })).toEqual(["ignored", "special", "R00.special"]);
    expect(cls("nested/", 0)).toEqual(["ignored", "special", "R00.special"]);
  });
  test("R01 deny (secret-named → secret) and R04 secret names", () => {
    expect(cls(".env")).toEqual(["secret", "secret", "R01.deny"]);
    expect(cls("a/.env.local")).toEqual(["secret", "secret", "R01.deny"]);
    expect(cls("keys/dev.pem")).toEqual(["secret", "secret", "R01.deny"]);
    expect(cls(".github/workflows/ci.yml")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(cls(".claude/settings.json")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(cls(".mitori/doc/a.md")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    // WP30-A: agent-instruction text docs read as docs (R17); settings / hooks / scripts under them stay denied
    expect(cls(".claude/skills/scrape/SKILL.md")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls(".claude/commands/scrape.md")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls(".agents/skills/apply/SKILL.md")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls(".codex/skills/x/SKILL.md")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls(".cursor/rules/sync.mdc")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls(".claude/hooks/notify.sh")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(cls(".claude/mcp.json")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(cls(".agents/config.toml")).toEqual(["ignored", "deny_glob", "R01.deny"]);
    // R04 alone (deny list without the secret globs): the spec's SECRET_NAME_RE still catches it
    expect(classifyByPath({ path: "conf/app.keystore", size: 1, mode: "100644", attrs: {}, settings: { denyGlobs: [], include: [], exclude: [] } }).rule).toBe(
      "R04.secret_name",
    );
  });
  test("IDX-AT-01 WP30b: user deny wins over the agent-doc read exception", () => {
    const base = [...DEFAULT_DENY_GLOBS];
    const at = (path: string, denyGlobs: string[], userDenyGlobs: string[] = []) => {
      const r = classifyByPath({ path, size: 100, mode: "100644", attrs: {}, settings: { denyGlobs, include: [], exclude: [], userDenyGlobs } });
      return [r.class, r.excluded ?? "-", r.rule] as const;
    };
    // defaults only: agent-instruction text docs read as docs
    expect(at(".claude/skills/x/SKILL.md", base)).toEqual(["docs", "-", "R17.docs"]);
    // global.security.denyGlobs [".claude/**"]: merged set equals the defaults, but the user glob still denies
    expect(at(".claude/skills/x/SKILL.md", base, [".claude/**"])).toEqual(["ignored", "deny_glob", "R01.deny"]);
    // repo denyGlobs [".agents/skills/private/**"]: only that subtree denies, other skills stay docs
    const repo = [...base, ".agents/skills/private/**"];
    expect(at(".agents/skills/private/SECRET.md", repo, [".agents/skills/private/**"])).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(at(".agents/skills/other/SKILL.md", repo, [".agents/skills/private/**"])).toEqual(["docs", "-", "R17.docs"]);
    // non-text agent files stay denied with and without user globs
    expect(at(".claude/settings.json", base)).toEqual(["ignored", "deny_glob", "R01.deny"]);
    expect(at(".claude/settings.json", base, [".claude/**"])).toEqual(["ignored", "deny_glob", "R01.deny"]);
  });
  test("R02 user exclude / R03 include", () => {
    const s = { ...settings, exclude: ["legacy/**"], include: ["legacy/keep.ts", "vendor/ours/**"] };
    expect(cls("legacy/a.ts", 10, { settings: s })).toEqual(["ignored", "user_exclude", "R02.user_exclude"]);
    expect(cls("legacy/keep.ts", 10, { settings: s })).toEqual(["source", "-", "R19.source"]);
    // include skips R08–R13 and R15 (vendored would apply otherwise) but never R05–R07
    expect(cls("vendor/ours/x.go", 10, { settings: s })).toEqual(["source", "-", "R19.source"]);
    expect(cls("vendor/ours/big.go", INVENTORY_LIMITS.oversizeBytes + 1, { settings: s })).toEqual(["oversize", "oversize", "R07.oversize"]);
  });
  test("R05 lockfile, R06 binary extension, R07 oversize boundary", () => {
    expect(cls("bun.lock")).toEqual(["lockfile", "lockfile", "R05.lockfile"]);
    expect(cls("a/go.sum")).toEqual(["lockfile", "lockfile", "R05.lockfile"]);
    expect(cls("img/logo.svg")).toEqual(["binary", "binary", "R06.binary_ext"]);
    expect(cls("a.ts", 2_097_152)).toEqual(["source", "-", "R19.source"]);
    expect(cls("a.ts", 2_097_153)).toEqual(["oversize", "oversize", "R07.oversize"]);
  });
  test("R08 vendored / R09 generated / R10 minified names, linguist attributes", () => {
    expect(cls("node_modules/a/index.js")).toEqual(["vendored", "vendored", "R08.vendored"]);
    expect(cls("third_party/x.go")).toEqual(["vendored", "vendored", "R08.vendored"]);
    expect(cls("assets/x.js", 10, { attrs: { vendored: true } })).toEqual(["vendored", "vendored", "R08.vendored"]);
    expect(cls("vendor/x.go", 10, { attrs: { vendored: false } })).toEqual(["source", "-", "R19.source"]);
    expect(cls("dist/app.min.js")).toEqual(["generated", "generated", "R09.generated_path"]);
    expect(cls("api/client.gen.ts")).toEqual(["generated", "generated", "R09.generated_path"]);
    expect(cls("x_pb2.py")).toEqual(["generated", "generated", "R09.generated_path"]);
    expect(cls("src/a.ts", 10, { attrs: { generated: true } })).toEqual(["generated", "generated", "R09.generated_path"]);
    expect(cls("build/out.go")).toEqual(["source", "-", "R19.source"]); // build/ is deliberately not generated
    expect(cls("web/app.min.js")).toEqual(["minified", "minified", "R10.minified_name"]);
    expect(cls("web/x.bundle.js")).toEqual(["minified", "minified", "R10.minified_name"]);
  });
  test("R14 fixture, R15 data_large boundary (50 KiB exactly stays config)", () => {
    expect(cls("testdata/a.go")).toEqual(["test", "fixture", "R14.fixture"]);
    expect(cls("src/__snapshots__/a.ts.snap")).toEqual(["test", "fixture", "R14.fixture"]);
    expect(cls("data/a.json", 51_200)).toEqual(["config", "-", "R18.config"]);
    expect(cls("data/a.json", 51_201)).toEqual(["data_large", "data_large", "R15.data_large"]);
    expect(cls("package.json", 60_000)).toEqual(["config", "-", "R18.config"]); // config by name, never data_large
  });
  test("R16 test, R17 docs, R18 config, R19 source, R20 fallback", () => {
    expect(cls("src/a.test.ts")).toEqual(["test", "-", "R16.test"]);
    expect(cls("tests/integration.rs")).toEqual(["test", "-", "R16.test"]);
    expect(cls("tests/fixture.txt")).toEqual(["source", "-", "R20.fallback"]); // TEST_SEGMENTS needs a code file
    expect(cls("README.md")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls("LICENSE")).toEqual(["docs", "-", "R17.docs"]);
    expect(cls("Dockerfile")).toEqual(["config", "-", "R18.config"]);
    expect(cls("vite.config.ts")).toEqual(["config", "-", "R18.config"]);
    expect(cls("db/0001.sql")).toEqual(["source", "-", "R19.source"]);
    expect(cls("bin/tool", 100)).toEqual(["source", "-", "R20.fallback"]);
    expect(cls("notes.txt", 60_000)).toEqual(["data_large", "data_large", "R15.data_large"]);
    expect(cls("bin/tool", 60_000)).toEqual(["data_large", "data_large", "R20.fallback"]);
  });
  test("scope and lang of excluded files (by extension)", () => {
    const r = (p: string) => classifyByPath({ path: p, size: 10, mode: "100644", attrs: {}, settings });
    expect(r("examples/hello/main.go").scope).toBe("example");
    expect(r("scripts/release.ts").scope).toBe("tooling");
    expect(r("vite.config.ts").scope).toBe("tooling");
    expect(r("src/a.test.ts").scope).toBe("test");
    expect(r("src/a.ts").scope).toBe("main");
    expect(r("vendor/lib.js").lang).toBe("javascript");
    expect(r("src/a.ts").needsContent).toBe(true);
    expect(r("bun.lock").needsContent).toBe(false);
  });
});

describe("IDX-AT-01 content rules R11–R13 (boundaries)", () => {
  test("R11: NUL at byte 8,000 is seen, at 8,001 it is not", () => {
    const at = (i: number) => {
      const b = new Uint8Array(9_000).fill(0x61);
      b[i - 1] = 0;
      return b;
    };
    expect(isBinaryContent(at(8_000))).toBe(true);
    expect(isBinaryContent(at(8_001))).toBe(false);
  });
  test("R11: invalid UTF-8 ratio > 30 %", () => {
    expect(invalidUtf8Bytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]))).toBe(1);
    expect(invalidUtf8Bytes(new TextEncoder().encode("日本語 ok"))).toBe(0);
    expect(isBinaryContent(new Uint8Array([0xff, 0xfe, 0x41, 0xff, 0x41]))).toBe(true);
    expect(isBinaryContent(new TextEncoder().encode("café\nnaïve\n"))).toBe(false);
  });
  test("R12: avg bytes per line 300 / 301, few long lines, 1 KiB floor", () => {
    expect(isMinifiedContent(3_000, 10)).toBe(false); // 300
    expect(isMinifiedContent(3_010, 10)).toBe(true); // 301
    expect(isMinifiedContent(6_000, 3)).toBe(true);
    expect(isMinifiedContent(1_024, 0)).toBe(false);
  });
  test("R13: generated headers on comment lines only", () => {
    expect(hasGeneratedHeader("// Code generated by protoc-gen-go. DO NOT EDIT.\npackage x\n")).toBe(true);
    expect(hasGeneratedHeader("/**\n * @generated SignedSource<<abc>>\n */")).toBe(true);
    expect(hasGeneratedHeader("# This file was autogenerated by uv via the following command:\n")).toBe(true);
    expect(hasGeneratedHeader("// This file is automatically generated. Do not edit.\n")).toBe(true);
    expect(hasGeneratedHeader('const s = "@generated";\n')).toBe(false);
    // ripgrep's zsh completion mentions auto-generated text without being generated
    expect(hasGeneratedHeader("#compdef rg\n\n# zsh completion for rg\n# the ones below that are auto-generated.\n")).toBe(false);
    expect(hasGeneratedHeader("a\nb\nc\nd\ne\n// Code generated x DO NOT EDIT.\n")).toBe(false); // line 6
  });
  test("contentRule order and the docs exemption of R12", () => {
    const long = new TextEncoder().encode(`${"x".repeat(5_000)}\n`);
    expect(contentRule(long, () => "x", "source")).toBe("R12.minified_content");
    expect(contentRule(long, () => "x", "docs")).toBeNull();
  });
});

describe("IDX-AT-07 indexDigest", () => {
  test("order-independent, sensitive to path and blob", () => {
    const a = [
      { path: "b.ts", blob: "2" },
      { path: "a.ts", blob: "1" },
    ];
    const d = computeIndexDigest(a, xxh3);
    expect(computeIndexDigest([...a].reverse(), xxh3)).toBe(d);
    expect(
      computeIndexDigest(
        [
          { path: "a.ts", blob: "1" },
          { path: "b.ts", blob: "3" },
        ],
        xxh3,
      ),
    ).not.toBe(d);
    expect(computeIndexDigest([{ path: "a.ts", blob: "1" }], xxh3)).not.toBe(d);
    expect(d).toMatch(/^[0-9a-f]{16}$/);
  });
});
