/**
 * Live Inbox rows from SSE (ux.md §4.6.2: the list is fetched once, then rows are added / replaced / removed from
 * `thread.upsert` · `job.upsert` · `doc.proposal.*` · `trust.request` — no refetch). The tags follow the server's
 * `buildInbox` rules (server spec §7.3) so a projected row sits in the same views as a fetched one; fields the
 * client cannot know (cost of a thread, the anchor line) are kept from the previous row. Pure.
 */
import {
  type DocProposalView,
  HREFS,
  type InboxFilter,
  type InboxItem,
  type JobState,
  type JobSummary,
  type SectionId,
  type ThreadSummary,
  type TrustRequest,
  type WorkspaceKey,
} from "@mitori/core";

const WORKING_JOB: ReadonlySet<JobState> = new Set(["queued", "waiting_lock", "preparing", "running", "gating", "repairing", "accepting"]);

export function threadTags(t: ThreadSummary): InboxFilter[] {
  const tags = new Set<InboxFilter>();
  if (t.state === "resolved") tags.add("resolved");
  else {
    if (["answered", "proposed", "needs_input", "failed"].includes(t.state) || t.stale || t.anchorHealth === "outdated") tags.add("mine");
    if (t.state === "queued" || t.state === "running") tags.add("working");
    if (t.state === "failed") tags.add("failed");
    if (t.anchorHealth === "outdated") tags.add("outdated");
    if (t.state === "draft" && t.preview.trim()) tags.add("draft");
  }
  return [...tags];
}

export function jobTags(j: JobSummary): InboxFilter[] {
  const tags = new Set<InboxFilter>();
  if (j.state === "ready") {
    tags.add("review");
    tags.add("mine");
  }
  if (WORKING_JOB.has(j.state)) tags.add("working");
  if (j.state === "failed") {
    tags.add("failed");
    tags.add("mine");
  }
  return [...tags];
}

/** Rows that disappear from every view when their tags are empty (finished jobs live on in their thread row). */
const keep = (it: InboxItem) => it.tags.length > 0 || it.kind === "thread";

export function projectThread(prev: InboxItem | undefined, t: ThreadSummary, ws: WorkspaceKey, section: SectionId | undefined): InboxItem {
  const block = t.anchor.doc?.block;
  const code = t.anchor.code;
  return {
    kind: "thread",
    id: t.id,
    title: t.title || t.preview.slice(0, 60),
    state: t.state,
    displayState: t.anchorHealth === "outdated" ? "outdated" : t.state,
    tags: threadTags(t),
    intent: t.intent,
    anchor: prev?.anchor ?? {
      ...(section ? { section } : {}),
      ...(code ? { path: code.path, line: code.start } : {}),
    },
    ...(prev?.cost ? { cost: prev.cost } : {}),
    thread: t.id,
    ...(prev?.job ? { job: prev.job } : {}),
    updatedAt: t.updatedAt,
    href: prev?.href ?? (section && block ? HREFS.doc(ws, section, block) : HREFS.thread(ws, t.id)),
  };
}

export function projectJob(
  prev: InboxItem | undefined,
  j: JobSummary,
  ws: WorkspaceKey,
  title: string,
  intent: ThreadSummary["intent"] | undefined,
): InboxItem {
  const usage = j.usage;
  return {
    kind: "job",
    id: j.id,
    title: prev?.title ?? title,
    state: j.state,
    displayState: j.state,
    tags: jobTags(j),
    ...(intent ? { intent } : prev?.intent ? { intent: prev.intent } : {}),
    ...(prev?.anchor ? { anchor: prev.anchor } : {}),
    cost: usage
      ? { usd: usage.apiUsd, tokens: usage.in + usage.cacheRead + usage.cacheWrite + usage.out, estimated: false }
      : {
          usd: j.estimate.apiUsd,
          tokens: j.estimate.inTokens + j.estimate.cacheReadTokens + j.estimate.cacheWriteTokens + j.estimate.outTokens,
          estimated: true,
        },
    ...(j.threads[0] ? { thread: j.threads[0] } : {}),
    job: j.id,
    updatedAt: j.finishedAt ?? j.startedAt ?? j.createdAt,
    href: prev?.href ?? HREFS.review(ws, j.id),
  };
}

export function projectProposal(prev: InboxItem | undefined, p: DocProposalView, ws: WorkspaceKey): InboxItem {
  return {
    kind: "proposal",
    id: p.id,
    title: prev?.title ?? p.reason,
    state: p.state,
    tags: p.state === "pending" ? ["mine", "proposals"] : [],
    anchor: { section: p.section },
    updatedAt: prev?.updatedAt ?? p.createdAt,
    href: prev?.href ?? HREFS.doc(ws, p.section, p.block ?? undefined),
  };
}

export function projectTrust(prev: InboxItem | undefined, r: TrustRequest, at: string): InboxItem {
  return {
    kind: "trust",
    id: r.id,
    title: prev?.title ?? r.item,
    state: r.status,
    tags: r.status === "pending" ? ["mine", "trust"] : [],
    updatedAt: prev?.updatedAt ?? at,
    href: prev?.href ?? "",
  };
}

/** Replace / insert / drop one row (by kind + id) — a new list for the `$state.raw` store. */
export function upsertRow(items: readonly InboxItem[], next: InboxItem): InboxItem[] {
  const i = items.findIndex((x) => x.id === next.id && x.kind === next.kind);
  if (!keep(next)) return i < 0 ? [...items] : items.filter((_, j) => j !== i);
  if (i < 0) return [next, ...items];
  return items.map((x, j) => (j === i ? next : x));
}

export function removeRow(items: readonly InboxItem[], id: string): InboxItem[] {
  return items.filter((x) => x.id !== id);
}
