// The base side of the comparison: a throw-away worktree of the merge base with its own `bun install --frozen-lockfile`
// (§6.7) — workspace links must point at the base's packages, so node_modules cannot be shared with head.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, args: readonly string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

/** `git merge-base HEAD origin/main` → `main` → `HEAD~1`; throws when nothing resolves. */
export function defaultBase(repo: string): string {
  for (const upstream of ["origin/main", "main"]) {
    const r = git(repo, ["merge-base", "HEAD", upstream]);
    if (r.ok && r.out) return r.out;
  }
  const prev = git(repo, ["rev-parse", "HEAD~1"]);
  if (prev.ok && prev.out) return prev.out;
  throw new Error("cannot find a base: no origin/main, no main and no parent commit (pass --base <ref> or --base-root <dir>)");
}

export function resolveRef(repo: string, ref: string): string {
  const r = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (!r.ok) throw new Error(`unknown base ref "${ref}": ${r.err}`);
  return r.out;
}

export interface BaseTree {
  root: string;
  sha: string;
  cleanup(): void;
}

/** Check out `ref` into a new detached worktree and run `setup` (default `bun install --frozen-lockfile`) in it. */
export function prepareBase(repo: string, ref: string, setup: string | null = "bun install --frozen-lockfile"): BaseTree {
  const sha = resolveRef(repo, ref);
  const root = join(mkdtempSync(join(tmpdir(), "mitori-base-")), "tree");
  const add = git(repo, ["worktree", "add", "--detach", root, sha]);
  if (!add.ok) throw new Error(`git worktree add failed: ${add.err}`);
  const cleanup = () => {
    git(repo, ["worktree", "remove", "--force", root]);
    rmSync(join(root, ".."), { recursive: true, force: true });
    git(repo, ["worktree", "prune"]);
  };
  if (setup) {
    const r = spawnSync("sh", ["-c", setup], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      cleanup();
      throw new Error(`base setup \`${setup}\` failed:\n${r.stdout}${r.stderr}`);
    }
  }
  return { root, sha, cleanup };
}
