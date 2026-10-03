// Working-tree snapshot (spec §7.2 with the side repo of ADR-0012; SEC-07): the user's index is COPIED into a temp
// index of the side repo, `add -u` picks up tracked changes, untracked files are added only when they pass the
// filters (deny glob, SECRET_PATH_GLOBS, size, symlink, content secret scan), and every deny-glob path is removed
// from the tree. Nothing is written to the user's repository. Deny matching is picomatch `{dot:true}` everywhere
// (the same matcher as the router and the bundle); git receives the resulting paths as literal pathspecs.

import { type GitOid, type Glob, MitoriError, type RepoPath, SECRET_PATH_GLOBS, type SecretScanner } from "@mitori/core";
import { GIT_LIMITS, type Snapshot } from "../contract.ts";
import { pathMatcher } from "../router/deny.ts";
import { nfc, splitZ } from "./exec.ts";
import type { GitWorkspace } from "./side.ts";

/** Bytes of an untracked file read for the content secret scan (larger files are skipped by size anyway). */
const SCAN_NUL_PROBE = 8000;
const dec = new TextDecoder("utf-8", { fatal: false });

/** Why an untracked file stayed out of the snapshot. */
export type UntrackedSkip = "deny" | "secret_path" | "secret_content" | "size" | "symlink" | "special";

/** Decide whether one untracked file may enter a snapshot. */
export function untrackedVerdict(
  path: RepoPath,
  ctx: { deny: (p: RepoPath) => boolean; secretPath: (p: RepoPath) => boolean; stat: { size: number; isFile: boolean; isSymlink: boolean } | null },
): UntrackedSkip | null {
  // secret paths are a subset of the deny globs: report them (the job card counts them), drop other deny matches silently
  if (ctx.secretPath(path)) return "secret_path";
  if (ctx.deny(path)) return "deny";
  const st = ctx.stat;
  if (!st) return "special";
  if (st.isSymlink) return "symlink";
  if (!st.isFile) return "special";
  if (st.size > GIT_LIMITS.untrackedMaxBytes) return "size";
  return null;
}

/** True when `bytes` (text-looking) contains a secret-scanner hit. */
export function hasSecret(bytes: Uint8Array, secrets: SecretScanner): boolean {
  const probe = bytes.subarray(0, SCAN_NUL_PROBE);
  if (probe.includes(0)) return false; // binary: the line rules do not apply
  return secrets.scan(dec.decode(bytes)).length > 0;
}

/** Snapshotter with a one-entry reuse cache (same HEAD + status + stats + deny ⇒ same commit, ≤ 20 ms). */
export class Snapshotter {
  private last: Snapshot | null = null;

  constructor(
    private readonly g: GitWorkspace,
    private readonly secrets: SecretScanner,
  ) {}

  /** Drop the reuse cache (the next snapshot re-reads everything). */
  invalidate(): void {
    this.last = null;
  }

  async snapshot(deny: readonly Glob[], opts: { reuse?: boolean } = {}): Promise<Snapshot> {
    await this.g.ready();
    const head = await this.g.head();
    const status = await this.g.user(["status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames", "--ignore-submodules=all"]);
    const key = this.reuseKey(head, status.out, deny);
    if (opts.reuse !== false && this.last && this.last.key === key) return { ...this.last, reused: true };
    const snap = await this.build(head, deny, key);
    this.last = snap;
    return snap;
  }

  private reuseKey(head: GitOid | null, status: string, deny: readonly Glob[]): string {
    const parts = [head ?? "-", status, deny.join("\0"), this.g.configTrusted() ? "t" : "u"];
    for (const f of splitZ(status)) {
      const path = statusPath(f);
      if (path === null) continue;
      const st = this.g.deps.fs.stat(`${this.g.root}/${path}`);
      parts.push(st ? `${path}\0${st.size}\0${st.mtimeNs}` : `${path}\0-`);
    }
    return this.g.deps.hasher.xxh3(parts.join("\n"));
  }

