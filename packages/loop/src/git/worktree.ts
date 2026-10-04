// Job worktrees of the side repo (spec §7.3, ADR-0006 R1-6: created lazily — only agent mode and trusted
// typecheck / test gates need one): `~/.mitori/wt/<ws>/<job>`, detached, `read-tree` + `checkout-index` (no hooks,
// no LFS smudge), skip-worktree for huge repos, read-only dependency links. Removal and prune happen ONLY inside
// side.git — never a `git worktree prune` in the user's repository (SEC-08).
import { GIT_REFS, type GitOid, type JobId, MitoriError, type RepoPath } from "@mitori/core";
import { GIT_LIMITS } from "../contract.ts";
import { nfc, splitZ } from "./exec.ts";
import type { GitWorkspace } from "./side.ts";
import { jobCommits } from "./tree.ts";

/** Dependency directories linked into a worktree (read-only use; spec §7.3). */
const DEPENDENCY_DIRS = ["node_modules", ".venv", "venv"] as const;

/** Absolute worktree path of a job. */
export function worktreeOf(g: GitWorkspace, job: JobId): string {
  return `${g.wtDir}/${job}`;
}

/** Path of `abs` relative to home (refusing anything outside `~/.mitori/wt/<ws>/`). */
function homeRel(g: GitWorkspace, abs: string): string {
  const prefix = `${g.wtDir}/`;
  if (!abs.startsWith(prefix) || abs.includes("/../") || abs.endsWith("/.."))
    throw new MitoriError("E_PATH_OUTSIDE", "not a job worktree", { params: { path: abs } });
  return abs.slice(g.deps.home.length + 1);
}

const dec = new TextDecoder();

