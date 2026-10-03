// Test helper: throw-away git repositories built with the git CLI (fixed identity and dates).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_AUTHOR_DATE: "@1767225600 +0000",
  GIT_COMMITTER_DATE: "@1767225600 +0000",
};

export interface TempRepo {
  root: string;
  write(path: string, content: string | Uint8Array): void;
  run(...args: string[]): string;
  commit(message?: string): void;
  dispose(): void;
}

export function tempRepo(files: Record<string, string | Uint8Array>, opts: { git?: boolean } = {}): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "mitori-idx-"));
  const run = (...args: string[]): string => {
    const p = Bun.spawnSync(["git", ...args], { cwd: root, env: ENV });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
    return p.stdout.toString();
  };
  const write = (path: string, content: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const [p, c] of Object.entries(files)) write(p, c);
  const repo: TempRepo = {
    root,
    write,
    run,
    commit(message = "c") {
      run("add", "-A");
      run("commit", "-q", "--allow-empty", "-m", message);
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
  if (opts.git !== false) {
    run("init", "-q", "-b", "main");
    repo.commit("init");
  }
  return repo;
}
