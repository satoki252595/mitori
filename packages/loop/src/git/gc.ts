// Cleanup (spec §7.11, ADR-0012 5): job worktrees that belong to no active job, job refs 30 days after the job,
// checkpoints older than 30 days beyond the newest 20, and the temp dir — all inside `~/.mitori`. mitori never runs
// `git gc` / object pruning, and `worktree prune` only ever runs in side.git (SEC-08).
import { GIT_REFS, type JobId } from "@mitori/core";
import { GIT_LIMITS } from "../contract.ts";
import type { Journal } from "./journal.ts";
import type { GitWorkspace } from "./side.ts";
import { listWorktrees, removeWorktree } from "./worktree.ts";

const DAY_MS = 24 * 3600_000;
const JOB_REF_RE = /^refs\/mitori\/j\/(j_[0-9a-z]+)\/(?:base|head)$/;
const CK_REF_RE = /^refs\/mitori\/ck\/(ck_[0-9a-z]+)(?:-pre-force)?$/;

/** `GitSafety.gc`. `activeJobs` = jobs whose worktree / refs must stay (queued … ready, accepted with pending hunks). */
export async function gc(
  g: GitWorkspace,
  journal: Journal,
  activeJobs: readonly JobId[],
  opts: { now: number; inUseTemp?: ReadonlySet<string> },
): Promise<{ worktrees: number; refs: number }> {
  await g.ready();
  const active = new Set<string>(activeJobs);
  let worktrees = 0;
  for (const wt of await listWorktrees(g)) {
    const job = wt.slice(g.wtDir.length + 1) as JobId;
    if (active.has(job)) continue;
    await removeWorktree(g, job);
    worktrees++;
  }
  // stray directories under wt/<ws>/ that side.git no longer knows (a crash between add and register)
  for (const name of g.deps.fs.readdir(g.wtDir) ?? []) {
    if (active.has(name) || !/^j_[0-9a-z]+$/.test(name)) continue;
    await g.deps.safeWrite.remove(g.deps.home, `wt/${g.deps.ws.key}/${name}`, "home");
    worktrees++;
  }
  await g.side(["worktree", "prune"]);

  const cutoff = Math.floor((opts.now - GIT_LIMITS.refGcDays * DAY_MS) / 1000);
  const r = await g.side(["for-each-ref", "--format=%(refname)%00%(committerdate:unix)", "refs/mitori/"]);
  const drop: string[] = [];
  const keepCk = new Set(
    journal
      .done()
      .slice(0, GIT_LIMITS.keepCheckpoints)
      .map((c) => c.id as string),
  );
  for (const line of r.out.split("\n")) {
    const [ref = "", time = ""] = line.split("\0");
    if (ref === "") continue;
    const at = Number(time);
    const old = Number.isFinite(at) && at < cutoff;
    const j = JOB_REF_RE.exec(ref);
    if (j && old && !active.has(j[1] as string)) drop.push(ref);
    const c = CK_REF_RE.exec(ref);
    if (c && old && !keepCk.has(c[1] as string)) drop.push(ref);
  }
  await g.deleteRefs(drop);

  for (const name of g.deps.fs.readdir(`${g.deps.home}/${g.tmpRel}`) ?? []) {
    if (name === ".keep" || opts.inUseTemp?.has(name)) continue;
    if (/^(?:idx|patch|fmt)-[0-9a-f]{16}(?:\.lock)?$/.test(name) || /^j_[0-9a-z]+$/.test(name)) await g.dropTemp(`${g.tmpRel}/${name}`);
  }
  return { worktrees, refs: drop.length };
}

/** Refs of one job (used when a job's refs must go right away, e.g. a discarded retry). */
export function jobRefs(job: JobId): string[] {
  return [GIT_REFS.jobBase(job), GIT_REFS.jobHead(job)];
}
