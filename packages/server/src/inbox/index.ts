/**
 * @mitori/server — `inbox/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type InboxFilter, type InboxItem, unsupported } from "@mitori/core";
import type { InboxSources } from "../contract.ts";

/** Merge + filter + sort (`updatedAt` desc, then kind order thread < job < proposal < trust < gen_run < suggestion, then id). Pure. */
export function buildInbox(sources: InboxSources, filter: InboxFilter | null): InboxItem[] {
  return unsupported("server.buildInbox", sources, filter);
}
