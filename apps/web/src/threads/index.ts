/**
 * @mitori/web — `threads/` (owner: WP-10b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type ThreadSummary, unsupported } from "@mitori/core";
import type { UiStatus } from "../contract.ts";

/** Thread → UI status (outdated derived from anchorHealth; `doc_edit` drafts ⇒ needs_choice). */
export function threadStatus(t: Pick<ThreadSummary, "state" | "anchorHealth" | "intent" | "stale">): UiStatus {
  return unsupported("web.threadStatus", t);
}