  private async build(head: GitOid | null, deny: readonly Glob[], key: string): Promise<Snapshot> {
    const denied = pathMatcher(deny);
    const { gitDir } = await this.g.userDirs();
    const indexPath = `${gitDir}/index`;
    const seed = this.g.deps.fs.stat(indexPath)?.isFile ? await this.g.deps.fs.read(indexPath) : null;
    const untracked = await this.untracked(denied);
    const run = (from: Uint8Array | null) =>
      this.g.withIndex(from, async (indexFile) => {
        const wt = { cwd: this.g.root, workTree: this.g.root, indexFile };
        if (from === null && head) await this.g.side(["read-tree", head], { indexFile });
        const tracked = splitZ((await this.g.side(["ls-files", "-z", "--cached"], wt)).out).map(nfc);
        const denyTracked = [...new Set(tracked.filter(denied))];
        const pathspec = [".", ...denyTracked.map((p) => `:(exclude,literal)${p}`)];
        await this.g.side(["add", "-u", "--pathspec-from-file=-", "--pathspec-file-nul"], { ...wt, input: `${pathspec.join("\0")}\0` });
        if (untracked.add.length > 0)
          await this.g.side(["add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], {
            ...wt,
            env: { GIT_LITERAL_PATHSPECS: "1" },
            input: `${untracked.add.join("\0")}\0`,
          });
        if (denyTracked.length > 0)
          await this.g.side(["rm", "-r", "--cached", "-f", "-q", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], {
            ...wt,
            env: { GIT_LITERAL_PATHSPECS: "1" },
            input: `${denyTracked.join("\0")}\0`,
          });
        return (await this.g.side(["write-tree"], { indexFile })).out.trim();
      });
    let tree: GitOid;
    try {
      tree = await run(seed);
    } catch (e) {
      // a split index (`core.splitIndex`) or an index from a newer git cannot be read outside its git dir: start from HEAD
      if (seed === null) throw e;
      this.g.deps.log.warn("snapshot: user index unreadable in the side repo, rebuilding from HEAD", { error: MitoriError.from(e).message });
      tree = await run(null);
    }
    const commit = await this.g.commitTree(tree, head ? [head] : [], "mitori snapshot\n");
    return { commit, tree, key, skippedUntracked: untracked.skipped, reused: false };
  }

  /** Untracked candidates of the user's repository (`--exclude-standard` honours the user's ignore files) after the filters. */
  private async untracked(denied: (p: RepoPath) => boolean): Promise<{ add: RepoPath[]; skipped: RepoPath[] }> {
    const r = await this.g.user(["ls-files", "-z", "--others", "--exclude-standard"]);
    const secretPath = pathMatcher(SECRET_PATH_GLOBS);
    const add: RepoPath[] = [];
    const skipped: RepoPath[] = [];
    for (const raw of splitZ(r.out)) {
      if (raw.endsWith("/")) continue; // a nested repository
      const path = nfc(raw);
      const st = this.g.deps.fs.stat(`${this.g.root}/${path}`);
      const verdict = untrackedVerdict(path, { deny: denied, secretPath, stat: st });
      if (verdict === "deny") continue; // never mentioned (not even as skipped)
      if (verdict !== null) {
        skipped.push(path);
        continue;
      }
      const bytes = await this.g.deps.fs.read(`${this.g.root}/${path}`);
      if (hasSecret(bytes, this.secrets)) {
        skipped.push(path);
        continue;
      }
      add.push(raw);
    }
    return { add, skipped };
  }
}

/** The path of one porcelain v2 `-z` record (ordinary `1`, unmerged `u`, untracked `?`); null for others. */
export function statusPath(f: string): RepoPath | null {
  const kind = f[0];
  if (kind === "?" || kind === "!") return nfc(f.slice(2));
  const skip = kind === "1" ? 8 : kind === "u" ? 10 : kind === "2" ? 9 : -1;
  if (skip < 0) return null;
  let at = 0;
  for (let k = 0; k < skip; k++) at = f.indexOf(" ", at) + 1;
  return at > 0 ? nfc(f.slice(at)) : null;
}

/**
 * Paths git treats specially (SEC-18): a `filter` or `working-tree-encoding` attribute, or a Git LFS pointer as the
 * current blob. They never enter a write scope (the router's `writable` ctx).
 */
export async function unwritablePaths(g: GitWorkspace, paths: readonly RepoPath[], blobOf: (p: RepoPath) => GitOid | null): Promise<RepoPath[]> {
  if (paths.length === 0) return [];
  await g.ready();
  const r = await g.user(["check-attr", "-z", "--stdin", "filter", "working-tree-encoding"], { input: `${paths.join("\0")}\0` });
  const f = splitZ(r.out);
  const out = new Set<RepoPath>();
  for (let i = 0; i + 2 < f.length; i += 3) {
    const value = f[i + 2] as string;
    if (value !== "unspecified" && value !== "unset") out.add(nfc(f[i] as string));
  }
  for (const p of paths) {
    if (out.has(p)) continue;
    const blob = blobOf(p);
    if (!blob) continue;
    try {
      const head = (await g.blob(blob)).subarray(0, 64);
      if (dec.decode(head).startsWith("version https://git-lfs.github.com/spec/v1")) out.add(p);
    } catch {
      // unreadable blob: not a pointer we can tell apart; the router keeps its own exclusions
    }
  }
  return [...out].sort();
}
