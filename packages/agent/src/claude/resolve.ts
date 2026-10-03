import type { BinaryPin, FsReader, Hasher, Iso8601 } from "@mitori/core";

/** A bare command name that may be looked up on SAFE_PATH (no separator, no leading dot or dash). */
const BARE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** True when `binary` is a bare command name (settings `engines.claude-cli.binary`, default `claude`). */
export const isBareName = (binary: string): boolean => BARE_NAME_RE.test(binary);

/**
 * The first `<dir>/<name>` on SAFE_PATH that resolves to a regular file [SEC-10]. SAFE_PATH (platform
 * `resolveSafePath`) already drops empty and relative entries, entries under a workspace root, `node_modules/.bin` and
 * `.venv/bin`; relative entries are skipped again here (defence in depth). Symlinks are followed (native installs
 * link `~/.local/bin/claude` to `versions/<v>`) and the target must be a regular file.
 */
export function resolveOnSafePath(fs: FsReader, safePath: string, name: string): { path: string; realpath: string } | null {
  if (!isBareName(name)) return null;
  for (const entry of safePath.split(":")) {
    if (!entry.startsWith("/")) continue;
    const path = `${entry.replace(/\/+$/, "")}/${name}`;
    const st = fs.stat(path);
    if (st === null || st.isDir) continue;
    const realpath = fs.realpath(path);
    if (realpath === null) continue;
    if (fs.stat(realpath)?.isFile !== true) continue;
    return { path, realpath };
  }
  return null;
}

/** Temporary directories (macOS per-user `/var/folders`, `/tmp`, `/var/tmp`, `/dev/shm`); `TMPDIR` is added. */
const TEMP_PREFIXES = ["/tmp/", "/private/tmp/", "/var/tmp/", "/private/var/tmp/", "/var/folders/", "/private/var/folders/", "/dev/shm/"];

/**
 * True when a resolved binary may NOT be trusted on first use: it (or its target) lies in a temporary directory.
 * No install puts `claude` there, other processes can write there, and a shim found there is not what the user meant
 * by "claude" (the test spawn guard puts one first on PATH). Such a binary waits for the human confirmation on the
 * engine card (`POST /engines/:engine/repin`) [SEC-10, CR m1-65].
 */
export function untrustedOnFirstUse(found: { path: string; realpath: string }, tmpdir: string | undefined): boolean {
  const prefixes = tmpdir?.startsWith("/") ? [...TEMP_PREFIXES, `${tmpdir.replace(/\/+$/, "")}/`] : TEMP_PREFIXES;
  return [found.path, found.realpath].some((p) => prefixes.some((x) => p.startsWith(x)));
}

/**
 * Trust-on-first-use pin of a resolved binary [CR m1-65]: sha256 of the file the path resolves to, the first line of
 * `--version`, `by: "first-run"`. Reading the whole binary (≈ 230 MB for claude 2.1.x, ≈ 0.1 s) happens once per
 * daemon until the composition root persists the pin.
 */
export async function firstRunPin(fs: FsReader, hasher: Hasher, found: { path: string; realpath: string }, version: string, now: Iso8601): Promise<BinaryPin> {
  const sha256 = hasher.sha256(await fs.read(found.realpath));
  return { path: found.path, realpath: found.realpath, sha256, version, pinnedAt: now, by: "first-run" };
}
