// A real git world for the git-safety tests: a fixture repo (testkit `buildFixture`), an isolated MITORI_HOME and
// HOME (its own ~/.gitconfig: identity, optionally a hostile `diff.external`), the production platform adapters
// (Spawner, FsReader, SafeWriter, Hasher, cat-file reader) and an in-memory workspace DB with the loop migrations.
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretScanner, DEFAULT_DENY_GLOBS, type Glob, type Sha256, type WorkspaceInfo, type WriteQueue } from "@mitori/core";
import { createFsReader, createGitReader, createHasher, createSafeWriter, createSpawner, systemClock } from "@mitori/platform";
import { createTestLogger, memDb } from "@mitori/platform/testing";
import { buildFixture, type FixtureName, type FixtureRepo } from "@mitori/testkit/fixtures";
import { createTestHome, type TestHome } from "@mitori/testkit/home";
import { LOOP_MIGRATIONS } from "../../review/index.ts";
import { createGitSafety, type GitSafetyDeps, type GitSafetyHandle } from "../safety.ts";

/** A fresh world. */
export interface GitWorld {
  repo: FixtureRepo;
  home: TestHome;
  /** HOME of git children (its .gitconfig). */
  userHome: string;
  deps: GitSafetyDeps;
  git: GitSafetyHandle;
  /** Trust answers for `git_config` (default pending). */
  trust: Map<Sha256, "trusted" | "denied" | "pending">;
  /** Run plain git in the USER's repo (test assertions; the test env's isolation applies). */
  userGit(args: string[], input?: string): string;
  dispose(): Promise<void>;
}

let seq = 0;

/** Serial write queue (the real one is the server's; ordering is all the git layer relies on). */
export function serialQueue(): WriteQueue {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(_label: string, fn: () => T): Promise<T> => {
    const run = chain.then(() => fn());
    chain = run.catch(() => undefined);
    return run;
  };
}

export async function gitWorld(
  name: FixtureName,
  opts: { step?: number | "dirty"; gitconfig?: string; deny?: Glob[]; trust?: "trusted" | "pending" } = {},
): Promise<GitWorld> {
  const repo = await buildFixture(name, opts.step === undefined ? {} : { step: opts.step });
  const home = await createTestHome();
  const userHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-user-home-")));
  writeFileSync(
    join(userHome, ".gitconfig"),
    `[user]\n\tname = Test User\n\temail = user@example.invalid\n[commit]\n\tgpgsign = false\n${opts.gitconfig ?? ""}`,
  );
  const env = { PATH: process.env.PATH, HOME: userHome };
  const trust = new Map<Sha256, "trusted" | "denied" | "pending">();
  const db = memDb(LOOP_MIGRATIONS);
  const deps: GitSafetyDeps = {
    ws: { key: `ws_test${String(++seq).padStart(8, "0")}` as WorkspaceInfo["key"], root: realpathSync(repo.root), kind: repo.git ? "git" : "shadow" },
    home: realpathSync(home.dir),
    spawner: createSpawner(),
    env,
    fs: createFsReader(),
    safeWrite: createSafeWriter(),
    hasher: createHasher(),
    random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
    clock: systemClock,
    trust: (_item, hash) => trust.get(hash) ?? opts.trust ?? "pending",
    blobReader: (gitDir) => createGitReader({ workTree: null, gitDir, env }),
    log: createTestLogger(),
    db,
    write: serialQueue(),
    secrets: createSecretScanner(),
    deny: () => opts.deny ?? [...DEFAULT_DENY_GLOBS],
  };
  const git = createGitSafety(deps);
  return {
    repo,
    home,
    userHome,
    deps,
    git,
    trust,
    userGit(args, input) {
      const r = spawnSync("git", args, {
        cwd: repo.root,
        encoding: "utf8",
        input,
        env: { ...process.env, HOME: userHome, GIT_CONFIG_GLOBAL: join(userHome, ".gitconfig") },
      });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    },
    async dispose() {
      await git.close();
      db.close();
      await repo.dispose();
      await home.cleanup();
      rmSync(userHome, { recursive: true, force: true });
    },
  };
}

/** Everything that identifies the user's repository state besides the working tree (GIT-S-06). */
export function userRepoState(w: GitWorld): Record<string, string> {
  return {
    refs: w.userGit(["for-each-ref", "--format=%(refname) %(objectname)"]),
    head: w.userGit(["rev-parse", "HEAD"]),
    objects: w.userGit(["count-objects", "-v"]).replace(/^size-pack.*$/m, ""),
    worktrees: w.userGit(["worktree", "list", "--porcelain"]),
    config: w.userGit(["config", "--local", "--list"]),
    index: w.userGit(["ls-files", "-s", "--debug"]),
    branch: w.userGit(["branch", "-a"]),
    stash: w.userGit(["stash", "list"]),
  };
}
