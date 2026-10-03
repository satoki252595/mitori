// Test-only GitReader over the git CLI (the production one is @mitori/platform's, WP-01). Same argv as indexer spec
// §2.1; `env` carries GIT_DIR / GIT_WORK_TREE for shadow repositories.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitOid, GitReader, RepoPath } from "@mitori/core";
import { INVENTORY_SETS } from "../../contract.ts";

const dec = new TextDecoder();
const STAGED = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t/;

export interface TestGit extends GitReader {
  /** Subprocesses started (warm-path assertions). */
  calls: string[];
}

/**
 * A shadow repository for a non-git directory (spec §2.1-b, what the server's WorkspaceManager does on first open):
 * GIT_DIR in `gitDir`, `info/exclude` = DEFAULT_SHADOW_EXCLUDES, untracked cache on. Nothing is written into `root`.
 */
export function shadowGit(root: string, gitDir: string): TestGit {
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: root };
  const run = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (run("rev-parse", "--git-dir").exitCode !== 0) {
    mkdirSync(gitDir, { recursive: true });
    run("init", "--quiet", "--object-format=sha1");
    run("config", "core.untrackedCache", "true");
    run("config", "core.fsmonitor", "false");
    run("config", "core.quotepath", "off");
    mkdirSync(join(gitDir, "info"), { recursive: true });
    writeFileSync(join(gitDir, "info/exclude"), `${INVENTORY_SETS.shadowExcludes.join("\n")}\n`);
  }
  return cliGit(root, env);
}

export function cliGit(cwd: string, env: Record<string, string> = {}): TestGit {
  const calls: string[] = [];
  const baseEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    LC_ALL: "C",
    ...env,
  };
  async function git(args: string[], opts: { stdin?: string; allowFail?: boolean } = {}): Promise<{ code: number; out: Uint8Array }> {
    calls.push(args.filter((a) => !a.startsWith("-c")).join(" "));
    const p = Bun.spawn(["git", "-c", "core.quotepath=off", ...args], {
      cwd,
      env: baseEnv,
      stdin: opts.stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opts.stdin !== undefined && p.stdin) {
      p.stdin.write(opts.stdin);
      await p.stdin.end();
    }
    const [buf, code] = await Promise.all([Bun.readableStreamToArrayBuffer(p.stdout), p.exited]);
    const out = new Uint8Array(buf);
    if (code !== 0 && opts.allowFail !== true) throw new Error(`git ${args.join(" ")} failed (${code}): ${await new Response(p.stderr).text()}`);
    return { code, out };
  }
  const text = async (args: string[]): Promise<string | null> => {
    const r = await git(args, { allowFail: true });
    return r.code === 0 ? dec.decode(r.out).trim() : null;
  };
  const z = (b: Uint8Array): string[] => {
    if (b.length === 0) return [];
    const parts = dec.decode(b).split("\0");
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const unsupported = (n: string) => () => Promise.reject(new Error(`test git: ${n} not implemented`));

  return {
    calls,
    async lsFiles() {
      // One process: with --stage, untracked entries come back as bare paths (no `<mode> <oid> <stage>\t` prefix).
      const r = await git(["ls-files", "-s", "-z", "--cached", "--others", "--exclude-standard"]);
      const out: { path: RepoPath; blob: GitOid; mode: string; stage: 0 | 1 | 2 | 3; tracked: boolean }[] = [];
      for (const rec of z(r.out)) {
        const m = STAGED.exec(rec);
        if (m === null) out.push({ path: rec, blob: "", mode: "", stage: 0, tracked: false });
        else out.push({ path: rec.slice(m[0].length), blob: m[2] as string, mode: m[1] as string, stage: Number(m[3]) as 0 | 1 | 2 | 3, tracked: true });
      }
      return out;
    },
    async lsOthers({ directories }) {
      return z((await git(["ls-files", "-z", "--others", "--exclude-standard", ...(directories ? ["--directory"] : [])])).out);
    },
    async status() {
      const out: { path: RepoPath; xy: string }[] = [];
      const recs = z((await git(["status", "--porcelain=v2", "-z", "--untracked-files=no", "--no-renames", "--ignore-submodules=all"])).out);
      for (const r of recs) {
        const f = r.split(" ");
        if (f[0] === "1") out.push({ path: f.slice(8).join(" "), xy: f[1] as string });
        else if (f[0] === "u") out.push({ path: f.slice(10).join(" "), xy: f[1] as string });
      }
      return out;
    },
    async statusDirty() {
      const st = await this.status();
      return st.filter((s) => s.xy[1] !== "." || s.xy.startsWith("U") || s.xy.endsWith("U") || s.xy === "AA" || s.xy === "DD").map((s) => s.path);
    },
    async checkAttr(paths, attrs) {
      const r = await git(["check-attr", "-z", "--stdin", ...attrs], { stdin: `${paths.join("\0")}\0` });
      const f = z(r.out);
      const out: Record<RepoPath, Record<string, string>> = {};
      for (let i = 0; i + 2 < f.length + 1; i += 3) {
        const [p, a, v] = [f[i] as string, f[i + 1] as string, f[i + 2] as string];
        if (v === "unspecified" || v === undefined) continue;
        const row = out[p] ?? {};
        row[a] = v;
        out[p] = row;
      }
      return out;
    },
    async catBlob(blob) {
      const r = await git(["cat-file", "blob", blob], { allowFail: true });
      if (r.code !== 0) throw new Error(`missing object ${blob}`);
      return r.out;
    },
    head: () => text(["rev-parse", "-q", "--verify", "HEAD^{commit}"]),
    headTree: () => text(["rev-parse", "-q", "--verify", "HEAD^{tree}"]),
    branch: () => text(["symbolic-ref", "-q", "--short", "HEAD"]),
    async gitDir() {
      return (await text(["rev-parse", "--absolute-git-dir"])) ?? `${cwd}/.git`;
    },
    diffNames: unsupported("diffNames"),
    log: unsupported("log"),
    revCount: unsupported("revCount"),
    isShallow: async () => false,
    async objectFormat() {
      return ((await text(["rev-parse", "--show-object-format"])) ?? "sha1") as "sha1" | "sha256";
    },
  };
}
