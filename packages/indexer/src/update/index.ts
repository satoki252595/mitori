/**
 * @mitori/indexer — `update/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Migration } from "@mitori/core";
import type { Indexer, IndexerDeps } from "../contract.ts";
import { createIndexerWith } from "./facade.ts";
import { MIGRATIONS } from "./migrations.ts";
import { defaultStagesFactory } from "./stages.ts";

/** Factory (implementation in packages/indexer/src/index.ts). */
export function createIndexer(deps: IndexerDeps): Indexer {
  return createIndexerWith(deps, defaultStagesFactory);
}

/** SQLite migrations owned by the indexer (`idx_*` tables, spec §9). */
export const INDEXER_MIGRATIONS: readonly Migration[] = MIGRATIONS;
