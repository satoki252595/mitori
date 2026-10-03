// Test helpers: deterministic throw-away git repositories (fixed identity and dates, no user/system config).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./tmp.ts";

const BASE_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "mitori test",
  GIT_AUTHOR_EMAIL: "test@mitori.invalid",
  GIT_COMMITTER_NAME: "mitori test",
  GIT_COMMITTER_EMAIL: "test@mitori.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

let step = 0;

/** Run git synchronously in `cwd`; throws with stderr on failure. Each call gets the next fixed timestamp. */
export function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  const date = `@${1767225600 + step++ * 60} +0000`;
  const r = Bun.spawnSync(["git", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: { ...BASE_ENV, HOME: cwd, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, ...env },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** Write files under `root` (creating directories). */
export function put(root: string, files: Readonly<Record<string, string | Uint8Array>>): void {
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
}

/** A repository with `files` committed (unless `commit: false`). Returns the realpath of the work tree. */
export function makeRepo(files: Readonly<Record<string, string | Uint8Array>>, opts: { objectFormat?: "sha1" | "sha256"; commit?: boolean } = {}): string {
  const root = tempDir("mitori-git-");
  git(root, ["init", "-q", `--object-format=${opts.objectFormat ?? "sha1"}`]);
  put(root, files);
  if (opts.commit ?? true) {
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "initial"]);
  }
  return root;
}

/** Env for {@link createGitReader} in tests: PATH plus a HOME without any git config. */
export function readerEnv(home: string): Record<string, string> {
  return { PATH: BASE_ENV.PATH, HOME: home };
}
