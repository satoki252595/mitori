/** NC-06 / NC-07: §4 says how to run it, §5 where to start reading — from the index, 0 tokens. */
import { describe, expect, test } from "bun:test";
import type { Fact, FileEntry, RepoPath, SymbolEntry } from "@mitori/core";
import { localhostUrl, staticGuide } from "./guide.ts";

const file = (path: string, lines = 50, cls: FileEntry["class"] = "source", lang = "tsx") => ({ path, lines, class: cls, lang }) as unknown as FileEntry;
const sym = (path: string, name: string, kind: string, start: number, end: number, exported = true) =>
  ({ path, name, qualname: name, kind, start, end, exported }) as unknown as SymbolEntry;

describe("NC-06 quick start / NC-07 reading order", () => {
  test("a Next.js app: Node version, npm install from the lockfile, npm run dev (not `next dev`), the README's URL; the App Router page is the entry", async () => {
    const files = [
      file("package.json", 40, "config", "generic"),
      file("package-lock.json", 9000, "config", "generic"),
      file("README.md", 120, "docs", "generic"),
      file("app/page.tsx", 60),
      file("app/Editor.tsx", 4300),
      file("lib/tokens.ts", 1700, "source", "typescript"),
      file("lib/prompt.ts", 1800, "source", "typescript"),
    ];
    const facts = [
      { kind: "script", name: "dev", command: "next dev", purpose: "run", path: "package.json", line: 9 },
      { kind: "script", name: "start", command: "npx serve out", purpose: "run", path: "package.json", line: 11 },
      { kind: "dependency", name: "next", ecosystem: "npm", version: "15", dev: false, path: "package.json", line: 20 },
      { kind: "entry", entry: "script", label: "start", path: "package.json", line: 11 },
    ] as unknown as Fact[];
    const syms: Record<string, SymbolEntry[]> = {
      "app/page.tsx": [sym("app/page.tsx", "Page", "function", 37, 57)],
      "app/Editor.tsx": [sym("app/Editor.tsx", "Editor", "function", 453, 4841)],
      "lib/tokens.ts": [
        sym("lib/tokens.ts", "Doc", "interface", 1600, 1650),
        sym("lib/tokens.ts", "Item", "type", 1626, 1700),
        sym("lib/tokens.ts", "SizeKey", "type", 19, 20),
      ],
      "lib/prompt.ts": [sym("lib/prompt.ts", "buildPrompt", "function", 1745, 1800)],
    };
    const deps: Record<string, string[]> = {
      "lib/tokens.ts": ["app/Editor.tsx", "lib/prompt.ts", "app/page.tsx"],
      "app/Editor.tsx": ["app/page.tsx"],
      "lib/prompt.ts": ["app/Editor.tsx"],
    };
    const imports: Record<string, string[]> = {
      "app/Editor.tsx": ["lib/tokens.ts", "lib/prompt.ts"],
      "app/page.tsx": ["app/Editor.tsx"],
      "lib/prompt.ts": ["lib/tokens.ts"],
    };
    const g = await staticGuide({
      indexer: {
        files: () => files,
        facts: () => facts,
        symbols: (p) => syms[p] ?? [],
        modules: () =>
          [{ id: "md_a", slug: "lib", name: "lib", children: [], paths: ["lib/tokens.ts", "lib/prompt.ts"], loc: 3500, rank: 1, topoOrder: 0 }] as never,
        graph: () => ({
          level: "file",
          nodes: files.map((f) => ({ id: f.path, label: f.path, rank: f.path === "lib/tokens.ts" ? 1 : 0.5, loc: f.lines })),
          edges: [],
        }),
        dependents: (p) => (deps[p] ?? []).map((x) => ({ path: x as RepoPath, kind: "import", weight: 1 })),
        imports: (p) => [{ to: imports[p] ?? [] }] as never,
      },
      profile: { toolchain: { name: "node", version: "^22.12 || ^24 || >=26", path: "package.json" as RepoPath, line: 6 } } as never,
      read: async (p) => (p === "README.md" ? "# m3e\n\n```\nnpm install\nnpm run dev\n```\n\nOpen http://localhost:3000 in the browser.\n" : null),
    });
    expect(g.toolchain?.version).toBe("^22.12 || ^24 || >=26");
    expect(g.install).toEqual({ command: "npm install", path: "package-lock.json" });
    expect(g.run).toMatchObject({ command: "npm run dev", raw: "next dev", path: "package.json", line: 9 });
    expect(g.url).toEqual({ url: "http://localhost:3000", path: "README.md", line: 8 });
    expect(g.framework).toEqual({ path: "app/page.tsx", label: "Next.js（App Router）のトップページ" });
    expect(g.reading?.map((r) => [r.role, r.path])).toEqual([
      ["entry", "app/page.tsx"],
      ["types", "lib/tokens.ts"],
      ["hub", "app/Editor.tsx"],
      ["core", "lib/prompt.ts"],
    ]);
    expect(g.reading?.[1]?.symbols.map((s) => s.name)).toContain("Doc");
    expect(g.reading?.[2]).toMatchObject({ line: 453, end: 4841, symbols: [{ name: "Editor", line: 453 }] });
  });

  test("localhost URLs are found in prose and code blocks; other hosts are not", () => {
    expect(localhostUrl("Run it, then visit http://127.0.0.1:8080/app.")).toEqual({ url: "http://127.0.0.1:8080/app", line: 1 });
    expect(localhostUrl("see https://example.com:3000")).toBeNull();
  });
});
