/**
 * Inbox tagging rules (server spec §7.3, CONS-34): one vocabulary for API and UI. Tags a source already attached
 * (e.g. `uncommitted`, which needs checkpoint data, or `draft`, which only the loop knows has a body) are kept;
 * the state-derived ones are added here; every item is `all`.
 */
import type { InboxFilter, InboxItem, SuggestionView } from "@mitori/core";

const THREAD_MINE = new Set(["answered", "proposed", "needs_input", "failed"]);
const THREAD_WORKING = new Set(["queued", "running"]);
const JOB_WORKING = new Set(["queued", "waiting_lock", "preparing", "running", "gating", "repairing", "accepting"]);
const RUN_WORKING = new Set(["estimating", "awaiting_confirm", "running", "paused"]);

export function tagsOf(item: InboxItem): InboxFilter[] {
  const tags = new Set<InboxFilter>(item.tags);
  tags.add("all");
  const state = item.state;
  if (item.displayState === "outdated") {
    tags.add("outdated");
    tags.add("mine");
  }
  switch (item.kind) {
    case "thread":
      if (THREAD_MINE.has(state)) tags.add("mine");
      if (THREAD_WORKING.has(state)) tags.add("working");
      if (state === "failed") tags.add("failed");
      if (state === "resolved") tags.add("resolved");
      break;
    case "job":
      if (JOB_WORKING.has(state)) tags.add("working");
      if (state === "ready") tags.add("review");
      if (state === "failed") {
        tags.add("failed");
        tags.add("mine");
      }
      break;
    case "proposal":
      tags.add("proposals");
      if (state === "pending") tags.add("mine");
      break;
    case "trust":
      tags.add("trust");
      if (state === "pending") tags.add("mine");
      break;
    case "gen_run":
      if (RUN_WORKING.has(state)) tags.add("working");
      if (state === "failed") {
        tags.add("failed");
        tags.add("mine");
      }
      break;
    case "suggestion":
      tags.add("suggestions");
      break;
  }
  return [...tags];
}

/**
 * A suggestion row. Its href is RELATIVE to `/w/<ws>/` (a SuggestionView carries no workspace); the inbox route
 * absolutizes it.
 */
export function suggestionItem(s: SuggestionView): InboxItem {
  return {
    kind: "suggestion",
    id: s.id,
    title: s.section,
    state: s.reason,
    tags: ["suggestions"],
    anchor: { section: s.section },
    cost: {
      usd: s.estimate.apiUsd,
      tokens: s.estimate.inTokens + s.estimate.cacheReadTokens + s.estimate.cacheWriteTokens + s.estimate.outTokens,
      estimated: true,
    },
    updatedAt: s.createdAt,
    href: `gen?sg=${encodeURIComponent(s.id)}`,
  };
}
