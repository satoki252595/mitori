/**
 * Vendor CLI auto-follow (WP28): decide whether the daemon may switch to a new executable without human
 * action, and verify the candidate. Pure decision helpers + a small async verifier whose I/O (fs, ownership,
 * `--version`, hashing) is injected, so tests never call a real vendor CLI.
 *
 * Follow is allowed only when ALL hold (spec §A):
 *  1. the candidate is reached from the approved entry only — the saved `pin.path` re-resolved (Claude/Codex),
 *     or the Muse `.muse-version` marker in the same directory as the saved `argv[0]` (`binaryOf` rule);
 *  2. the candidate passes the SEC-10 path check (absolute, not under a workspace, not `node_modules/.bin`,
 *     not `.venv/bin`, not a temp dir), is a regular file, is owned by the current user or root, and has no
 *     group/other write bits (POSIX; Windows never follows);
 *  3. `--version` verifies like `setup-pin prepareProviderPin` (bounded output, a valid first line, and the
 *     realpath + file identity unchanged during the check; the binary itself is never read whole).
 * Engine capability gates (Claude `--help`, Codex `CODEX_VERSION`, Muse text-only argv + config) stay with the
 * caller: verify first, then check the gate, and only then persist. Any failure ⇒ return `null` and change
 * nothing (spec §B shows the re-setup command instead).
 */

const MUSE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

