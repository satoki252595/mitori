/**
 * @mitori/testkit — `fixtures/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import type { FixtureName, FixtureRepo, FixtureTruth, TruthScore } from "../contract.ts";

export function buildFixture(name: FixtureName, opts?: { step?: number | "dirty"; into?: string }): Promise<FixtureRepo> {
  return unsupported("testkit.buildFixture", name, opts);
}

export function loadTruth(name: FixtureName): FixtureTruth {
  return unsupported("testkit.loadTruth", name);
}

export function scoreIndex(indexer: Indexer, truth: FixtureTruth): Promise<TruthScore[]> {
  return unsupported("testkit.scoreIndex", indexer, truth);
}

/** Read-only Indexer backed by a fixture's golden outputs (gen/loop unit tests without parsing). */
export function indexerFromGolden(name: FixtureName): Indexer {
  return unsupported("testkit.indexerFromGolden", name);
}
