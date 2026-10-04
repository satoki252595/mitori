// GitReader over hardened git subprocesses (core §18) for the three flavours: normal working tree, shadow
// (GIT_DIR=~/.mitori/repos/<ws>/shadow.git + GIT_WORK_TREE=<dir>) and side / bare (GIT_DIR only, no work tree).
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type GitOid, type GitReader, type Iso8601, MitoriError, type RepoPath } from "@mitori/core";
import { gitBlobOid } from "../hash/digest.ts";
import { CatFileBatch } from "./catfile.ts";
import { headFromFiles, parseTaggedListing, TAGGED_LISTING_ARGS } from "./local.ts";
import { ByteLru } from "./lru.ts";
import { filterNeutralizers, hasIncludes, localConfigKeys, type Neutralizers } from "./neutralize.ts";
import { createGitRunner, GIT_READ_ENV, nfc, splitZ } from "./run.ts";

/** Options of {@link createGitReader}. */
export interface GitReaderOptions {
  /** Absolute working tree root; null for a bare repository (the side repo). */
  workTree: string | null;
  /** Explicit `GIT_DIR` (shadow / side repo). Omitted ⇒ git discovers it from `workTree`. */
  gitDir?: string;
  /** Base env: PATH (SAFE_PATH) and HOME. Nothing else of the daemon env is passed. Default: those two of `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** git executable (default: `git` resolved on `env.PATH`). */
  git?: string;
  /** Per-call timeout (default 30 s, loop `GIT_ENV`). */
  timeoutMs?: number;
  /** Blob cache budget (default 64 MiB). */
  cacheBytes?: number;
  /**
   * Extra `-c key=value` args for every call. Independently of it, `status`/`statusDirty` always disable repo-local
   * filter drivers (the only read that can execute repo-configured commands) [SEC-05].
   */
  config?: () => readonly string[];
}

/** A {@link GitReader} owning a persistent `cat-file --batch`; `close()` stops it (workspace unload). */
export interface PlatformGitReader extends GitReader {
  /** Stop the persistent process. The reader stays usable (it restarts on demand). */
  close(): Promise<void>;
}

/** Default per-call timeout and blob cache. */
export const GIT_READER_DEFAULTS = { timeoutMs: 30_000, cacheBytes: 64 * 1024 * 1024 } as const;

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REV_RE = /^[0-9a-f]{4,64}$/;
const ATTR_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;

function needOid(oid: string, what: string, re = OID_RE): void {
  if (!re.test(oid)) throw new MitoriError("E_INVALID_INPUT", `${what}: not an object id: ${JSON.stringify(oid.slice(0, 80))}`);
}

/** Parse porcelain v2 `-z` entries (renames disabled): ordinary `1`, unmerged `u`, untracked `?`. */
function parseStatus(fields: string[]): { path: RepoPath; xy: string }[] {
  const out: { path: RepoPath; xy: string }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as string;
    const kind = f[0];
    if (kind === "?") out.push({ path: nfc(f.slice(2)), xy: "??" });
    else if (kind === "1" || kind === "u" || kind === "2") {
      const skip = kind === "1" ? 8 : kind === "2" ? 9 : 10; // fields before the path
      let at = 0;
      for (let k = 0; k < skip; k++) at = f.indexOf(" ", at) + 1;
      out.push({ path: nfc(f.slice(at)), xy: f.slice(2, 4) });
      if (kind === "2") i++; // the original path follows as its own field
    }
  }
  return out;
}

