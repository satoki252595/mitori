/**
 * @mitori/doc — `render/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type Hasher, type Logger, type SecretScanner, type SqlDb, unsupported, type WorkerPool } from "@mitori/core";
import type { BlockRenderer, HighlightReq } from "../contract.ts";

/** Renderer factory [CONS-26]. Highlighting runs in the compute Worker. */
export function createBlockRenderer(deps: {
  highlighter: WorkerPool<HighlightReq, string>;
  secrets: SecretScanner;
  hasher: Hasher;
  db: SqlDb;
  log: Logger;
}): BlockRenderer {
  return unsupported("doc.createBlockRenderer", deps);
}
