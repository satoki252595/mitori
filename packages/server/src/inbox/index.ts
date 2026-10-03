/**
 * @mitori/server — `inbox/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { InboxFilter, InboxItem } from "@mitori/core";
import type { InboxSources } from "../contract.ts";
import { suggestionItem, tagsOf } from "./tags.ts";

const KIND_ORDER: Record<InboxItem["kind"], number> = { thread: 0, job: 1, proposal: 2, trust: 3, gen_run: 4, suggestion: 5 };

/** Merge + filter + sort (`updatedAt` desc, then kind order thread < job < proposal < trust < gen_run < suggestion, then id). Pure. */
export function buildInbox(sources: InboxSources, filter: InboxFilter | null): InboxItem[] {
  const all = [...sources.loop, ...sources.proposals, ...sources.trust, ...sources.genRuns, ...sources.suggestions.map(suggestionItem)];
  const out: InboxItem[] = [];
  for (const item of all) {
    const tags = tagsOf(item);
    if (filter === null || filter === "all" || tags.includes(filter)) out.push({ ...item, tags });
  }
  return out.sort((a, b) => {
    const t = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (t !== 0 && !Number.isNaN(t)) return t;
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
