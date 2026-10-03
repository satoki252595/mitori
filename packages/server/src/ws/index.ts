/**
 * @mitori/server — `ws/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type DocId, unsupported, type WorkspaceKey } from "@mitori/core";

/** Doc id → workspace resolution for portable permalinks `/d/<docId>/b/<block>` [UXP-13]. */
export function resolveDocId(doc: DocId, registry: readonly { key: WorkspaceKey; docId?: DocId }[]): WorkspaceKey | null {
  return unsupported("server.resolveDocId", doc, registry);
}
