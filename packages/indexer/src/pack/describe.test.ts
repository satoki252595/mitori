import { describe, expect, test } from "bun:test";
import type { ModuleDetail } from "../contract.ts";
import { sf } from "../resolve/test/stage-files.ts";
import { leadingDoc, moduleSummary } from "./describe.ts";

const frag = (path: string, lines: Record<number, string>) =>
  `=== ${path} · x · 99 lines ===\n${Object.entries(lines)
    .map(([n, l]) => `${n}|${l}`)
    .join("\n")}\n`;

describe("IDX-U provisional module descriptions", () => {
  test("package / module docs per language; item docs, directives and license headers are not module docs", () => {
    expect(leadingDoc(frag("a/notify.go", { 1: "// Package notify sends desktop notifications.", 2: "// More.", 4: "package notify" }), "a/notify.go")).toBe(
      "Package notify sends desktop notifications. More.",
    );
    expect(leadingDoc(frag("x/lib.rs", { 1: "/*!", 2: "The ignore crate provides a fast walker.", 3: "*/" }), "x/lib.rs")).toBe("The ignore crate provides a fast walker.");
    expect(leadingDoc(frag("x/lib.rs", { 1: "/// A field doc", 2: "pub struct A;" }), "x/lib.rs")).toBeNull();
    expect(leadingDoc(frag("p/__init__.py", { 1: '"""Flask utilities.', 2: "", 3: 'Second paragraph."""' }), "p/__init__.py")).toBe("Flask utilities.");
    expect(leadingDoc(frag("s/index.ts", { 1: "/**", 2: " * @module", 3: " * JSX for Hono.", 4: " */" }), "s/index.ts")).toBe("JSX for Hono.");
    // an untagged comment glued to a declaration documents that declaration
    expect(leadingDoc(frag("s/index.ts", { 1: "/** status codes cached by default. */", 2: "const x = 1" }), "s/index.ts")).toBeNull();
    expect(leadingDoc(frag("s/index.ts", { 1: "// eslint-disable-next-line", 2: "export {}" }), "s/index.ts")).toBeNull();
    expect(leadingDoc(frag("a/a.go", { 1: "// Copyright 2026 Acme. Licensed under MIT.", 3: "package a" }), "a/a.go")).toBeNull();
  });

  test("a module's description: package doc, then the package manifest, then its structure", () => {
    const files = new Map(
      [
        sf("crates/ignore/src/lib.rs", { loc: 3000, symbols: [{ name: "WalkBuilder", kind: "struct" }] }),
        sf("crates/ignore/src/walk.rs", { loc: 3000, symbols: [{ name: "walk", kind: "function" }] }),
      ].map((f) => [f.path, f]),
    );
    const m = { dominantDir: "crates/ignore/src" } as ModuleDetail;
    const paths = [...files.keys()];
    const base = { docSkeleton: () => null, rank: () => 0, subtreeLoc: () => 6000 };
    const cargo = 'name = "ignore"\ndescription = """\nA fast library for efficiently matching ignore files\nagainst file paths.\n"""\n';
    expect(moduleSummary(m, paths, files, { ...base, manifest: (p) => (p === "crates/ignore/Cargo.toml" ? cargo : null) })).toBe(
      "A fast library for efficiently matching ignore files against file paths.",
    );
    // a module that is a small part of its package does not borrow the package's description
    expect(moduleSummary(m, paths, files, { ...base, subtreeLoc: () => 60_000, manifest: () => cargo })).toBe("2 files · WalkBuilder, walk");
  });
});