/** Create a reader. Nothing is spawned until the first call. */
export function createGitReader(opts: GitReaderOptions): PlatformGitReader {
  const base = opts.env ?? { PATH: process.env.PATH, HOME: process.env.HOME };
  const env: Record<string, string> = { ...GIT_READ_ENV };
  if (base.PATH) env.PATH = base.PATH;
  if (base.HOME) env.HOME = base.HOME;
  if (opts.gitDir) env.GIT_DIR = opts.gitDir;
  if (opts.gitDir && opts.workTree) env.GIT_WORK_TREE = opts.workTree;
  const git = opts.git ?? Bun.which("git", { PATH: env.PATH ?? "" });
  if (!git) throw new MitoriError("E_NOT_FOUND", "git not found on PATH", { params: { command: "git" } });
  const cwd = opts.workTree ?? opts.gitDir;
  if (!cwd) throw new MitoriError("E_INVALID_INPUT", "createGitReader needs workTree or gitDir");
  const runner = createGitRunner({ git, cwd, env, config: opts.config ?? (() => []), timeoutMs: opts.timeoutMs ?? GIT_READER_DEFAULTS.timeoutMs });
  const run = runner.run;
  const cache = new ByteLru(opts.cacheBytes ?? GIT_READER_DEFAULTS.cacheBytes);
  /** Tracked path per blob from the last lsFiles (stage 0): the fs fast path of catBlob. */
  let pathOf = new Map<GitOid, RepoPath>();
  let batch: CatFileBatch | null = null;
  let format: Promise<"sha1" | "sha256"> | null = null;
  let dir: Promise<string> | null = null;

  const text = async (args: string[], ok?: number[]) => {
    const r = await run(args, ok ? { ok } : {});
    return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() };
  };
  // memoized per reader; a failed lookup is not memoized (the repo may appear later, e.g. right after `git init`)
  const gitDir = () => {
    dir ??= text(["rev-parse", "--absolute-git-dir"]).then(
      (r) => r.out,
      (err: unknown) => {
        dir = null;
        throw err;
      },
    );
    return dir;
  };
  const objectFormat = () => {
    format ??= text(["rev-parse", "--show-object-format"]).then(
      (r): "sha1" | "sha256" => (r.out === "sha256" ? "sha256" : "sha1"),
      (err: unknown) => {
        format = null;
        throw err;
      },
    );
    return format;
  };
  // `shallow` lives in the COMMON dir: a linked worktree's git dir (`.git/worktrees/<name>`) never has it
  let common: Promise<string> | null = null;
  const commonDir = () => {
    common ??= text(["rev-parse", "--git-common-dir"]).then(
      (r) => resolve(cwd, r.out),
      (err: unknown) => {
        common = null;
        throw err;
      },
    );
    return common;
  };
  const isShallow = async () => existsSync(join(await commonDir(), "shallow"));
  const verify = async (rev: string) => {
    const r = await text(["rev-parse", "-q", "--verify", "--end-of-options", rev], [0, 1, 128]);
    return r.code === 0 && OID_RE.test(r.out) ? r.out : null;
  };

  /**
   * Repo-local filter drivers disabled for `status` (it runs clean filters) [SEC-05]. Cached by the mtimes of the
   * config files — unless the config includes other files, whose edits those mtimes do not see: then re-read per call.
   */
  let guard: { key: string | null; n: Neutralizers } | null = null;
  const statusGuard = async (): Promise<Neutralizers> => {
    const [d, c] = await Promise.all([gitDir(), commonDir()]);
    const mtime = (f: string) => {
      try {
        return statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    };
    const key = `${mtime(join(c, "config"))}:${mtime(join(d, "config.worktree"))}`;
    if (guard === null || guard.key === null || guard.key !== key) {
      const r = await run(["config", "--list", "--show-scope", "--includes", "-z"], { ok: [0, 1] });
      const keys = localConfigKeys(new TextDecoder().decode(r.stdout));
      guard = { key: hasIncludes(keys) ? null : key, n: filterNeutralizers(keys) };
    }
    return guard.n;
  };
  const status = async () => {
    const neutral = await statusGuard();
    const args = [...neutral.args, "status", "--porcelain=v2", "-z", "--no-renames", "--untracked-files=all", "--ignore-submodules=all"];
    const r = await run(args, { env: neutral.env });
    return parseStatus(splitZ(r.stdout));
  };

  const fromWorkTree = async (blob: GitOid): Promise<Uint8Array | null> => {
    const path = pathOf.get(blob);
    if (!path || !opts.workTree) return null;
    try {
      const bytes = await Bun.file(join(opts.workTree, path)).bytes();
      return gitBlobOid(bytes, await objectFormat()) === blob ? bytes : null;
    } catch {
      return null; // gone, a directory, or an NFD name on a normalization-sensitive fs: ask git
    }
  };

  return {
    async lsFiles() {
      // one process for the index and the untracked walk (a warm rescan's critical path), told apart by `-t` tags
      const all = parseTaggedListing(splitZ((await run(TAGGED_LISTING_ARGS)).stdout));
      const next = new Map<GitOid, RepoPath>();
      for (const e of all) if (e.tracked && e.stage === 0 && e.mode !== "160000" && e.mode !== "120000") next.set(e.blob, e.path);
      pathOf = next;
      return all;
    },
    async lsOthers({ directories }) {
      const r = await run(["ls-files", "-z", "--others", "--exclude-standard", ...(directories ? ["--directory"] : [])]);
      return splitZ(r.stdout).map(nfc);
    },
    status,
    async statusDirty() {
      return (await status()).map((e) => e.path);
    },
    async checkAttr(paths, attrs) {
      if (paths.length === 0 || attrs.length === 0) return {};
      for (const a of attrs) if (!ATTR_RE.test(a)) throw new MitoriError("E_INVALID_INPUT", `bad attribute name: ${JSON.stringify(a)}`);
      const r = await run(["check-attr", "-z", "--stdin", ...attrs], { input: `${paths.join("\0")}\0` });
      const f = splitZ(r.stdout);
      const out: Record<RepoPath, Record<string, string>> = {};
      for (let i = 0; i + 2 < f.length; i += 3) {
        const path = nfc(f[i] as string);
        const attr = f[i + 1] as string;
        const value = f[i + 2] as string;
        if (value === "unspecified") continue;
        const entry = out[path] ?? {};
        entry[attr] = value;
        out[path] = entry;
      }
      return out;
    },
    async catBlob(blob) {
      needOid(blob, "catBlob");
      const hit = cache.get(blob);
      if (hit) return hit.slice();
      let bytes = await fromWorkTree(blob);
      if (!bytes) {
        batch ??= new CatFileBatch(runner.argv(["cat-file", "--batch"]), cwd, env);
        const obj = await batch.get(blob);
        if (!obj) throw new MitoriError("E_NOT_FOUND", `blob ${blob} not found`, { params: { blob } });
        if (obj.type !== "blob") throw new MitoriError("E_INVALID_INPUT", `${blob} is a ${obj.type}, not a blob`, { params: { blob } });
        bytes = obj.bytes;
      }
      cache.set(blob, bytes);
      return bytes.slice();
    },
    // the ref files answer without a process (warm rescans ask on every scan); anything unusual asks git
    async head() {
      const dirs = await Promise.all([gitDir(), commonDir()]).catch(() => null);
      const fast = dirs === null ? undefined : headFromFiles(dirs[0], dirs[1]);
      return fast !== undefined ? fast : verify("HEAD^{commit}");
    },
    headTree: () => verify("HEAD^{tree}"),
    async branch() {
      const r = await text(["symbolic-ref", "-q", "--short", "HEAD"], [0, 1, 128]);
      return r.code === 0 && r.out !== "" ? r.out : null;
    },
    gitDir,
    async diffNames(from, to) {
      needOid(from, "diffNames", REV_RE);
      needOid(to, "diffNames", REV_RE);
      const r = await run(["diff-tree", "-r", "-z", "--name-only", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-commit-id", from, to]);
      return splitZ(r.stdout).map(nfc);
    },
    async log({ limit, sinceDays }) {
      if (limit <= 0 || (await isShallow()) || (await verify("HEAD^{commit}")) === null) return [];
      const args = ["log", "--no-merges", "--no-renames", "-z", "--name-only", "--format=%x1e%H%x1f%cI%x1f%s", `-n${Math.floor(limit)}`];
      if (sinceDays !== undefined) args.push(`--since=${Math.max(0, Math.floor(sinceDays))}.days.ago`);
      const r = await run([...args, "HEAD", "--"]);
      const out: { sha: GitOid; date: Iso8601; subject: string; paths: RepoPath[] }[] = [];
      for (const f of splitZ(r.stdout)) {
        if (f.startsWith("\x1e")) {
          const [sha, date, subject] = f.slice(1).split("\x1f");
          out.push({ sha: sha as string, date: new Date(date as string).toISOString(), subject: subject ?? "", paths: [] });
        } else {
          const cur = out[out.length - 1];
          const p = f.startsWith("\n") ? f.slice(1) : f;
          if (cur && p !== "") cur.paths.push(nfc(p));
        }
      }
      return out;
    },
    async revCount(from, to) {
      needOid(from, "revCount", REV_RE);
      needOid(to, "revCount", REV_RE);
      if (await isShallow()) return null;
      const r = await text(["rev-list", "--count", `${from}..${to}`], [0, 128]);
      const n = Number(r.out);
      return r.code === 0 && Number.isInteger(n) ? n : null;
    },
    isShallow,
    objectFormat,
    // CR m1-26 / NC-02: config reads only — never contacts the remote
    async remoteUrl() {
      const origin = await text(["config", "--get", "remote.origin.url"], [0, 1]);
      let url = origin.code === 0 ? origin.out : "";
      if (url === "") {
        const remotes = await text(["remote"], [0, 1, 128]);
        const first = remotes.code === 0 ? remotes.out.split("\n")[0]?.trim() : "";
        if (first && /^[A-Za-z0-9._-]+$/.test(first)) {
          const r = await text(["config", "--get", `remote.${first}.url`], [0, 1]);
          url = r.code === 0 ? r.out : "";
        }
      }
      return url === "" ? null : url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");
    },
    async headMeta() {
      const [d, t] = await Promise.all([
        text(["log", "-1", "--format=%cI", "HEAD"], [0, 128]),
        isShallow().then((sh) => (sh ? { code: 1, out: "" } : text(["describe", "--tags", "--abbrev=0", "HEAD"], [0, 128]))),
      ]);
      if (d.code !== 0 || d.out === "") return null;
      return { date: new Date(d.out).toISOString(), tag: t.code === 0 && t.out !== "" ? t.out : null };
    },
    async close() {
      batch?.close();
      batch = null;
    },
  };
}
