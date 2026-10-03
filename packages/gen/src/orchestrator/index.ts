/**
 * @mitori/gen — `orchestrator/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Migration, unsupported } from "@mitori/core";
import type { GenDeps, GenOrchestrator } from "../contract.ts";

/** Factory. */
export function createGen(deps: GenDeps): GenOrchestrator {
  return unsupported("gen.createGen", deps);
}

/** SQLite migrations owned by `@mitori/gen` (`gen_meta`, `gen_estimates`, `gen_runs`, `gen_tasks`, `gen_outputs`, `gen_prep`, `gen_lines`; DDL in spec §13). */
export const GEN_MIGRATIONS: readonly Migration[] = [];
