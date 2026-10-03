/**
 * `server.publishSuggestions` (DOMAIN_WIRING index.delta / job.accepted / round.completed / gen.incremental): gen's
 * S9 suggestions become the workspace's current `SuggestionView[]` (replaced as a whole) and SSE `gen.suggestions`.
 * Also the claim half of the one reanchor pass in the shape `gen.onIndexDelta` takes (`ClaimReanchor`).
 */
import type { AnchoredItem, ReanchorReport } from "@mitori/anchor";
import type { Cite, ClaimId, Iso8601, RepoPath, SuggestionView } from "@mitori/core";
import type { ClaimReanchor, IncrementalSuggestion } from "@mitori/gen";

/** Claims moved / overlapped / outdated by one report (an overlapped or outdated claim is not "moved"). */
export function claimReanchor(items: readonly AnchoredItem[], report: ReanchorReport): ClaimReanchor {
  const per = new Map<ClaimId, { cites: Cite[]; moved: boolean; overlapped: boolean; outdated: boolean }>();
  items.forEach((it, i) => {
    const r = report.results[i];
    if (it.kind !== "cite" || r === undefined) return;
    const c = per.get(it.owner) ?? { cites: [], moved: false, overlapped: false, outdated: false };
    c.cites[it.index] = r.result.health === "outdated" ? it.cite : { ...it.cite, ...(r.result.anchor as Cite) };
    c.moved ||= r.result.health === "moved";
    c.overlapped ||= r.overlapped;
    c.outdated ||= r.result.health === "outdated";
    per.set(it.owner, c);
  });
  const out: ClaimReanchor = { moved: [], overlapped: [], outdated: [] };
  for (const [claim, c] of [...per].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (c.outdated) out.outdated.push(claim);
    else if (c.overlapped) out.overlapped.push(claim);
    else if (c.moved) out.moved.push({ claim, cites: c.cites.filter((x): x is Cite => x !== undefined) });
  }
  return out;
}

/** Wire views of gen's suggestions (`files` = the paths of the delta that produced them). */
export function suggestionViews(list: readonly IncrementalSuggestion[], files: readonly RepoPath[], at: Iso8601): SuggestionView[] {
  return list.map((s) => ({
    id: s.id,
    section: s.section,
    reason: s.reason,
    kind: s.kind,
    blocks: [...s.blocks],
    files: [...files],
    estimate: s.estimate,
    createdAt: at,
  }));
}
