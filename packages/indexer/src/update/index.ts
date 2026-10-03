/**
 * @mitori/indexer — `update/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Migration, unsupported } from "@mitori/core";
import type { Indexer, IndexerDeps } from "../contract.ts";

/** Factory (implementation in packages/indexer/src/index.ts). */
export function createIndexer(deps: IndexerDeps): Indexer {
  return unsupported("indexer.createIndexer", deps);
}

/** SQLite migrations owned by the indexer (`idx_*` tables, spec §9). */
export const INDEXER_MIGRATIONS: readonly Migration[] = [];
