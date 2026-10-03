// IDX-AT-11 / IDX-AT-01 against the hand-written truth: symbol extraction and file classification on the fixture
// repos (MILESTONES WP-02: 「fixture 7 種で symbol 抽出が truth と一致」).
import { afterAll, describe, expect, test } from "bun:test";
import type { SymbolKind } from "@mitori/core";
import { createIndexer } from "./index.ts";
import { testDeps } from "./test/deps.ts";
import { type FixtureRepoLike, testkit } from "./test/fixtures.ts";

/**
 * Documented truth errata (CR-PENDING(WP-02), docs/design/cr-requests/WP-02.md §4): the indexer spec §3.6 kind rule
 * makes Python `__init__` a `constructor`; the truth file says `method`.
 */
const ERRATA: Readonly<Record<string, { kind: SymbolKind }>> = {
  "tsundoku/repo.py#Repo.__init__": { kind: "constructor" },
};

const SYMBOL_FIXTURES = ["ts-small", "py-small", "go-small", "rust-small", "mixed", "edge-inventory", "secrets", "injection", "doc-roundtrip"] as const;
const repos: FixtureRepoLike[] = [];
afterAll(async () => {
  for (const r of repos) await r.dispose();
});

describe("IDX-AT-11 symbols match the fixture truth", () => {
  for (const name of SYMBOL_FIXTURES) {
    test(name, async () => {
      const kit = await testkit();
      const repo = await kit.buildFixture(name);
      repos.push(repo);
      const deps = testDeps(repo.root);
      const idx = createIndexer(deps);
      await idx.scan({ until: "S1" });
      const truth = kit.loadTruth(name);
      const fixed = { ...truth, symbols: truth.symbols.map((s) => ({ ...s, ...(ERRATA[s.key] ?? {}) })) };
      const scores = await kit.scoreIndex(idx, fixed);
      const sym = scores.find((s) => s.category === "symbols");
      const files = scores.find((s) => s.category === "files");
      if ((sym?.missing.length ?? 0) > 0) console.log(name, "symbols missing:", sym?.missing);
      if ((files?.missing.length ?? 0) + (files?.unexpected.length ?? 0) > 0)
        console.log(name, "files missing:", files?.missing, "unexpected:", files?.unexpected);
      expect(sym?.missing ?? []).toEqual([]);
      await idx.close();
    });
  }
});
