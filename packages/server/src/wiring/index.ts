/**
 * @mitori/server — `wiring/` (owner: WP-INT). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */

import { AGENT_MIGRATIONS } from "@mitori/agent";
import type { AnchoredItem, ReanchorReport } from "@mitori/anchor";
import type { AnchorHealth, Cite, ClaimChecks, ClaimId, CodeAnchor, IndexDelta, Migration, ThreadId } from "@mitori/core";
import { DOC_MIGRATIONS, type DocStore } from "@mitori/doc";
import { GEN_MIGRATIONS } from "@mitori/gen";
import { INDEXER_MIGRATIONS } from "@mitori/indexer";
import { LOOP_MIGRATIONS, type ThreadReanchorUpdate } from "@mitori/loop";
import { MIGRATION_ORDER } from "../contract.ts";
import { SERVER_STATE_MIGRATIONS, SERVER_WORKSPACE_MIGRATIONS } from "../http/schema.ts";

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const codeOf = (c: Cite): CodeAnchor => {
  const a: CodeAnchor = { path: c.path, start: c.start, end: c.end, blob: c.blob, snippet: c.snippet };
  if (c.symbol !== undefined) a.symbol = c.symbol;
  return a;
};

/**
 * Build the re-anchoring input for one delta (§4.3): every claim cite whose path is in `delta.changed`/`renames`
 * (`kind: "cite"`, in claim-id then cite-index order) followed by every non-resolved thread whose code member's
 * path changed (`kind: "thread"`, thread-id order). Doc-primary threads contribute their code member only when it
 * was captured explicitly; otherwise they follow their claim. Pure given the stores.
 *
 * A claim with at least one changed cite contributes ALL its cites (the unchanged ones re-anchor by identity), so
 * {@link distributeReanchor} can hand `DocStore.setClaimChecks` complete cite arrays (`cites` replaces the cites).
 */
export function assembleAnchoredItems(
  delta: IndexDelta,
  doc: Pick<DocStore, "index">,
  threads: readonly { id: ThreadId; code?: Cite | null }[],
): AnchoredItem[] {
  const paths = new Set<string>();
  for (const c of delta.changed) paths.add(c.path);
  for (const r of delta.renames) {
    paths.add(r.from);
    paths.add(r.to);
  }
  if (paths.size === 0) return [];
  const out: AnchoredItem[] = [];
  const claims = doc.index().claims;
  for (const id of Object.keys(claims).sort(byStr) as ClaimId[]) {
    const claim = claims[id];
    if (claim === undefined || !claim.cites.some((c) => paths.has(c.path))) continue;
    claim.cites.forEach((cite, index) => {
      out.push({ kind: "cite", owner: id, index, cite });
    });
  }
  for (const t of [...threads].sort((a, b) => byStr(a.id, b.id)))
    if (t.code && paths.has(t.code.path)) out.push({ kind: "thread", owner: t.id, anchor: codeOf(t.code) });
  return out;
}

/**
 * Distribute a report back (same order as the items) [§4.3]. Pure. The outputs are partial by design [CR m1-6]: the
 * `own`-slot step merges them with the fresh stored state (claim l1 kept, `checkedAt` = now; thread anchor = the
 * stored anchor with the new code member).
 */
export function distributeReanchor(
  items: readonly AnchoredItem[],
  report: ReanchorReport,
): {
  /** Claim updates for `DocStore.setClaimChecks` (moved cites re-rendered; overlapped ⇒ verdict `stale`). */
  claims: { id: ClaimId; cites: Cite[]; checks: Pick<ClaimChecks, "l0" | "l2">; stale: boolean }[];
  /** Thread updates for `ReviewEngine.applyReanchor`. */
  threads: ThreadReanchorUpdate[];
  /** Counts by health (metrics, `mitori doctor`). */
  counts: Record<AnchorHealth, number>;
} {
  const counts: Record<AnchorHealth, number> = { ok: 0, moved: 0, fuzzy: 0, outdated: 0 };
  const byClaim = new Map<ClaimId, { cites: Cite[]; stale: boolean; lost: boolean }>();
  const threads: ThreadReanchorUpdate[] = [];
  items.forEach((item, i) => {
    const r = report.results[i];
    if (r === undefined) return;
    counts[r.result.health] += 1;
    const lost = r.result.health === "outdated";
    if (item.kind === "cite") {
      const c = byClaim.get(item.owner) ?? { cites: [], stale: false, lost: false };
      c.cites[item.index] = lost ? item.cite : { ...item.cite, ...(r.result.anchor as Cite) };
      c.stale ||= r.overlapped || lost;
      c.lost ||= lost;
      byClaim.set(item.owner, c);
    } else {
      // CR m1-6: only the code member is known here; the slot step merges it into the stored anchor.
      threads.push({
        thread: item.owner,
        anchor: { primary: "code", code: (lost ? item.anchor : r.result.anchor) as CodeAnchor },
        health: r.result.health,
        method: r.result.method,
        overlapped: r.overlapped,
        blockRewritten: false,
      });
    }
  });
  const claims = [...byClaim]
    .sort((a, b) => byStr(a[0], b[0]))
    .map(([id, c]) => ({
      id,
      cites: c.cites.filter((x): x is Cite => x !== undefined),
      checks: { l0: !c.lost, l2: !c.stale },
      stale: c.stale,
    }));
  return { claims, threads, counts };
}

const ALL_MIGRATIONS: readonly Migration[] = [
  ...SERVER_STATE_MIGRATIONS,
  ...SERVER_WORKSPACE_MIGRATIONS,
  ...AGENT_MIGRATIONS,
  ...INDEXER_MIGRATIONS,
  ...DOC_MIGRATIONS,
  ...GEN_MIGRATIONS,
  ...LOOP_MIGRATIONS,
];

/**
 * Every package's migrations for one database, concatenated in `MIGRATION_ORDER[db]` order (package order, then
 * `version`) [CR m0-14]. The daemon applies `migrationsFor("state")` at start (server spec §1.1 (d)) and the
 * WorkspaceManager `migrationsFor("workspace")` on load (§3.2); `@mitori/cli` cannot collect them itself
 * (PACKAGE_DEPS). Pure.
 */
export function migrationsFor(db: Migration["db"]): readonly Migration[] {
  const order: readonly string[] = MIGRATION_ORDER[db];
  return ALL_MIGRATIONS.filter((m) => m.db === db && order.includes(m.pkg)).sort(
    (a, b) => order.indexOf(a.pkg) - order.indexOf(b.pkg) || a.version - b.version,
  );
}
