// Dependency trees around a gate run (ADR-0013 4, RT-31). A job worktree links the user's real `node_modules` /
// `.venv` (read-only by convention, spec §7.3). Inside the OS sandbox those realpaths are not writable; WITHOUT a
// sandbox a consented gate runs with the user's rights, so the trees are fingerprinted before and after the run and
// a change fails the job — a test that rewrites a dependency would otherwise outlive a reject.
//
// The fingerprint is (path, type, size, mtime, inode) of every entry, walked in name order without following links
// (FsReader.stat is an lstat). A writer that restores size AND mtime of an in-place edit is not seen (FsStat carries
// no ctime — docs/design/cr-requests/agent.md #3); the sandbox is the defence, this is the fallback's tripwire.
import type { FsReader, RepoPath } from "@mitori/core";

/** Dependency directory names linked into worktrees (git/worktree.ts `DEPENDENCY_DIRS` + workspace `node_modules`). */
const DEP_NAMES: ReadonlySet<string> = new Set(["node_modules", ".venv", "venv"]);
/** Entries walked per tree before giving up (the result then says so). */
export const FINGERPRINT_MAX_ENTRIES = 400_000;

/** Dependency links of a tree: symlinks named like a dependency directory at depth ≤ 3. */
export function dependencyLinks(fs: Pick<FsReader, "readdir" | "stat">, tree: string): RepoPath[] {
  const out: RepoPath[] = [];
  const walk = (rel: string, depth: number): void => {
    const names = fs.readdir(rel === "" ? tree : `${tree}/${rel}`) ?? [];
    for (const n of names.sort()) {
      if (n === ".git") continue;
      const p = rel === "" ? n : `${rel}/${n}`;
      const st = fs.stat(`${tree}/${p}`);
      if (!st) continue;
      if (st.isSymlink && DEP_NAMES.has(n)) out.push(p);
      else if (st.isDir && !st.isSymlink && depth < 3 && !DEP_NAMES.has(n)) walk(p, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/** FNV-1a (64-bit) over a stream of strings — a change detector, not a MAC. */
class Fnv {
  private h = 0xcbf29ce484222325n;
  add(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.h ^= BigInt(s.charCodeAt(i));
      this.h = (this.h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    this.h ^= 0xffn;
  }
  hex(): string {
    return this.h.toString(16).padStart(16, "0");
  }
}

/** Fingerprint of the trees behind `links` (resolved through `realpath`); `complete: false` when a cap was hit. */
export function dependencyFingerprint(fs: FsReader, tree: string, links: readonly RepoPath[]): { hash: string; entries: number; complete: boolean } {
  const h = new Fnv();
  let entries = 0;
  let complete = true;
  for (const link of links) {
    const root = fs.realpath(`${tree}/${link}`);
    h.add(`L ${link} -> ${root ?? "?"}`);
    if (!root) continue;
    const stack: string[] = [root];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      const names = fs.readdir(dir);
      if (!names) continue;
      for (const n of names.sort()) {
        if (++entries > FINGERPRINT_MAX_ENTRIES) {
          complete = false;
          break;
        }
        const abs = `${dir}/${n}`;
        const st = fs.stat(abs);
        if (!st) continue;
        const kind = st.isSymlink ? "l" : st.isDir ? "d" : "f";
        h.add(`${kind} ${abs.slice(root.length)} ${st.size} ${st.mtimeNs} ${st.ino}`);
        if (st.isDir && !st.isSymlink) stack.push(abs);
      }
      if (!complete) break;
    }
  }
  return { hash: h.hex(), entries, complete };
}
