/** NC-02: the first screen says what the repository is (README lede, toolchain, license, remote) — 0 tokens. */
import { describe, expect, test } from "bun:test";
import type { FileEntry, RepoPath } from "@mitori/core";
import { areasOf, licenseFallbackLine, licenseFromHeads, manifestLicense, parseRemote, readmeLede, repoProfile, spdxOf, toolchainOf } from "./profile.ts";
import { detectLicense } from "./static-input.ts";

describe("NC-02 repository profile", () => {
  test("README lede skips the heading, badges, HTML and image lines; keeps the first prose paragraph verbatim-ish", () => {
    const md = [
      '<p align="center"><img src="logo.png"></p>',
      "",
      "# m3e-canvas",
      "",
      "[![CI](https://x/badge.svg)](https://x) [![npm](https://y.svg)](https://y)",
      "",
      "A **visual** canvas for laying out Material 3 screens, then handing the layout to your AI coding tool as a",
      "precise prompt. Runs in the browser; no backend.",
      "",
      "## Install",
    ].join("\n");
    expect(readmeLede(md)).toEqual({
      line: 7,
      text: "A visual canvas for laying out Material 3 screens, then handing the layout to your AI coding tool as a precise prompt. Runs in the browser; no backend.",
    });
    expect(readmeLede("# x\n\n```sh\nnpm i\n```\n")).toBeNull();
    const long = `${"これは長い説明の文です。".repeat(40)}`;
    const cut = readmeLede(long)?.text ?? "";
    expect(cut.length).toBeLessThanOrEqual(280);
    expect(cut.endsWith("。")).toBe(true);
  });

  test("remote URLs lose credentials and .git; toolchain and license come from the manifests", () => {
    expect(parseRemote("git@github.com:tomasz-tomczyk/crit.git")).toEqual({ host: "github.com", path: "tomasz-tomczyk/crit" });
    expect(parseRemote("https://user:ghp_x@github.com/lnkiai/m3e-canvas.git")).toEqual({ host: "github.com", path: "lnkiai/m3e-canvas" });
    expect(parseRemote("ssh://git@gitlab.com:22/a/b/c")).toEqual({ host: "gitlab.com", path: "a/b/c" });
    expect(parseRemote("/local/path")).toBeNull();
    expect(toolchainOf("go.mod" as RepoPath, "module x\n\ngo 1.26\n", "go")).toEqual({ name: "go", version: "1.26", path: "go.mod", line: 3 });
    expect(toolchainOf("package.json" as RepoPath, '{\n  "name": "m3e",\n  "engines": {\n    "node": "^22.12 || ^24 || >=26"\n  }\n}', "tsx")).toEqual({
      name: "node",
      version: "^22.12 || ^24 || >=26",
      path: "package.json",
      line: 4,
    });
    expect(toolchainOf("pyproject.toml" as RepoPath, '[project]\nrequires-python = ">=3.10"\n', "python")?.version).toBe(">=3.10");
    expect(spdxOf("MIT License\n\nCopyright (c) 2026")).toBe("MIT");
    expect(spdxOf("Apache License\n Version 2.0, January 2004")).toBe("Apache-2.0");
  });

  test("the whole profile from the index's files (tiles: top directories and tests, largest first)", async () => {
    const f = (path: string, lines: number, lang = "tsx", cls: FileEntry["class"] = "source") => ({ path, lines, lang, class: cls }) as unknown as FileEntry;
    const files = [
      f("README.md", 40, "generic", "docs"),
      f("LICENSE", 21, "generic", "docs"),
      f("package.json", 30, "generic", "config"),
      f("app/Editor.tsx", 4300),
      f("lib/tokens.ts", 900, "typescript"),
      f("lib/prompt.ts", 1800, "typescript"),
      f("lib/prompt.test.ts", 300, "typescript", "test"),
    ];
    const texts: Record<string, string> = {
      "README.md": "# m3e\n\nA canvas that turns a screen layout into a prompt for your AI tool.\n",
      LICENSE: "MIT License\n",
      "package.json": '{"engines":{"node":">=22.12"}}',
    };
    const p = await repoProfile({
      info: { root: "/r" } as never,
      files: () => files,
      read: async (path) => texts[path] ?? null,
      git: {
        head: async () => "de2d97a0" as never,
        remoteUrl: async () => "git@github.com:lnkiai/m3e-canvas.git",
        headMeta: async () => ({ date: "2026-10-01T00:00:00Z" as never, tag: null }),
      },
    });
    expect(p.readme).toEqual({ path: "README.md", line: 3, text: "A canvas that turns a screen layout into a prompt for your AI tool." });
    expect(p.license).toEqual({ spdx: "MIT", path: "LICENSE" });
    expect(p.toolchain).toMatchObject({ name: "node", version: ">=22.12" });
    expect(p.remote).toEqual({ host: "github.com", path: "lnkiai/m3e-canvas" });
    expect(p.head).toEqual({ commit: "de2d97a0", date: "2026-10-01T00:00:00Z", tag: null });
    expect(p.areas.map((a) => [a.kind, a.dir ?? "", a.loc])).toEqual([
      ["dir", "app/", 4300],
      ["dir", "lib/", 2700],
      ["tests", "", 300],
    ]);
    expect(areasOf([])).toEqual([]);
  });
});

