/** Fixture truth for imports, cross-file calls and module constraints (testing spec §2.4) under the test structure params. */
import { afterAll, describe, expect, test } from "bun:test";
import { buildFixture, type FixtureName, type FixtureRepo, loadTruth, scoreIndex, type TruthScore } from "@mitori/testkit/fixtures";
import { loadRepo } from "./test/corpus.ts";
import { miniIndexer, runPipeline } from "./test/pipeline.ts";
import { TEST_TUNING } from "./tuning.ts";

const built: FixtureRepo[] = [];
afterAll(async () => {
  for (const b of built) await b.dispose();
});

async function scores(name: FixtureName): Promise<TruthScore[]> {
  const repo = await buildFixture(name);
  built.push(repo);
  const p = runPipeline((await loadRepo(repo.root)).input, { tuning: TEST_TUNING });
  return scoreIndex(miniIndexer(p), loadTruth(name));
}

describe("IDX-U fixture truth: resolved import edges and cross-file calls", () => {
  for (const name of ["ts-small", "go-small", "py-small", "rust-small", "mixed"] as FixtureName[]) {
    test(`IDX-AT-20…23 ${name}: every in-repo import edge exactly; calls recall within tolerance`, async () => {
      const s = await scores(name);
      const truth = loadTruth(name);
      const imports = s.find((x) => x.category === "imports");
      const calls = s.find((x) => x.category === "calls");
      expect(imports?.missing).toEqual([]);
      expect(imports?.unexpected).toEqual([]);
      expect(calls?.recall ?? 0).toBeGreaterThanOrEqual(truth.tolerances.callsRecall);
    }, 30_000);
  }
});

describe("IDX-U-042 module constraints (TEST_TUNING)", () => {
  for (const name of ["rust-small"] as FixtureName[])
    test(`${name}: together / apart`, async () => {
      expect((await scores(name)).find((x) => x.category === "modules")?.missing).toEqual([]);
    }, 30_000);
  // Not derivable from the code graph (no dependency between the files the truth groups); see cr-requests/WP-03.md.
  for (const name of ["ts-small", "go-small", "py-small", "mixed"] as FixtureName[])
    test.todo(`${name}: together / apart`, async () => {
      expect((await scores(name)).find((x) => x.category === "modules")?.missing).toEqual([]);
    });
});
