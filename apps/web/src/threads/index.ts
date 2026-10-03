/**
 * @mitori/web — `threads/` (owner: WP-10b). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { ThreadState, ThreadSummary } from "@mitori/core";
import type { UiStatus } from "../contract.ts";

/** Lifecycle state → UI status (`proposed` = a ready job waiting for review: 「レビュー待ち」). */
const BY_STATE = {
  draft: "draft",
  open: "open",
  queued: "queued",
  running: "running",
  answered: "answered",
  proposed: "ready",
  applied: "applied",
  rejected: "rejected",
  failed: "failed",
  needs_input: "needs_input",
  resolved: "resolved",
} as const satisfies Record<ThreadState, UiStatus>;

/** States where nothing is in flight, so the orthogonal「再確認」(another accepted change touched the anchor) is the news. */
const PASSIVE: ReadonlySet<ThreadState> = new Set(["open", "answered", "applied", "rejected"]);

/**
 * Thread → UI status (outdated derived from anchorHealth; `doc_edit` drafts ⇒ needs_choice). Precedence: the
 * 2-way choice of a doc_edit draft, resolved, an outdated anchor (the thread cannot be acted on until re-anchored),
 * then the lifecycle state — with `stale` (↻ 再確認) replacing the passive states only.
 */
export function threadStatus(t: Pick<ThreadSummary, "state" | "anchorHealth" | "intent" | "stale">): UiStatus {
  if (t.intent === "doc_edit" && t.state === "draft") return "needs_choice";
  if (t.state === "resolved") return "resolved";
  if (t.anchorHealth === "outdated") return "outdated";
  if (t.stale && PASSIVE.has(t.state)) return "stale";
  return BY_STATE[t.state];
}
