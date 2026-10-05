// WP-INT: the real facade with WP-03's stages wired in (later.ts) answers S2–S4 on the fixture repos.
import { afterAll, describe, expect, test } from "bun:test";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { bunWorkerPool } from "../parse/test/bun-pool.ts";
import { workerInit } from "../parse/test/env.ts";
import { createIndexer } from "./index.ts";
import { testDeps } from "./test/deps.ts";
import { cliGit } from "./test/git.ts";

const built: FixtureRepo[] = [];
afterAll(async () => {
  for (const b of built) await b.dispose();
});

describe("WP-INT later stages behind the facade", () => {
  test("go-small: facts, modules, graph, palette, pack and search after one scan", async () => {
    const repo = await buildFixture("go-small");
    built.push(repo);
    const idx = createIndexer(testDeps(repo.root, { git: cliGit(repo.root), pool: bunWorkerPool(workerInit()), kind: "git" }));
    try {
      const sum = await idx.scan({ reason: "open" });
      expect(sum.modules).toBeGreaterThan(0);
      const kinds = new Set(idx.facts().map((f) => f.kind));
      for (const k of ["entry", "env", "route", "script"]) expect(kinds.has(k as never)).toBe(true);
      const mods = idx.modules();
      expect(mods.length).toBe(sum.modules);
      const leaf = mods.find((m) => m.paths.length > 0);
      expect(leaf).toBeDefined();
      if (leaf) {
        expect(idx.moduleOf(leaf.paths[0] as string)).toBe(leaf.id);
        expect(idx.skeleton({ kind: "module", module: leaf.id }, "sig", "claude-v5").files.length).toBeGreaterThan(0);
        expect(idx.moduleContext(leaf.id, { tokenizer: "claude-v5", budget: 28000 }).tokens.total).toBeGreaterThan(0);
      }
      expect(idx.graph("module").nodes.length).toBeGreaterThan(0);
      expect(idx.paletteItems().some((i) => i.k === "m")).toBe(true);
      expect(idx.repoPack({ tokenizer: "claude-v5" }).text.startsWith("=== mitori.repopack/2")).toBe(true);
      expect(idx.search("config", ["file", "symbol"], 10).length).toBeGreaterThan(0);
    } finally {
      await idx.close();
    }
  }, 60_000);
});
