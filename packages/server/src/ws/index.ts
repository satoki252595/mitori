/**
 * @mitori/server — `ws/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { DocId, WorkspaceKey } from "@mitori/core";

/**
 * Doc id → workspace resolution for portable permalinks `/d/<docId>/b/<block>` [UXP-13]. The registry is in the
 * caller's preference order (most recently opened first); the first workspace carrying `doc` wins.
 */
export function resolveDocId(doc: DocId, registry: readonly { key: WorkspaceKey; docId?: DocId }[]): WorkspaceKey | null {
  for (const r of registry) if (r.docId === doc) return r.key;
  return null;
}