/** Same validity rule as `setup-pin prepareProviderPin`: one clean first line. */
export function isValidVersionLine(version: string): boolean {
  if (!version || version.length > 512) return false;
  for (const c of version) {
    const code = c.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** `muse-bin-<ver>` suffix of a configured Muse native binary (same shape as `setup binaryOf`). */
export function isMuseBinPath(path: string): boolean {
  return /\/muse-bin-[^/]+$/.test(path);
}

/**
 * Candidate Muse binary from a marker file's text: `<dir>/.muse-version` holds `<ver>` and the successor is
 * `<dir>/muse-bin-<ver>` (the `binaryOf` rule). Returns the full path, or `null` when the marker is invalid
 * or names the binary that is already configured.
 */
export function museCandidateFor(dir: string, markerText: string, current: string): string | null {
  const version = markerText.trim();
  if (!MUSE_VERSION_RE.test(version)) return null;
  const candidate = `${dir.replace(/\/+$/, "")}/muse-bin-${version}`;
  return candidate === current ? null : candidate;
}

/** Temporary directory prefixes (same list as `claude/resolve.ts untrustedOnFirstUse`). */
const TEMP_PREFIXES = ["/tmp/", "/private/tmp/", "/var/tmp/", "/private/var/tmp/", "/var/folders/", "/private/var/folders/", "/dev/shm/"];

/**
 * SEC-10 path check for a follow candidate: absolute, not under a workspace root, not `node_modules/.bin`,
 * not `.venv/bin`, not a temp dir (plus `tmpdir` when given). Mirrors `platform resolveSafePath` drops.
 */
export function isFollowSafePath(path: string, opts: { workspaceRoots: readonly string[]; tmpdir?: string | undefined }): boolean {
  if (!path.startsWith("/")) return false;
  if (path.includes("/node_modules/.bin/") || path.endsWith("/node_modules/.bin") || /(?:^|\/)node_modules\/\.bin(?:\/|$)/.test(path)) return false;
  if (/(?:^|\/)\.venv\/bin(?:\/|$)/.test(path)) return false;
  for (const root of opts.workspaceRoots) {
    const base = root.replace(/\/+$/, "");
    if (!base.startsWith("/")) continue;
    if (path === base || path.startsWith(`${base}/`)) return false;
  }
  const prefixes = opts.tmpdir?.startsWith("/") ? [...TEMP_PREFIXES, `${opts.tmpdir.replace(/\/+$/, "")}/`] : TEMP_PREFIXES;
  if (prefixes.some((x) => path.startsWith(x))) return false;
  return true;
}

/** Ownership check: the owner is the current user or root, and group/other have no write bit (POSIX). */
export function isOwnershipSafe(stat: { uid: number; mode: number }, euid: number): boolean {
  if (stat.uid !== euid && stat.uid !== 0) return false;
  return (stat.mode & 0o022) === 0;
}

/** Identity of a candidate file for the "unchanged during verification" check (stat; never a read). */
export interface FileId {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

/** True when two `fileId` observations describe the same unchanged file. */
export function sameFileId(a: FileId, b: FileId): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/** The follow ports each engine wires (bridge) or fakes (tests): ownership + identity + one streamed hash. */
export interface FollowPorts {
  /** Workspace roots for the SEC-10 path check. */
  workspaceRoots: () => readonly string[];
  /** POSIX ownership of the candidate; `null` when unavailable (⇒ refuse). */
  ownership: (candidate: string) => { uid: number; mode: number } | null;
  /** Identity of the candidate; `null` when unstatting fails (⇒ refuse). */
  fileId: (candidate: string) => FileId | null;
  /** sha256 hex of the file, read as a stream (never the whole file in memory); `null` on failure. */
  sha256File: (candidate: string) => Promise<string | null>;
  /** Current user id (production: `process.geteuid?.() ?? process.getuid?.()`). */
  euid: number;
  /** `process.platform`; `"win32"` never follows. */
  platform: string;
}

/** Injected I/O for the async verifier (production: FsReader + spawner + node ownership; tests: fakes). */
export interface FollowIo {
  /** `realpath` of the approved entry (the saved symlink); `null` when missing. */
  realpath: (entry: string) => string | null;
  /** True when the candidate is a regular file (lstat). */
  statIsFile: (candidate: string) => boolean;
  /** Whole marker read; `null` when unreadable (markers are tiny; binaries are never read whole). */
  readText: (path: string) => Promise<string | null>;
  /** Identity of the candidate; `null` when unstatting fails (⇒ refuse). */
  fileId: (candidate: string) => FileId | null;
  /** sha256 hex of the file, read as a stream; `null` on failure. Taken at most once per verification. */
  sha256File: (candidate: string) => Promise<string | null>;
  /** POSIX ownership of the candidate; `null` when unavailable (⇒ refuse). */
  ownership: (candidate: string) => { uid: number; mode: number } | null;
  /** First line of `<candidate> --version`; `null` when the probe fails or is too large. */
  runVersion: (candidate: string) => Promise<string | null>;
  /** Current user id (production: `process.geteuid?.() ?? process.getuid?.()`). */
  euid: number;
  /** `process.platform`; `"win32"` never follows. */
  platform: string;
  /** Workspace roots for the SEC-10 path check. */
  workspaceRoots: readonly string[];
  /** `TMPDIR` for the temp-dir check. */
  tmpdir?: string | undefined;
}

async function verifyCandidate(
  candidate: string,
  entry: string,
  io: FollowIo,
  needHash: boolean,
): Promise<{ realpath: string; sha256: string | null; version: string } | null> {
  if (io.platform === "win32") return null;
  if (!isFollowSafePath(candidate, { workspaceRoots: io.workspaceRoots, tmpdir: io.tmpdir })) return null;
  if (!io.statIsFile(candidate)) return null;
  const own = io.ownership(candidate);
  if (!own || !isOwnershipSafe(own, io.euid)) return null;
  // The entry must resolve here before the probe, and the file must be unchanged across it: `--version`
  // runs between two `fileId` observations (same rule as `prepareProviderPin`, without reading the binary).
  const before = io.fileId(candidate);
  if (!before) return null;
  if (io.realpath(entry) !== candidate) return null;
  const version = await io.runVersion(candidate);
  if (!version || !isValidVersionLine(version)) return null;
  const after = io.fileId(candidate);
  if (!after || !sameFileId(before, after)) return null;
  if (io.realpath(entry) !== candidate) return null;
  // Claude/Codex pins carry a sha256, so it is streamed once; a change during the hash refuses the candidate.
  let sha256: string | null = null;
  if (needHash) {
    sha256 = await io.sha256File(candidate);
    if (!sha256) return null;
    const hashed = io.fileId(candidate);
    if (!hashed || !sameFileId(after, hashed)) return null;
  }
  return { realpath: candidate, sha256, version };
}

/**
 * Claude/Codex successor: the saved `pin.path` (the approved entry, usually a symlink) re-resolved. Returns
 * the verified candidate, or `null` when there is no successor or any check fails (change nothing).
 */
export async function followPinUpdate(
  pin: { path: string; realpath: string },
  io: FollowIo,
): Promise<{ realpath: string; sha256: string; version: string } | null> {
  if (io.platform === "win32") return null;
  if (!pin.path.startsWith("/")) return null;
  const resolved = io.realpath(pin.path);
  if (!resolved || resolved === pin.realpath) return null;
  const verified = await verifyCandidate(resolved, pin.path, io, true);
  if (!verified || verified.sha256 === null) return null;
  return { realpath: verified.realpath, sha256: verified.sha256, version: verified.version };
}

/**
 * Muse successor: `<dir>/.muse-version` in the same directory as the saved `argv[0]` names
 * `muse-bin-<ver>` (the `binaryOf` rule). Returns the verified candidate `{path, …}`, or `null`.
 * `version` is the marker's `<ver>` (the `muse-bin-<ver>` suffix), not the `--version` line, so `from`/`to`
 * share one format; the `--version` probe still has to run cleanly. Muse has no pin, so no hash is taken.
 */
export async function followMuseUpdate(savedArgv0: string, io: FollowIo): Promise<{ path: string; realpath: string; version: string } | null> {
  if (io.platform === "win32") return null;
  if (!savedArgv0.startsWith("/")) return null;
  const dir = savedArgv0.slice(0, savedArgv0.lastIndexOf("/")) || "/";
  const marker = await io.readText(`${dir.replace(/\/+$/, "")}/.muse-version`);
  if (marker === null) return null;
  const candidate = museCandidateFor(dir, marker, savedArgv0);
  if (!candidate) return null;
  const verified = await verifyCandidate(candidate, candidate, io, false);
  if (!verified) return null;
  // The marker must not have moved under us (same "unchanged during verification" rule).
  const markerAgain = await io.readText(`${dir.replace(/\/+$/, "")}/.muse-version`);
  if (markerAgain === null || museCandidateFor(dir, markerAgain, savedArgv0) !== candidate) return null;
  return { path: candidate, realpath: verified.realpath, version: marker.trim() };
}
