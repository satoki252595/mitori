/**
 * @mitori/gen — `orchestrator/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Migration } from "@mitori/core";
import type { GenDeps, GenOrchestrator } from "../contract.ts";
import { createGenInternal } from "./gen.ts";
import { GEN_MIGRATIONS_V } from "./migrations.ts";

/** Factory. */
export function createGen(deps: GenDeps): GenOrchestrator {
  return createGenInternal(deps);
}

/** SQLite migrations owned by `@mitori/gen` (`gen_meta`, `gen_estimates`, `gen_runs`, `gen_tasks`, `gen_outputs`, `gen_prep`, `gen_lines`; DDL in spec §13). */
export const GEN_MIGRATIONS: readonly Migration[] = GEN_MIGRATIONS_V;
