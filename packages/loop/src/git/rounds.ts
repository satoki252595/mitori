// F8 (nonfunc audit): the Pull plane (⤴ your own session, `mitori review`) had no scope and no Undo — the user's
// agent writes the working tree directly, so a change outside the threads' write scope went unseen and a round could
// not be taken back. Now a pull round remembers the snapshot of the working tree it was dispatched on
// (`refs/mitori/round/<n>/base`, side repo only); `roundChanges` diffs that against the tree now, and `undoRound`
// puts every file the round changed back to its pre-round content through the ordinary accept (uncommitted, one
// checkpoint, divergence-checked) — so the Undo is itself undoable from the checkpoint list.
import { GIT_REFS, type GitOid, type Glob, type JobId, MitoriError, type RepoPath } from "@mitori/core";
import type { AcceptEngine, AcceptOutcome } from "./accept.ts";
import type { GitWorkspace, RawChange } from "./side.ts";
import type { Snapshotter } from "./snapshot.ts";

/** Ref of a pull round's base snapshot. */
export const roundRef = (n: number): string => `refs/mitori/round/${n}/base`;
/** Pseudo job of a round's Undo (refs `refs/mitori/j/<id>/base|head`, collected by gc like a job's after 30 days). */
export const roundJob = (n: number): JobId => `j_round${n.toString(36)}` as JobId;
/** `refs/mitori/round/<n>/base`. */
export const ROUND_REF_RE = /^refs\/mitori\/round\/(\d+)\/base$/;

/** Remember `base` (a snapshot taken right before the round was dispatched) for round `n`. */
export async function markRound(g: GitWorkspace, n: number, base: GitOid): Promise<void> {
  await g.ready();
  await g.updateRef(roundRef(n), base);
}

/** What changed in the working tree since round `n` was dispatched (null: the round has no base). */
export async function roundChanges(
  g: GitWorkspace,
  snap: Snapshotter,
  n: number,
  deny: Glob[],
): Promise<{ base: GitOid; now: GitOid; changes: RawChange[] } | null> {
  await g.ready();
  const base = await g.rev(roundRef(n));
  if (!base) return null;
  const now = (await snap.snapshot(deny, { reuse: false })).commit;
  return { base, now, changes: await g.rawDiff(base, now) };
}

/** Put every file round `n` changed back to its pre-round content (an accept of the reverse change). */
export async function undoRound(g: GitWorkspace, snap: Snapshotter, engine: AcceptEngine, n: number, deny: Glob[]): Promise<AcceptOutcome> {
  const r = await roundChanges(g, snap, n, deny);
  if (!r)
    throw new MitoriError("E_NOT_FOUND", `round ${n} has no recorded base (not a pull round, or dispatched before this version)`, { params: { round: n } });
  if (r.changes.length === 0)
    throw new MitoriError("E_PRECONDITION", `round ${n} changed nothing in the working tree`, { params: { round: n, reason: "nothing_to_undo" } });
  const job = roundJob(n);
  const tree = await g.treeWith(
    r.now,
    r.changes.map((c) => ({ path: c.path, oid: c.oldOid, mode: c.oldMode })),
  );
  const head = await g.commitTree(tree, [r.now], `mitori undo of review round ${n}\n`);
  await g.updateRef(GIT_REFS.jobBase(job), r.now);
  await g.updateRef(GIT_REFS.jobHead(job), head);
  return engine.accept(job, { accept: "all" }, { autoCommit: null, writeScope: r.changes.map((c) => c.path) as RepoPath[] });
}
