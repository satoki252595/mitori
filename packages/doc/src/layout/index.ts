/**
 * @mitori/doc — `layout/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type DiagramIR, type DiagramLayout, type Hasher, type Logger, type SqlDb, unsupported, type WorkerPool } from "@mitori/core";
import type { DiagramLayouter } from "../contract.ts";

/** Layouter factory [CONS-26]. ELK runs in its own Worker (elk-api.js + embedded elk-worker.min.js) [SC-04]. */
export function createDiagramLayouter(deps: {
  elk: WorkerPool<{ ir: DiagramIR; kind: "layered" | "floorplan"; prev: DiagramLayout | null }, DiagramLayout>;
  db: SqlDb;
  hasher: Hasher;
  log: Logger;
}): DiagramLayouter {
  return unsupported("doc.createDiagramLayouter", deps);
}
