// `GitSafety` (ADR-0006 R1 + ADR-0012) composed from the side repo context, the snapshotter, the job-tree helpers,
// the accept engine and the journal. Beyond the contract interface the job runner uses a few internals
// (`GitSafetyHandle`): the accept outcome with its overlap hunks, commits in the user's repository with trailers,
// SEC-18 attribute checks, and the per-job worktree / link bookkeeping.
import type { AcceptReq, CheckpointId, FileDiff, GitOid, Glob, JobId, RepoPath, SecretScanner, SqlDb, WriteQueue } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import type { GitSafety, ScopeReport } from "../contract.ts";
import { dependencyLinks } from "../gates/deps.ts";
import { AcceptEngine, type AcceptOutcome, type CommitRequest } from "./accept.ts";
import { gc } from "./gc.ts";
import { checkpointOf, Journal } from "./journal.ts";
import { checkScope } from "./scope.ts";
import { type GitDeps, GitWorkspace } from "./side.ts";
import { Snapshotter, unwritablePaths } from "./snapshot.ts";
import { buildTree, diffCommits, jobCommits, selectionCommit } from "./tree.ts";
import { commitHead, createWorktree, linkDependencies, removeWorktree, restoreWorktree, unlinkDependencies, worktreeOf, writeFiles } from "./worktree.ts";

/** Ports of {@link createGitSafety}. */
export interface GitSafetyDeps extends GitDeps {
  /** Workspace DB (`job_checkpoints`). */
  db: SqlDb;
  /** Workspace write queue. */
  write: WriteQueue;
  /** Secret scanner (untracked content, added lines, exported patches). */
  secrets: SecretScanner;
  /** Deny globs in effect (`EffectiveSettings.denyGlobs`). */
  deny: () => Glob[];
}

/** The contract surface plus what the job runner needs. */
export interface GitSafetyHandle extends GitSafety {
  /** The side repo context. */
  readonly ws: GitWorkspace;
  /** The journal. */
  readonly journal: Journal;
  /** Accept with the full outcome (overlap hunks, `full`). */
  acceptFull(job: JobId, sel: AcceptReq, opts: { autoCommit: CommitRequest | null; writeScope: RepoPath[] }): Promise<AcceptOutcome>;
  /** `.patch` export with the job's message and trailers. */
  exportPatchWith(job: JobId, sel: AcceptReq, req: CommitRequest): Promise<string>;
  /** `git commit --only` in the user's repository (user hooks run); null when a hook refused. */
  commitPaths(paths: readonly RepoPath[], req: CommitRequest, added?: readonly RepoPath[]): Promise<GitOid | null>;
  /** H′ of a selection (`all` ⇒ head) and whether it equals the head. */
  selection(job: JobId, accept: AcceptReq["accept"]): Promise<{ commit: GitOid; full: boolean }>;
  /** Diff between two commits. */
  diffCommits(from: GitOid, to: GitOid): Promise<FileDiff[]>;
  /** Base / head commits of a job. */
  commits(job: JobId): Promise<{ base: GitOid; head: GitOid }>;
  /** Write-scope paths git treats specially (filter / working-tree-encoding attribute, LFS pointer) [SEC-18]. */
  unwritable(paths: readonly RepoPath[], blobOf: (p: RepoPath) => GitOid | null): Promise<RepoPath[]>;
  /** Command-bearing local config: its trust hash (null when none) [SEC-05, GIT-S-05]. */
  configTrust(): Promise<{ hash: string | null; keys: string[] }>;
  /** Text of a blob of the side repo (or the user's object DB through alternates). */
  blobText(oid: GitOid): Promise<string>;
  /** Close the persistent blob reader. */
  close(): Promise<void>;
}

/** Build the git safety of one workspace. */
export function createGitSafety(deps: GitSafetyDeps): GitSafetyHandle {
  const ws = new GitWorkspace(deps);
  const journal = new Journal(deps.db, deps.write, deps.clock);
  const snapshots = new Snapshotter(ws, deps.secrets);
  const engine = new AcceptEngine(ws, snapshots, journal, deps.deny);
  const links = new Map<JobId, RepoPath[]>();
  const defaultMessage = (job: JobId): CommitRequest => ({ message: `mitori job ${job}\n`, trailers: {} });

  return {
    ws,
    journal,
    snapshot: (deny) => snapshots.snapshot(deny),
    buildTree: (job, base, files) => buildTree(ws, job, base, files),
    async createWorktree(job, base, opts) {
      const out = await createWorktree(ws, job, base, opts);
      links.set(job, out.links);
      return out;
    },
    restoreWorktree: (job) => restoreWorktree(ws, job),
    async removeWorktree(job) {
      links.delete(job);
      await removeWorktree(ws, job);
    },
    async linkDependencies(job) {
      const wt = worktreeOf(ws, job);
      const made = await linkDependencies(ws, wt);
      // links made earlier and still there stay excluded from the head commit too
      const all = [...new Set([...(links.get(job) ?? []), ...made])].sort();
      links.set(job, all);
      return all;
    },
    async unlinkDependencies(job) {
      const wt = worktreeOf(ws, job);
      if (!deps.fs.stat(wt)?.isDir) return;
      // the remembered links, and whatever a restart forgot: every dependency-named symlink of the tree
      await unlinkDependencies(ws, wt, [...new Set([...(links.get(job) ?? []), ...dependencyLinks(deps.fs, wt)])]);
    },
    writeFiles: (worktree, files) => writeFiles(ws, worktree, files),
    commitHead: (job, worktree, attempt) => commitHead(ws, job, worktree, attempt, links.get(job) ?? []),
    async diff(job) {
      const { base, head } = await jobCommits(ws, job);
      return diffCommits(ws, base, head);
    },
    checkScope(job, writeScope, deny): Promise<ScopeReport> {
      const wt = worktreeOf(ws, job);
      return checkScope(ws, deps.secrets, job, writeScope, deny, deps.fs.stat(wt)?.isDir ? wt : null);
    },
    precheck: (job, sel) => engine.precheck(job, sel),
    async accept(job, sel, opts) {
      const out = await engine.accept(job, sel, opts);
      return { checkpoint: out.checkpoint, files: out.files };
    },
    acceptFull: (job, sel, opts) => engine.accept(job, sel, opts),
    undo: (ck: CheckpointId, force) => engine.undo(ck, force),
    exportPatch: (job, sel) => engine.exportPatch(job, sel, defaultMessage(job), deps.secrets),
    exportPatchWith: (job, sel, req) => engine.exportPatch(job, sel, req, deps.secrets),
    async createPullRequest(job) {
      // GitHub PRs are an explicit user action of WP-08c (spec §7.13, SEC-04)
      throw new MitoriError("E_UNSUPPORTED", "pull requests arrive with WP-08c", { params: { job, what: "git.createPullRequest" } });
    },
    gc: (activeJobs) => gc(ws, journal, activeJobs, { now: deps.clock.now() }),
    recoverAccept: (ck) => engine.recover(ck),
    commitPaths: (paths, req, added) => engine.commitPaths(paths, req, added),
    selection: (job, accept) => selectionCommit(ws, job, accept),
    diffCommits: (from, to) => diffCommits(ws, from, to),
    commits: (job) => jobCommits(ws, job),
    unwritable: (paths, blobOf) => unwritablePaths(ws, paths, blobOf),
    async configTrust() {
      await ws.ready();
      const c = await ws.config();
      return { hash: c.trustHash, keys: c.commands.map((e) => e.key) };
    },
    async blobText(oid) {
      await ws.ready();
      return ws.text(oid);
    },
    close: () => ws.close(),
  };
}

export { checkpointOf };