describe("WP30-C one license decision for the map and §0", () => {
  test("Elastic-2.0, BUSL-1.1 and SSPL-1.0 are recognized", () => {
    expect(spdxOf("Elastic License 2.0\n\nCopyright (c) 2026")).toBe("Elastic-2.0");
    expect(spdxOf("Business Source License 1.1\n\nLicensor: X")).toBe("BUSL-1.1");
    expect(spdxOf("Server Side Public License, Version 1, October 2018")).toBe("SSPL-1.0");
    expect(spdxOf("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3")).toBe("LGPL-3.0");
    expect(spdxOf("Redistribution and use in source and binary forms")).toBe("BSD-2-Clause");
  });

  test("manifest fallbacks: package.json, Cargo.toml and pyproject.toml", () => {
    expect(manifestLicense("package.json", '{"license":"Elastic-2.0"}')).toBe("Elastic-2.0");
    expect(manifestLicense("package.json", '{"license":"MIT OR Apache-2.0"}')).toBe("MIT OR Apache-2.0");
    expect(manifestLicense("package.json", "not json")).toBeNull();
    expect(manifestLicense("Cargo.toml", '[package]\nname = "x"\nlicense = "MIT"\n')).toBe("MIT");
    expect(manifestLicense("pyproject.toml", '[project]\nlicense = "GPL-3.0"\n')).toBe("GPL-3.0");
    expect(manifestLicense("pyproject.toml", '[project]\nlicense = { text = "Custom License v9" }\n')).toBe("Custom License v9");
    expect(manifestLicense("other.txt", 'license = "MIT"')).toBeNull();
  });

  test("unknown text falls back to the first non-empty line (≤ 60 chars, no markdown)", () => {
    expect(licenseFallbackLine("\n\n# My Custom License v9\n\nbody\n")).toBe("My Custom License v9");
    expect(licenseFallbackLine(`**${"x".repeat(100)}**\n`)).toBe("x".repeat(60));
    expect(licenseFallbackLine("\n   \n")).toBeNull();
  });

  test("§0 (detectLicense) and the map (repoProfile) agree: context-mode's Elastic case", async () => {
    const texts: Record<string, string> = {
      LICENSE: "Elastic License 2.0\n\nCopyright (c) 2026 Context Mode\n",
      "package.json": '{"name":"context-mode","license":"Elastic-2.0"}',
    };
    const s0 = await detectLicense(
      { root: "/r" } as never,
      { files: () => Object.keys(texts).map((path) => ({ path })) } as never,
      { readHead: async (abs: string) => new TextEncoder().encode(texts[abs.slice(3)] ?? "") } as never,
    );
    expect(s0).toBe("Elastic-2.0");
    const f = (path: string) => ({ path }) as unknown as FileEntry;
    const p = await repoProfile({
      info: { root: "/r" } as never,
      files: () => [f("LICENSE"), f("package.json")],
      read: async (path) => texts[path] ?? null,
      git: { head: async () => null as never },
    });
    expect(p.license).toEqual({ spdx: "Elastic-2.0", path: "LICENSE" });
    expect(p.license?.spdx).toBe(s0 ?? undefined);
  });

  test("package.json-only and first-line fallbacks agree on both paths", async () => {
    const only = [{ path: "package.json", text: '{"license":"BUSL-1.1"}' }];
    expect(licenseFromHeads([], only)).toEqual({ spdx: "BUSL-1.1", path: "package.json" });
    const unknown = [{ path: "LICENSE", text: "\n# Acme License 2026\n\nterms\n" }];
    expect(licenseFromHeads(unknown, [])?.spdx).toBe("Acme License 2026");
    const s0 = await detectLicense(
      { root: "/r" } as never,
      { files: () => [{ path: "LICENSE" }] } as never,
      { readHead: async () => new TextEncoder().encode("\n# Acme License 2026\n\nterms\n") } as never,
    );
    expect(s0).toBe("Acme License 2026");
  });
});
