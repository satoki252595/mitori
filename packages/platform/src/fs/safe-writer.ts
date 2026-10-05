// SafeWriter: the only way mitori writes files (ADR-0014, SEC-01). Six steps:
// (1) rel allowlist + no `..`/absolute/NUL/`\`, (2) lstat every component from rootReal (symlink ⇒ E_PATH_SYMLINK;
// missing directories are created one at a time and re-checked), (3) parent realpath under rootReal ⇒ else
// E_PATH_OUTSIDE, (4) temp file in the same dir with O_CREAT|O_EXCL|O_NOFOLLOW, write, fsync, (5) lstat the target
// right before rename (a symlink target is refused), (6) rename, fsync the directory.
import { constants, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { MitoriError, type Random, type SafeWriteKind, type SafeWriter } from "@mitori/core";
import { cryptoRandom } from "../random/index.ts";
import { checkRel } from "./rules.ts";
import type { SelfWriteLog } from "./self-writes.ts";

/** Options of {@link createSafeWriter}. */
export interface SafeWriterOptions {
  /** Records completed writes/removals so the watcher drops their echo. */
  selfWrites?: SelfWriteLog;
  /** Temp-name entropy (default crypto). */
  random?: Random;
  /** Test hook: runs between step 4 (temp written) and step 5 (target lstat). Never set in production. */
  beforeRename?: (target: string) => void | Promise<void>;
}

/** Temp files are `.mitori-tmp-<hex>` in the target's directory (the watcher ignores this name). */
export const SAFE_WRITE_TEMP_RE = /(?:^|\/)\.mitori-tmp-[0-9a-f]{16}$/;

const enc = new TextEncoder();

const symlinkErr = (path: string, root: string) =>
  new MitoriError("E_PATH_SYMLINK", `refusing to follow a symlink: ${relative(root, path) || "."}`, { params: { path: relative(root, path) } });
const outsideErr = (path: string, root: string, why: string) =>
  new MitoriError("E_PATH_OUTSIDE", `path resolves outside its root: ${relative(root, path) || "."} (${why})`, { params: { reason: why } });

const isUnder = (p: string, root: string) => {
  const rel = relative(root, p);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function lstatOrNull(p: string) {
  try {
    return lstatSync(p);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/** `rootReal` must be absolute and be its own realpath (a root reached through a symlink is refused). */
function checkRoot(rootReal: string): void {
  if (!isAbsolute(rootReal)) throw new MitoriError("E_INVALID_INPUT", "SafeWriter root must be absolute");
  let real: string;
  try {
    real = realpathSync(rootReal);
  } catch {
    throw new MitoriError("E_NOT_FOUND", "SafeWriter root does not exist", { params: { root: rootReal } });
  }
  if (real !== rootReal.replace(/\/+$/, "") && real !== rootReal) throw symlinkErr(rootReal, rootReal);
  if (!statSync(real).isDirectory()) throw new MitoriError("E_INVALID_INPUT", "SafeWriter root is not a directory");
}

/** Step 2: walk the directory components (creating missing ones when `create`), refusing symlinks. */
function walkDirs(root: string, dirs: readonly string[], create: boolean, dirMode: number): string | null {
  let at = root;
  for (const seg of dirs) {
    at = join(at, seg);
    let st = lstatOrNull(at);
    if (!st) {
      if (!create) return null;
      try {
        mkdirSync(at, { mode: dirMode });
      } catch (err) {
        if ((err as { code?: string }).code !== "EEXIST") throw err;
      }
      st = lstatOrNull(at);
    }
    if (!st) throw outsideErr(at, root, "vanished");
    if (st.isSymbolicLink()) throw symlinkErr(at, root);
    if (!st.isDirectory()) throw new MitoriError("E_INVALID_INPUT", `not a directory: ${relative(root, at)}`);
  }
  // Step 3: no component swapped since the walk (realpath equals the lexical path, inside root).
  const real = realpathSync(at);
  if (!isUnder(real, root) || real !== at) throw outsideErr(at, root, "parent-realpath");
  return at;
}

async function fsyncDir(dir: string): Promise<void> {
  // Windows does not support opening a directory for fsync. The file is synced before the atomic rename.
  if (process.platform === "win32") return;
  const fh = await open(dir, constants.O_RDONLY);
  try {
    await fh.sync();
  } catch {
    // some filesystems refuse fsync on directories; the rename itself is still atomic
  } finally {
    await fh.close();
  }
}

/** The production {@link SafeWriter}. */
export function createSafeWriter(opts: SafeWriterOptions = {}): SafeWriter {
  const random = opts.random ?? cryptoRandom;
  const tempName = () => `.mitori-tmp-${Buffer.from(random.bytes(8)).toString("hex")}`;

  async function writeAt(root: string, rel: string, bytes: Uint8Array, kind: SafeWriteKind, hop: number): Promise<void> {
    const segs = checkRel(rel, kind);
    const home = kind === "home";
    const dir = walkDirs(root, segs.slice(0, -1), true, home ? 0o700 : 0o755) as string;
    const target = join(dir, segs[segs.length - 1] as string);
    const before = lstatOrNull(target);
    if (before?.isSymbolicLink()) return followMeta(root, target, bytes, kind, hop);
    if (before?.isDirectory()) throw new MitoriError("E_INVALID_INPUT", `target is a directory: ${rel}`);
    // unchanged content ⇒ no write at all (mtime stays; no watcher echo) — unless a `home` file is not 0600 yet
    const modeOk = !home || (before !== null && (before.mode & 0o777) === 0o600);
    if (before?.isFile() && modeOk && before.size === bytes.byteLength && Buffer.from(readFileSync(target)).equals(bytes)) return;
    const mode = home ? 0o600 : before ? before.mode & 0o777 : 0o644;
    const tmp = join(dir, tempName());
    const fh = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    let renamed = false;
    try {
      try {
        await fh.writeFile(bytes);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await opts.beforeRename?.(target);
      // Step 5: TOCTOU guard — the target may have been swapped for a symlink since step 2.
      const now = lstatOrNull(target);
      if (now?.isSymbolicLink()) throw symlinkErr(target, root);
      if (now?.isDirectory()) throw new MitoriError("E_INVALID_INPUT", `target is a directory: ${rel}`);
      walkDirs(root, segs.slice(0, -1), false, 0);
      await rename(tmp, target);
      renamed = true;
    } finally {
      if (!renamed) await unlink(tmp).catch(() => {});
    }
    await fsyncDir(dir);
    opts.selfWrites?.noteWrite(target, bytes);
  }

  /** repo_meta only: a symlinked AGENTS.md/CLAUDE.md/.gitattributes is followed when its realpath stays in the repo. */
  async function followMeta(root: string, link: string, bytes: Uint8Array, kind: SafeWriteKind, hop: number): Promise<void> {
    if (kind !== "repo_meta" || hop > 0) throw symlinkErr(link, root);
    let real: string;
    try {
      real = realpathSync(link);
    } catch {
      throw symlinkErr(link, root);
    }
    if (!isUnder(real, root) || real === root) throw outsideErr(link, root, "symlink-target");
    return writeAt(root, relative(root, real).split(sep).join("/"), bytes, "accept", hop + 1);
  }

  return {
    async write(rootReal, rel, data, kind) {
      checkRoot(rootReal);
      await writeAt(rootReal.replace(/\/+$/, "") || "/", rel, typeof data === "string" ? enc.encode(data) : data, kind, 0);
    },
    async remove(rootReal, rel, kind) {
      checkRoot(rootReal);
      const root = rootReal.replace(/\/+$/, "") || "/";
      const segs = checkRel(rel, kind);
      const dir = walkDirs(root, segs.slice(0, -1), false, 0);
      if (dir === null) return;
      const target = join(dir, segs[segs.length - 1] as string);
      const st = lstatOrNull(target);
      if (!st) return;
      if (st.isSymbolicLink()) throw symlinkErr(target, root);
      if (st.isDirectory()) {
        if (kind !== "home" && kind !== "prep") throw new MitoriError("E_INVALID_INPUT", `refusing a recursive remove for kind ${kind}: ${rel}`);
        // rmSync never follows symlinks inside the tree (it unlinks them)
        rmSync(target, { recursive: true, force: true });
      } else await unlink(target);
      await fsyncDir(dir);
      opts.selfWrites?.noteRemove(target);
    },
  };
}
