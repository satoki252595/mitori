import { describe, expect, test } from "bun:test";
import type { RepoPath } from "@mitori/core";
import type { StageFile } from "../resolve/files.ts";
import { resolveImports } from "../resolve/stage.ts";
import { imp, input, sf } from "../resolve/test/stage-files.ts";
import { buildAtoms } from "./atoms.ts";
import { nodeScope, undirected } from "./cluster.ts";
import { buildFileGraph, type FileGraph } from "./graph.ts";
import { DEFAULT_TUNING, TEST_TUNING, type Tuning } from "./tuning.ts";

/** Atoms of a synthetic repo, as sorted path lists. */
function atomsOf(files: StageFile[], tuning: Tuning = TEST_TUNING, edit?: (fg: FileGraph) => void): string[][] {
  const inp = input(files);
  const fg = buildFileGraph(inp.files, resolveImports(inp));
  edit?.(fg);
  const byPath = new Map(inp.files.map((f) => [f.path, f]));
  const { ug } = undirected(fg, nodeScope(fg, byPath));
  const order = Int32Array.from(fg.paths, (_, i) => i);
  const sig = new Float64Array(fg.paths.length);
  return buildAtoms({ fg, files: byPath, ug, order, sig, tuning })
    .members.map((m) => m.map((v) => fg.paths[v] as string).sort())
    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
}

/** Add a dependency edge (weight 1) by path. */
const edge = (fg: FileGraph, from: RepoPath, to: RepoPath, w = 1) => {
  fg.out[fg.index.get(from) as number]?.set(fg.index.get(to) as number, { import: w, ref: 0 });
};

const go = (path: string, pkg: string, loc = 40) => sf(path, { loc, lines: loc, headings: [{ level: 0, line: 1, text: pkg }] });

describe("IDX-U S3 atoms (directory units)", () => {
  test("a Go package stays one atom even when its files lean towards different packages", () => {
    const files = [go("a/x.go", "a"), go("a/y.go", "a"), go("b/b.go", "b", 80), go("c/c.go", "c", 80)];
    const atoms = atomsOf(files, TEST_TUNING, (fg) => {
      edge(fg, "a/x.go", "b/b.go", 3);
      edge(fg, "a/y.go", "c/c.go", 3);
    });
    expect(atoms).toContainEqual(["a/x.go", "a/y.go"]);
  });

  test("a layer directory the graph splits is dissolved; one the graph agrees with stays whole", () => {
    // components/A ↔ lib/a and components/B ↔ lib/b: features across two layer directories
    const files = ["components/A.tsx", "components/B.tsx", "lib/a.ts", "lib/b.ts"].map((p) => sf(p, { loc: 60 }));
    const layered = atomsOf(files, TEST_TUNING, (fg) => {
      edge(fg, "components/A.tsx", "lib/a.ts", 4);
      edge(fg, "components/B.tsx", "lib/b.ts", 4);
    });
    expect(layered).toEqual([["components/A.tsx"], ["components/B.tsx"], ["lib/a.ts"], ["lib/b.ts"]]);
    const cohesive = atomsOf(files, TEST_TUNING, (fg) => {
      edge(fg, "components/A.tsx", "components/B.tsx", 4);
      edge(fg, "lib/a.ts", "lib/b.ts", 4);
    });
    expect(cohesive).toEqual([
      ["components/A.tsx", "components/B.tsx"],
      ["lib/a.ts", "lib/b.ts"],
    ]);
  });

  test("a collection of independent sibling directories is one atom; app layers that import each other are not", () => {
    const plugins = ["cors", "jwt", "logger"].map((n) => sf(`src/middleware/${n}/index.ts`, { loc: 30, imports: [imp("../../core.ts")] }));
    const core = sf("src/core.ts", { loc: 200 });
    expect(atomsOf([...plugins, core])).toContainEqual(["src/middleware/cors/index.ts", "src/middleware/jwt/index.ts", "src/middleware/logger/index.ts"]);
    const layers = [
      sf("app/db/repo.ts", { loc: 40 }),
      sf("app/http/routes.ts", { loc: 40, imports: [imp("../db/repo.ts")] }),
      sf("app/ui/view.tsx", { loc: 40, imports: [imp("../http/routes.ts")] }),
    ];
    expect(atomsOf(layers).some((a) => a.length === 3)).toBe(false);
  });

  test("files without a parser ride with their directory's group", () => {
    const files = [
      sf("web/app.ts", { loc: 50, imports: [imp("./util.ts")] }),
      sf("web/util.ts", { loc: 50, imports: [imp("./app.ts")] }),
      sf("web/style.css", { loc: 400, lang: "generic" }),
      sf("web/index.ts", { loc: 5, imports: [imp("./app.ts")] }),
    ];
    expect(atomsOf(files, DEFAULT_TUNING)).toContainEqual(["web/app.ts", "web/index.ts", "web/style.css", "web/util.ts"]);
  });

  test("a package above the soft maximum is cut into a few parts within it (never one file per atom)", () => {
    // 12 files × 900 LOC = 10.8k > 6k: two groups of six that call each other
    const files = Array.from({ length: 12 }, (_, i) => go(`big/f${String(i).padStart(2, "0")}.go`, "big", 900));
    const atoms = atomsOf(files, DEFAULT_TUNING, (fg) => {
      for (let i = 0; i < 12; i++)
        for (let j = 0; j < 12; j++)
          if (i !== j && Math.floor(i / 6) === Math.floor(j / 6)) edge(fg, `big/f${String(i).padStart(2, "0")}.go`, `big/f${String(j).padStart(2, "0")}.go`);
    });
    expect(atoms.length).toBe(2);
    for (const a of atoms) {
      expect(a.length).toBe(6);
      expect(a.every((p) => p.startsWith("big/"))).toBe(true);
    }
  });
});