/** Lexical normalization of a repo-relative path; null when it climbs above the root. */
function normalizeRel(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

/**
 * Tracked symlinks whose target leaves the worktree (F1 remainder, cr-requests/agent.md): absolute targets, relative
 * ones that climb above the root, targets inside `.git`, and links that reach such a target through other tracked
 * links (`a -> b`, `b -> /etc`). The agent's Read / Grep follow symlinks; a repo (or a prompt-injected earlier job)
 * with `config -> ~/.aws/credentials` would hand the file to the model. Pure over `targets` (path → link text).
 */
export function escapingSymlinks(targets: ReadonlyMap<RepoPath, string>): RepoPath[] {
  const verdict = new Map<RepoPath, boolean>();
  const escapes = (link: RepoPath, seen: Set<string>): boolean => {
    const known = verdict.get(link);
    if (known !== undefined) return known;
    if (seen.has(link) || seen.size > 40) return true; // a loop or a chain too long to follow: never materialize
    seen.add(link);
    const target = targets.get(link) as string;
    let out = target.startsWith("/");
    if (!out) {
      const dir = link.includes("/") ? link.slice(0, link.lastIndexOf("/")) : "";
      const joined = normalizeRel(dir === "" ? target : `${dir}/${target}`);
      if (joined === null || joined === ".git" || joined.startsWith(".git/")) out = true;
      else {
        // every prefix of the resolved path that is itself a tracked link is followed
        const parts = joined.split("/");
        for (let i = 1; i <= parts.length && !out; i++) {
          const prefix = parts.slice(0, i).join("/") as RepoPath;
          if (targets.has(prefix) && prefix !== link) out = escapes(prefix, seen);
        }
      }
    }
    verdict.set(link, out);
    return out;
  };
  return [...targets.keys()].filter((l) => escapes(l, new Set())).sort();
}

/** Tracked symlinks of a worktree's index with their link text. */
export async function trackedSymlinks(g: GitWorkspace, wt: string): Promise<Map<RepoPath, string>> {
  const out = new Map<RepoPath, string>();
  for (const e of splitZ((await g.inWorktree(wt, ["ls-files", "-s", "-z"])).out)) {
    const m = /^120000 ([0-9a-f]{40,64}) \d\t(.+)$/s.exec(e);
    if (m) out.set(nfc(m[2] as string) as RepoPath, dec.decode(await g.blob(m[1] as GitOid)));
  }
  return out;
}

/** `git worktree add --detach --no-checkout` + read-tree + checkout-index (+ skip-worktree outside `partial`). */
async function addWorktree(g: GitWorkspace, job: JobId, commit: GitOid, partial?: readonly RepoPath[]): Promise<string> {
  await g.ready();
  const wt = worktreeOf(g, job);
  if (g.deps.fs.stat(wt)) await removeWorktree(g, job);
  await g.side(["worktree", "add", "--detach", "--no-checkout", wt, commit]);
  await g.inWorktree(wt, ["read-tree", commit]);
  const skip = new Set<RepoPath>();
  if (partial) {
    const keep = new Set(partial);
    for (const p of splitZ((await g.inWorktree(wt, ["ls-files", "-z"])).out).map(nfc)) if (!keep.has(p)) skip.add(p as RepoPath);
  }
  // a tracked symlink that leaves the worktree is never materialized: skip-worktree keeps its index entry (the head
  // commit records it unchanged) while `checkout-index -a` does not create it, so nothing can Read through it
  for (const p of escapingSymlinks(await trackedSymlinks(g, wt))) skip.add(p);
  if (skip.size > 0) await g.inWorktree(wt, ["update-index", "--skip-worktree", "-z", "--stdin"], { input: `${[...skip].join("\0")}\0` });
  await g.inWorktree(wt, ["checkout-index", "-a", "-q"]);
  return wt;
}

/**
 * Read-only links to the user's dependency directories (root `node_modules` / `.venv` / `venv`, and the
 * `node_modules` of `package.json` workspaces up to depth 2). Created by git itself (`checkout-index` of a symlink
 * entry from a throwaway index), so no symlink-capable write port is needed; excluded from every head commit.
 */
export async function linkDependencies(g: GitWorkspace, wt: string): Promise<RepoPath[]> {
  const candidates = new Set<RepoPath>(DEPENDENCY_DIRS);
  const pkg = g.deps.fs.stat(`${g.root}/package.json`)?.isFile ? new TextDecoder().decode(await g.deps.fs.read(`${g.root}/package.json`)) : null;
  if (pkg) {
    try {
      const ws = (JSON.parse(pkg) as { workspaces?: string[] | { packages?: string[] } }).workspaces;
      const globs = Array.isArray(ws) ? ws : (ws?.packages ?? []);
      for (const glob of globs) {
        const parts = glob.replace(/\/+$/, "").split("/");
        if (parts.length > 2 || parts.some((p) => p === ".." || p === "")) continue;
        const dirs =
          parts[parts.length - 1] === "*"
            ? (g.deps.fs.readdir(`${g.root}/${parts.slice(0, -1).join("/")}`) ?? []).map((d) => [...parts.slice(0, -1), d].join("/"))
            : [parts.join("/")];
        for (const d of dirs) candidates.add(`${d}/node_modules`);
      }
    } catch {
      // not JSON: no workspaces
    }
  }
  const links = [...candidates].filter((p) => g.deps.fs.stat(`${g.root}/${p}`)?.isDir === true && !g.deps.fs.stat(`${wt}/${p}`)).sort();
  if (links.length === 0) return [];
  const entries = await Promise.all(links.map(async (p) => ({ path: p, oid: await g.hashText(`${g.root}/${p}`), mode: "120000" })));
  await g.withIndex(null, async (indexFile) => {
    await g.side(["update-index", "--add", "-z", "--index-info"], { indexFile, input: entries.map((e) => `${e.mode} ${e.oid}\t${e.path}\0`).join("") });
    await g.side(["checkout-index", "-f", "-z", "--stdin"], { indexFile, cwd: wt, workTree: wt, input: `${links.join("\0")}\0` });
  });
  return links;
}

/**
 * Remove the dependency links again (F1 remainder): a link is the user's real `node_modules` / `.venv`, and through
 * it `node_modules/../.env` is the user's untracked `.env` — the agent's Read must not have it during a turn. `git
 * clean` without `-d` unlinks a symlink and never descends into or removes a real directory; each path is checked to
 * be a symlink first.
 */
export async function unlinkDependencies(g: GitWorkspace, wt: string, links: readonly RepoPath[]): Promise<void> {
  const present = links.filter((p) => g.deps.fs.stat(`${wt}/${p}`)?.isSymlink === true);
  if (present.length === 0) return;
  await g.inWorktree(wt, ["clean", "-f", "-x", "-q", "--", ...present.map((p) => `:(literal)${p}`)]);
}

/** `GitSafety.createWorktree`. */
export async function createWorktree(
  g: GitWorkspace,
  job: JobId,
  base: GitOid,
  opts: { partial?: RepoPath[]; dependencyLinks: boolean },
): Promise<{ path: string; links: RepoPath[] }> {
  const tracked = opts.partial === undefined ? null : opts.partial;
  const path = await addWorktree(g, job, base, tracked ?? undefined);
  await g.updateRef(GIT_REFS.jobBase(job), base);
  const links = opts.dependencyLinks ? await linkDependencies(g, path) : [];
  return { path, links };
}

/** `GitSafety.restoreWorktree`: a removed worktree back at the job head (base ref unchanged). */
export async function restoreWorktree(g: GitWorkspace, job: JobId): Promise<string> {
  const { head } = await jobCommits(g, job);
  return addWorktree(g, job, head);
}

/** `GitSafety.removeWorktree`: `worktree remove --force` + `worktree prune`, both in side.git only. */
export async function removeWorktree(g: GitWorkspace, job: JobId): Promise<void> {
  await g.ready();
  const wt = worktreeOf(g, job);
  await g.side(["worktree", "remove", "--force", "--force", wt], { ok: [0, 128] });
  if (g.deps.fs.stat(wt)) await g.deps.safeWrite.remove(g.deps.home, homeRel(g, wt), "home");
  await g.side(["worktree", "prune"]);
}

/** `GitSafety.writeFiles`: all files or none (previous contents restored on a failure). */
export async function writeFiles(g: GitWorkspace, worktree: string, files: Record<RepoPath, string>): Promise<void> {
  const rel = homeRel(g, worktree);
  const done: { path: RepoPath; before: Uint8Array | null }[] = [];
  try {
    for (const [path, text] of Object.entries(files)) {
      const abs = `${worktree}/${path}`;
      const before = g.deps.fs.stat(abs)?.isFile ? await g.deps.fs.read(abs) : null;
      await g.deps.safeWrite.write(g.deps.home, `${rel}/${path}`, text, "home");
      done.push({ path, before });
    }
  } catch (e) {
    for (const d of done.reverse()) {
      if (d.before) await g.deps.safeWrite.write(g.deps.home, `${rel}/${d.path}`, d.before, "home").catch(() => {});
      else await g.deps.safeWrite.remove(g.deps.home, `${rel}/${d.path}`, "home").catch(() => {});
    }
    throw e;
  }
}

/** `GitSafety.commitHead`: the worktree state (minus dependency links) as `refs/mitori/j/<job>/head`. */
export async function commitHead(g: GitWorkspace, job: JobId, worktree: string, attempt: number, links: readonly RepoPath[] = []): Promise<GitOid> {
  const { base } = await jobCommits(g, job);
  // a neutralized symlink keeps its base entry: absent from the worktree is not "deleted by the agent"
  const kept = [...new Set([...links, ...escapingSymlinks(await trackedSymlinks(g, worktree))])];
  const pathspec = [".", ...kept.map((l) => `:(exclude,literal)${l}`)];
  await g.inWorktree(worktree, ["add", "-A", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: `${pathspec.join("\0")}\0` });
  const tree = (await g.inWorktree(worktree, ["write-tree"])).out.trim();
  const head = await g.commitTree(tree, [base], `mitori job ${job} attempt ${attempt}\n`);
  await g.updateRef(GIT_REFS.jobHead(job), head);
  return head;
}

/** Job worktrees registered in side.git (absolute paths under `~/.mitori/wt/<ws>/`). */
export async function listWorktrees(g: GitWorkspace): Promise<string[]> {
  const r = await g.side(["worktree", "list", "--porcelain", "-z"]);
  return splitZ(r.out)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => p.startsWith(`${g.wtDir}/`));
}

/** Limit of ready-job worktrees per workspace (oldest removed first by the runner). */
export const MAX_WORKTREES = GIT_LIMITS.maxWorktreesPerWs;
