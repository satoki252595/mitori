// Golden outputs of S0/S1 on every fixture repo (testing spec §2.5): `indexer/files.json`, `indexer/symbols/<path>.json`
// and `skeleton/<path>.<tier>.txt` (byte-exact). They also seed testkit's `indexerFromGolden` (WP-12).
// Update: MITORI_UPDATE_GOLDEN=1 scripts/nd bun run golden --filter indexer — in a dedicated `golden:` commit.
import { afterAll, describe, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIndexer } from "./index.ts";
import { testDeps } from "./test/deps.ts";
import { type FixtureRepoLike, testkit } from "./test/fixtures.ts";
import { cliGit, shadowGit } from "./test/git.ts";
import { expectGolden, goldenSafe } from "./test/golden.ts";

const FIXTURES = ["ts-small", "py-small", "go-small", "rust-small", "mixed", "edge-inventory", "secrets", "injection", "doc-roundtrip", "nongit"] as const;
const TIERS = ["l0", "sig", "doc"] as const;
/** Generated size-boundary inputs (edge-inventory `huge/`) would make megabyte goldens; they are covered by the inventory tests. */
const GOLDEN_MAX_BYTES = 65_536;
const disposers: (() => unknown)[] = [];
afterAll(async () => {
  for (const d of disposers) await d();
});

describe("IDX-G-001 fixture goldens (files, symbols, skeletons)", () => {
  for (const name of FIXTURES) {
    test(name, async () => {
      const kit = await testkit();
      const repo: FixtureRepoLike = await kit.buildFixture(name);
      disposers.push(() => repo.dispose());
      let git = cliGit(repo.root);
      let kind: "git" | "shadow" = "git";
      if (name === "nongit") {
        const shadow = mkdtempSync(join(tmpdir(), "mitori-shadow-"));
        disposers.push(() => rmSync(shadow, { recursive: true, force: true }));
        git = shadowGit(repo.root, join(shadow, "shadow.git"));
        kind = "shadow";
      }
      const idx = createIndexer(testDeps(repo.root, { git, kind }));
      disposers.push(() => idx.close());
      await idx.scan({ until: "S1" });
      const files = idx.files({ includeExcluded: true });
      expectGolden(`${name}/indexer/files.json`, files);
      for (const f of files) {
        if (!goldenSafe(f.path) || f.excluded !== undefined || f.class !== "source" || f.size > GOLDEN_MAX_BYTES) continue;
        const symbols = [...idx.symbols(f.path)].sort((a, b) => a.start - b.start || (a.qualname < b.qualname ? -1 : 1));
        if (symbols.length === 0) continue;
        expectGolden(`${name}/indexer/symbols/${f.path}.json`, symbols);
        for (const tier of TIERS) expectGolden(`${name}/skeleton/${f.path}.${tier}.txt`, idx.skeleton({ kind: "file", path: f.path }, tier, "claude-v5").text);
      }
    });
  }
});
