// `GIT_LIMITS.maxWorktreesPerWs` (spec §7.3): a workspace keeps at most this many job worktrees. Check worktrees of
// ready patch jobs are created lazily (gates/job.ts `ensureWorktree`) and agent jobs keep theirs while ready, so a
// review session with many Fixes used to grow `~/.mitori/wt/<ws>/` without bound (cr-requests/agent.md #7). Before a
// new worktree is made, the least recently updated worktrees of jobs that are not running are removed; both owners
// re-create theirs on demand (`ensureWorktree` at the base, `jobWorktree` from the head ref), so nothing is lost.
import type { JobId, JobState } from "@mitori/core";
import { GIT_LIMITS } from "../contract.ts";
import { ACTIVE, type RunnerCore } from "./core.ts";

/** States whose worktree is in use (the pipeline or an accept works in it). */
const BUSY: ReadonlySet<JobState> = new Set<JobState>([...ACTIVE, "accepting"]);
/** Every state a job may keep a worktree in. */
const ALL: readonly JobState[] = [...ACTIVE, "ready", "accepting", "accepted", "partially_accepted", "rejected", "done", "failed", "cancelled", "reverted"];

/**
 * Make room for one more worktree (for `job`): remove the oldest idle job worktrees until fewer than `limit` remain.
 * Busy ones are never touched (the limit may then be exceeded by the jobs that run right now). Returns the evicted jobs.
 */
export async function makeWorktreeRoom(core: RunnerCore, job: JobId, limit: number = GIT_LIMITS.maxWorktreesPerWs): Promise<JobId[]> {
  const live = core.store
    .inStates(ALL)
    .filter((r) => r.job.id !== job && r.job.worktree && core.deps.fs.stat(r.job.worktree)?.isDir === true)
    .sort((a, b) => {
      // oldest first: a finished job by its end, a ready one by its start
      const at = (j: typeof a.job) => j.finishedAt ?? j.startedAt ?? j.createdAt;
      return at(a.job) < at(b.job) ? -1 : at(a.job) > at(b.job) ? 1 : a.job.id < b.job.id ? -1 : 1;
    });
  const evicted: JobId[] = [];
  let count = live.length;
  for (const r of live) {
    if (count < limit) break;
    if (BUSY.has(r.job.state)) continue;
    await core.deps.git.removeWorktree(r.job.id).catch((e: unknown) => core.deps.log.warn("worktree eviction failed", { job: r.job.id, error: String(e) }));
    await core.update(r.job.id, "job.worktree.evict", (x) => {
      delete x.job.worktree;
    });
    evicted.push(r.job.id);
    count--;
  }
  if (evicted.length > 0) core.deps.log.info("job worktrees evicted", { for: job, evicted: evicted.join(","), limit });
  return evicted;
}
