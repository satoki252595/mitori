import { describe, expect, test } from "bun:test";
import { SLUG_RE } from "@mitori/core";
import { directoryTree } from "./hierarchy.ts";
import { moduleNames, type NameInput } from "./naming.ts";
import { DEFAULT_TUNING } from "./tuning.ts";

const LOC: Record<string, number> = {};
const loc = (p: string) => LOC[p] ?? 100;
/** Subtree LOC over every path any test declared. */
const subtree = (all: readonly string[]) => (dir: string) => all.filter((p) => dir === "" || p.startsWith(`${dir}/`)).reduce((a, p) => a + loc(p), 0);

const mod = (paths: string[], dominantDir: string): NameInput => ({ paths, dominantDir, anchor: paths[0] as string });

describe("IDX-U provisional module names (path-based, spec §6.6)", () => {
  test("a module that is its directory is named after it; one file is its path", () => {
    const a = mod(["internal/vcs/git.go", "internal/vcs/jj.go"], "internal/vcs");
    const b = mod(["web/app.js"], "web");
    const all = [...a.paths, ...b.paths];
    const [na, nb] = moduleNames([a, b], loc, subtree(all));
    expect(na).toEqual({ name: "internal/vcs", slugBase: "internal-vcs" });
    expect(nb?.name).toBe("web/app.js");
    expect(SLUG_RE.test(nb?.slugBase ?? "")).toBe(true);
  });

  test("members spread over child directories list them; a shared directory is told apart by file prefix or main files", () => {
    LOC["internal/github/github.go"] = 2300;
    LOC["internal/gitlab/api.go"] = 1400;
    LOC["internal/forge/forge.go"] = 300;
    const forges = mod(["internal/forge/forge.go", "internal/github/github.go", "internal/gitlab/api.go"], "internal");
    const other = mod(["internal/config/config.go", "internal/auth/auth.go"], "internal");
    const live = mod(["web/live-mode.js", "web/live-mode.panel.js", "web/live-mode.queue.js"], "web");
    LOC["web/crit-renderer.js"] = 900;
    LOC["web/comment-html.js"] = 500;
    const render = mod(["web/crit-renderer.js", "web/comment-html.js", "web/x.js"], "web");
    const all = [...forges.paths, ...other.paths, ...live.paths, ...render.paths];
    const names = moduleNames([forges, other, live, render], loc, subtree(all)).map((n) => n.name);
    expect(names).toEqual(["internal/github · gitlab", "internal/auth · config", "web (live-mode*)", "web (crit-renderer, comment-html)"]);
  });

  test("repository-root modules name their top directories, as deep as they stay one directory", () => {
    LOC["src/adapter/bun/index.ts"] = 300;
    const m = mod(["src/adapter/bun/index.ts", "src/adapter/deno/index.ts", "adapters/bun/src/index.ts", "adapters/deno/src/index.ts"], ".");
    const [n] = moduleNames([m], loc, subtree(m.paths));
    expect(n?.name).toBe("src/adapter · adapters");
    expect(n?.slugBase).toBe("src-adapter-adapters");
  });

  test("names never join directories with `+` or append a symbol, and stay unique within a level", () => {
    const a = mod(["pkg/a.go", "pkg/b.go"], "pkg");
    const b = mod(["pkg/a2.go", "pkg/b2.go"], "pkg");
    const names = moduleNames([a, b], loc, subtree([...a.paths, ...b.paths])).map((n) => n.name);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).not.toMatch(/ \+ | · [A-Z][A-Za-z]+$/);
  });
});

describe("IDX-U parents follow the directory tree (spec §6.3-6)", () => {
  const P = DEFAULT_TUNING;
  test("≤ 10 leaves: no parents; crit-like homes: one parent per top directory with ≥ 2 leaves", () => {
    expect(directoryTree(["a", "b", "c"], P)).toEqual([]);
    const homes = [
      "internal/vcs",
      "internal/session",
      "internal/session",
      "internal",
      "internal/server",
      "internal",
      "cmd/crit",
      "internal/github",
      "internal/comment",
      "web",
      "web",
      "web",
      "web",
      "scripts",
    ];
    const tree = directoryTree(homes, P);
    expect(tree.map((t) => [t.dir, t.leaves.length, t.level])).toEqual([
      ["internal", 8, 1],
      ["web", 4, 1],
    ]);
  });

  test("a shared prefix is skipped and a parent with more than 15 children is grouped again (depth ≤ 3)", () => {
    const homes = [
      ...Array.from({ length: 18 }, (_, i) => `packages/excalidraw/${i % 3 === 0 ? "components" : `d${i}`}`),
      ...Array.from({ length: 6 }, () => "packages/element/src"),
      "packages/common/src",
      "excalidraw-app",
      "excalidraw-app",
    ];
    const tree = directoryTree(homes, P);
    const top = tree.filter((t) => !tree.some((u) => u.parents.includes(tree.indexOf(t))));
    expect(top.map((t) => t.dir).sort()).toEqual(["excalidraw-app", "packages"]);
    const pk = tree.find((t) => t.dir === "packages");
    expect(pk?.level).toBe(2);
    expect(pk?.parents.map((i) => tree[i]?.dir).sort()).toEqual(["packages/element", "packages/excalidraw"]);
    expect(pk?.leaves.length).toBe(1); // packages/common/src stays a direct child
  });
});
