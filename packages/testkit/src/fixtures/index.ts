/**
 * @mitori/testkit — `fixtures/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files (spec.ts, build.ts, generators.ts, truth.ts, score.ts).
 * `indexerFromGolden` stays an M0 stub (E_UNSUPPORTED) until the indexer owners (WP-02/03) have produced the golden files it reads.
 */
import { unsupported } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import type { FixtureName, FixtureRepo, FixtureTruth, TruthScore } from "../contract.ts";
import { build } from "./build.ts";
import { score } from "./score.ts";
import { readTruth } from "./truth.ts";

export function buildFixture(name: FixtureName, opts?: { step?: number | "dirty"; into?: string }): Promise<FixtureRepo> {
  return build(name, opts);
}

export function loadTruth(name: FixtureName): FixtureTruth {
  return readTruth(name);
}

export function scoreIndex(indexer: Indexer, truth: FixtureTruth): Promise<TruthScore[]> {
  return score(indexer, truth);
}

/** Read-only Indexer backed by a fixture's golden outputs (gen/loop unit tests without parsing). */
export function indexerFromGolden(name: FixtureName): Indexer {
  return unsupported("testkit.indexerFromGolden", name);
}
