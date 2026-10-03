// The workspace's git context (ADR-0012): the user's repository is only READ (HEAD, index file, status, untracked
// list, attributes, config), every object / ref / temp index / worktree mitori creates lives in the side repo
// `~/.mitori/repos/<ws>/side.git` (bare, `objects/info/alternates` → the user's object DB, so the user's commits and
// blobs are visible without copying). A shadow workspace (no `.git` in the user's directory) reads its
// `~/.mitori/repos/<ws>/shadow.git` the same way (spec §7.12).
import type { Spawner } from "@mitori/agent";
import {
  type Clock,
  type FsReader,
  type GitOid,
  type Hasher,
  type Logger,
  type Metrics,
  MitoriError,
  type Random,
  type RepoPath,
  type SafeWriter,
  type Sha256,
  type WorkspaceInfo,
} from "@mitori/core";
import { type ConfigEntry, neutralizers, parseConfigList, type RepoConfig, scanConfig, trustedFilters } from "./config.ts";
import { type ConfigPair, type GitCall, GitExec, type GitOut, nfc, splitZ } from "./exec.ts";

/** Exact-bytes blob reads of one git dir (production: platform `createGitReader`, a persistent `cat-file --batch`). */
export interface BlobReader {
  /** Blob bytes. */
  catBlob(oid: GitOid): Promise<Uint8Array>;
  /** Stop the persistent process. */
  close(): Promise<void>;
}

/** Everything the git layer needs. */
export interface GitDeps {
  /** Workspace (root realpath, kind, key). */
  ws: Pick<WorkspaceInfo, "key" | "root" | "kind">;
  /** Absolute realpath of `~/.mitori`. */
  home: string;
  /** Spawner (git, gates). */
  spawner: Spawner;
  /** PATH (SAFE_PATH) and HOME for git children. */
  env: { PATH?: string | undefined; HOME?: string | undefined };
  /** Read-only fs (index copy, untracked stat/scan, working-tree bytes). */
  fs: FsReader;
  /** The only writer (`home` for side-repo files, `accept` for the user's tree). */
  safeWrite: SafeWriter;
  /** Hashing (trust hashes, reuse keys). */
  hasher: Hasher;
  /** Temp names, checkpoint ids. */
  random: Random;
  /** Timestamps. */
  clock: Clock;
  /** Trust of the command-bearing local config. */
  trust: (item: "git_config", hash: Sha256) => "trusted" | "denied" | "pending";
  /** Blob reader factory for the side repo. */
  blobReader: (gitDir: string) => BlobReader;
  /** Logger. */
  log: Logger;
  /** `loop.git.calls`. */
  metrics?: Metrics;
}

/** One `ls-tree` / `diff-tree --raw` entry. */
export interface TreeEntry {
  /** Mode (`100644`, `100755`, `120000`, `160000`). */
  mode: string;
  /** Object id. */
  oid: GitOid;
  /** Path. */
  path: RepoPath;
}

/** One `diff-tree -r --raw` entry (`oldOid` / `newOid` are null for an absent side). */
export interface RawChange {
  /** Path. */
  path: RepoPath;
  /** Old mode (`000000` when added). */
  oldMode: string;
  /** New mode (`000000` when deleted). */
  newMode: string;
  /** Old blob. */
  oldOid: GitOid | null;
  /** New blob. */
  newOid: GitOid | null;
  /** `A`, `D`, `M`, `T`. */
  status: string;
}

const ZERO_RE = /^0+$/;
const dec = new TextDecoder();

/** The workspace git context. */
export class GitWorkspace {
  readonly exec: GitExec;
  /** `~/.mitori/repos/<ws>`. */
  readonly repoDir: string;
  /** `~/.mitori/repos/<ws>/side.git`. */
  readonly sideDir: string;
  /** Workspace-relative path of the temp dir under `home` (`repos/<ws>/tmp`). */
  readonly tmpRel: string;
  /** `~/.mitori/wt/<ws>`. */
  readonly wtDir: string;
  private setup: Promise<void> | null = null;
  private userDir: { gitDir: string; commonDir: string } | null = null;
  private cfg: { key: string | null; config: RepoConfig } | null = null;
  private reader: BlobReader | null = null;
  private format: "sha1" | "sha256" = "sha1";

  constructor(readonly deps: GitDeps) {
    this.exec = new GitExec({ spawner: deps.spawner, env: deps.env, nohooks: `${deps.home}/run/nohooks`, ...(deps.metrics ? { metrics: deps.metrics } : {}) });
    this.repoDir = `${deps.home}/repos/${deps.ws.key}`;
    this.sideDir = `${this.repoDir}/side.git`;
    this.tmpRel = `repos/${deps.ws.key}/tmp`;
    this.wtDir = `${deps.home}/wt/${deps.ws.key}`;
  }

  /** Root of the user's working tree. */
  get root(): string {
    return this.deps.ws.root;
  }

  /** Object format of the user's repository. */
  get objectFormat(): "sha1" | "sha256" {
    return this.format;
  }

  /* ---- user repository (read only) ------------------------------------------------------------------------ */

  /** Shadow workspaces keep their git dir under `~/.mitori/repos/<ws>/shadow.git` (created by the indexer). */
  private shadowDir(): string | null {
    return this.deps.ws.kind === "shadow" ? `${this.repoDir}/shadow.git` : null;
  }

  /** A call against the user's repository; untrusted command-bearing keys are neutralized. */
  userCall(extra: Omit<GitCall, "cwd"> = {}): GitCall {
    const shadow = this.shadowDir();
    const call: GitCall = { cwd: this.root, ...extra };
    if (shadow) {
      call.gitDir = shadow;
      call.workTree = this.root;
    }
    const neutral =
      this.cfg && this.userDir && !this.configTrusted() ? neutralizers(this.cfg.config.commands, { defaultHooks: `${this.userDir.commonDir}/hooks` }) : [];
    if (neutral.length > 0 || extra.config) call.config = [...neutral, ...(extra.config ?? [])];
    return call;
  }

  /** A call against the side repo. `workTree` = the user's root (snapshot `add`, `hash-object`), else none. */
  sideCall(extra: Omit<GitCall, "cwd" | "gitDir"> & { cwd?: string } = {}): GitCall {
    const cfg = this.cfg?.config;
    const pairs: ConfigPair[] = [...(cfg?.mirror ?? []), ...(cfg && this.configTrusted() ? trustedFilters(cfg.commands) : []), ...(extra.config ?? [])];
    const call: GitCall = { ...extra, cwd: extra.cwd ?? this.repoDir, gitDir: this.sideDir };
    if (pairs.length > 0) call.config = pairs;
    else delete call.config;
    return call;
  }

  /** Run inside a job worktree of the side repo (its `.git` file points at `side.git/worktrees/<id>`). */
  async inWorktree(wt: string, args: readonly string[], extra: Omit<GitCall, "cwd" | "gitDir" | "workTree"> = {}): Promise<GitOut> {
    // GIT_DIR / GIT_WORK_TREE are pinned to the worktree's admin dir in side.git: git never discovers its repository
    // through `<wt>/.git`, a file that code run inside the worktree (agent edits, gates) could have replaced (WP-08c)
    const admin = await this.worktreeAdmin(wt);
    const call = this.sideCall({ ...extra, cwd: wt });
    call.gitDir = admin;
    call.workTree = wt;
    return this.exec.run(args, call);
  }

  /**
   * The side.git admin dir of a job worktree, checked both ways: its `gitdir` names `<wt>/.git`, and `<wt>/.git` is
   * still the regular file git wrote (`gitdir: <admin>`). Anything else ⇒ `E_SCOPE_VIOLATION` (the worktree was
   * tampered with; the job must not continue).
   */
  async worktreeAdmin(wt: string): Promise<string> {
    const fs = this.deps.fs;
    const text = async (abs: string): Promise<string | null> => (fs.stat(abs)?.isFile ? dec.decode(await fs.read(abs)).trim() : null);
    const same = (a: string | null, b: string) => a !== null && (a === b || (fs.realpath(a) ?? a) === (fs.realpath(b) ?? b));
    const root = `${this.sideDir}/worktrees`;
    const named = `${root}/${wt.slice(wt.lastIndexOf("/") + 1)}`;
    const candidates = [named, ...(fs.readdir(root) ?? []).map((n) => `${root}/${n}`).filter((d) => d !== named)];
    let admin: string | null = null;
    for (const d of candidates) {
      if (same(await text(`${d}/gitdir`), `${wt}/.git`)) {
        admin = d;
        break;
      }
    }
    if (!admin) throw new MitoriError("E_GIT_FAILED", "not a worktree of the side repo", { params: { worktree: wt } });
    const dotGit = fs.stat(`${wt}/.git`);
    const pointer = dotGit?.isFile && !dotGit.isSymlink ? await text(`${wt}/.git`) : null;
    if (pointer === null || !pointer.startsWith("gitdir: ") || !same(pointer.slice("gitdir: ".length), admin))
      throw new MitoriError("E_SCOPE_VIOLATION", "the job worktree's .git was changed", { params: { reason: "worktree_tampered", worktree: wt } });
    return admin;
  }

  /** Run in the user's repository. */
  user(args: readonly string[], extra: Omit<GitCall, "cwd"> = {}): Promise<GitOut> {
    return this.exec.run(args, this.userCall(extra));
  }

  /** Run in the side repo. */
  side(args: readonly string[], extra: Omit<GitCall, "cwd" | "gitDir"> & { cwd?: string } = {}): Promise<GitOut> {
    return this.exec.run(args, this.sideCall(extra));
  }

  /** The user's git dir and common dir (absolute). */
  async userDirs(): Promise<{ gitDir: string; commonDir: string }> {
    if (this.userDir) return this.userDir;
    const shadow = this.shadowDir();
    if (shadow) {
      this.userDir = { gitDir: shadow, commonDir: shadow };
      return this.userDir;
    }
    const r = await this.exec.run(["rev-parse", "--path-format=absolute", "--absolute-git-dir", "--git-common-dir"], { cwd: this.root });
    const [gitDir, commonDir] = r.out.split("\n").map((l) => l.trim());
    if (!gitDir || !commonDir) throw new MitoriError("E_GIT_FAILED", "cannot locate the git dir", { params: { root: this.root } });
    this.userDir = { gitDir, commonDir };
    return this.userDir;
  }

  /** The user's HEAD commit, or null (unborn branch / shadow repo without commits). */
  async head(): Promise<GitOid | null> {
    const r = await this.user(["rev-parse", "-q", "--verify", "--end-of-options", "HEAD^{commit}"], { ok: [0, 1, 128] });
    const oid = r.out.trim();
    return r.code === 0 && /^[0-9a-f]{40,64}$/.test(oid) ? oid : null;
  }

  /* ---- config / trust ------------------------------------------------------------------------------------- */

  /** Scan (or re-scan, when the config files changed) the user's config. */
  async config(): Promise<RepoConfig> {
    const { gitDir, commonDir } = await this.userDirs();
    const stamp = (p: string) => {
      const st = this.deps.fs.stat(p);
      return st ? `${st.size}:${st.mtimeNs}` : "-";
    };
    const key = `${stamp(`${commonDir}/config`)}|${stamp(`${gitDir}/config.worktree`)}`;
    if (this.cfg && this.cfg.key !== null && this.cfg.key === key) return this.cfg.config;
    // read with nothing neutralized: `config --list` executes nothing
    const shadow = this.shadowDir();
    const call: GitCall = shadow ? { cwd: this.root, gitDir: shadow, workTree: this.root, ok: [0, 1] } : { cwd: this.root, ok: [0, 1] };
    const r = await this.exec.run(["config", "--list", "--show-scope", "--includes", "-z"], call);
    const entries: ConfigEntry[] = parseConfigList(r.out);
    const config = scanConfig(entries, this.deps.hasher);
    const includes = entries.some((e) => (e.scope === "local" || e.scope === "worktree") && /^include(?:if\..+)?\.path$/i.test(e.key));
    this.cfg = { key: includes ? null : key, config };
    return config;
  }

  /** True when the command-bearing local config is absent or trusted. */
  configTrusted(): boolean {
    const hash = this.cfg?.config.trustHash ?? null;
    return hash === null || this.deps.trust("git_config", hash) === "trusted";
  }

  /* ---- side repo ------------------------------------------------------------------------------------------ */

  /** Create the side repo (idempotent) and scan the user's config. */
  ready(): Promise<void> {
    this.setup ??= this.init().catch((e: unknown) => {
      this.setup = null;
      throw e;
    });
    return this.setup.then(() => this.config().then(() => undefined));
  }

  private async init(): Promise<void> {
    const { commonDir } = await this.userDirs();
    const fmt = await this.exec.run(["rev-parse", "--show-object-format"], this.userCall({ ok: [0, 128] }));
    this.format = fmt.code === 0 && fmt.out.trim() === "sha256" ? "sha256" : "sha1";
    if (!this.deps.fs.stat(`${this.sideDir}/HEAD`)) {
      await this.exec.run(["init", "--bare", "-q", "--template=", `--object-format=${this.format}`, this.sideDir], { cwd: this.deps.home });
    }
    const alternates = `${commonDir}/objects\n`;
    await this.deps.safeWrite.write(this.deps.home, `repos/${this.deps.ws.key}/side.git/objects/info/alternates`, alternates, "home");
  }

  /** Exact bytes of a blob (side repo + alternates). */
  async blob(oid: GitOid): Promise<Uint8Array> {
    this.reader ??= this.deps.blobReader(this.sideDir);
    return this.reader.catBlob(oid);
  }

  /** Blob as UTF-8 text. */
  async text(oid: GitOid): Promise<string> {
    return dec.decode(await this.blob(oid));
  }

  /** Close the persistent blob reader (workspace unload). */
  async close(): Promise<void> {
    await this.reader?.close();
    this.reader = null;
  }

  /** `rev-parse --verify` in the side repo (refs, `<commit>^{tree}`); null when missing. */
  async rev(spec: string): Promise<GitOid | null> {
    const r = await this.side(["rev-parse", "-q", "--verify", "--end-of-options", spec], { ok: [0, 1, 128] });
    const oid = r.out.trim();
    return r.code === 0 && /^[0-9a-f]{40,64}$/.test(oid) ? oid : null;
  }

  /** Set a ref (side repo). */
  async updateRef(ref: string, oid: GitOid): Promise<void> {
    await this.side(["update-ref", "--no-deref", ref, oid]);
  }

  /** Delete refs (side repo, one call). */
  async deleteRefs(refs: readonly string[]): Promise<void> {
    if (refs.length === 0) return;
    await this.side(["update-ref", "--stdin", "-z"], { input: refs.map((r) => `delete ${r}\0\0`).join("") });
  }

  /** `commit-tree` (side repo, mitori identity). */
  async commitTree(tree: GitOid, parents: readonly GitOid[], message: string): Promise<GitOid> {
    const args = ["commit-tree", tree];
    for (const p of parents) args.push("-p", p);
    const r = await this.side([...args, "-F", "-"], { input: message });
    return r.out.trim();
  }

  /** Write a blob (side repo) from text that is already in blob form (no filters). */
  async hashText(text: string): Promise<GitOid> {
    const r = await this.side(["hash-object", "-w", "--no-filters", "--stdin"], { input: text });
    return r.out.trim();
  }

  /** `ls-tree -r -z` entries of a tree-ish, optionally limited to literal paths. */
  async lsTree(treeish: string, paths?: readonly RepoPath[]): Promise<TreeEntry[]> {
    const args = ["ls-tree", "-r", "-z", "--full-tree", treeish];
    if (paths) {
      if (paths.length === 0) return [];
      args.push("--", ...paths);
    }
    const r = await this.side(args, paths ? { env: { GIT_LITERAL_PATHSPECS: "1" } } : {});
    return splitZ(r.out).map((f) => {
      const tab = f.indexOf("\t");
      const [mode, , oid] = f.slice(0, tab).split(" ");
      return { mode: mode as string, oid: oid as string, path: nfc(f.slice(tab + 1)) };
    });
  }

  /** `diff-tree -r -z --raw --no-renames` between two tree-ishes (plumbing; no external diff, no textconv). */
  async rawDiff(from: string, to: string): Promise<RawChange[]> {
    const r = await this.side(["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-commit-id", from, to]);
    const f = splitZ(r.out);
    const out: RawChange[] = [];
    for (let i = 0; i + 1 < f.length; i += 2) {
      const [oldMode, newMode, oldOid, newOid, status] = (f[i] as string).replace(/^:/, "").split(" ");
      out.push({
        path: nfc(f[i + 1] as string),
        oldMode: oldMode as string,
        newMode: newMode as string,
        oldOid: oldOid && !ZERO_RE.test(oldOid) ? oldOid : null,
        newOid: newOid && !ZERO_RE.test(newOid) ? newOid : null,
        status: (status ?? "M").slice(0, 1),
      });
    }
    return out;
  }

  /**
   * Hash the CURRENT working-tree files the way `git add` would (attributes + mirrored conversion config; side repo,
   * nothing written). Absent / non-regular files ⇒ null.
   */
  async currentBlobs(paths: readonly RepoPath[]): Promise<Record<RepoPath, GitOid | null>> {
    const out: Record<RepoPath, GitOid | null> = {};
    const present: RepoPath[] = [];
    for (const p of paths) {
      const st = this.deps.fs.stat(`${this.root}/${p}`);
      if (st?.isFile) present.push(p);
      else out[p] = null;
    }
    if (present.length > 0) {
      const r = await this.side(["hash-object", "--stdin-paths"], { cwd: this.root, workTree: this.root, input: `${present.join("\n")}\n` });
      const oids = r.out.split("\n").filter((l) => l.length > 0);
      present.forEach((p, i) => {
        out[p] = oids[i] ?? null;
      });
    }
    return out;
  }

  /* ---- temp files ----------------------------------------------------------------------------------------- */

  /** A fresh temp name under `repos/<ws>/tmp/` (relative to home) and its absolute path. */
  tempPath(prefix: string): { rel: string; abs: string } {
    const hex = [...this.deps.random.bytes(8)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const rel = `${this.tmpRel}/${prefix}-${hex}`;
    return { rel, abs: `${this.deps.home}/${rel}` };
  }

  /** Remove a temp file / dir (never throws). */
  async dropTemp(rel: string): Promise<void> {
    try {
      await this.deps.safeWrite.remove(this.deps.home, rel, "home");
    } catch (e) {
      this.deps.log.warn("temp cleanup failed", { rel, error: MitoriError.from(e).message });
    }
  }

  /** Run `fn` with a temp index (`seed` bytes copied in, else empty); the file is removed afterwards. */
  async withIndex<T>(seed: Uint8Array | null, fn: (indexFile: string) => Promise<T>): Promise<T> {
    const t = this.tempPath("idx");
    // the temp dir always exists after this write (git refuses to create the index in a missing directory)
    await this.deps.safeWrite.write(this.deps.home, `${this.tmpRel}/.keep`, "", "home");
    if (seed) await this.deps.safeWrite.write(this.deps.home, t.rel, seed, "home");
    try {
      return await fn(t.abs);
    } finally {
      await this.dropTemp(t.rel);
      await this.dropTemp(`${t.rel}.lock`);
    }
  }

  /** Build a tree from `base` with path → blob replacements (null deletes) in a temp index; returns the tree. */
  async treeWith(base: GitOid | null, changes: readonly { path: RepoPath; oid: GitOid | null; mode: string }[]): Promise<GitOid> {
    return this.withIndex(null, async (indexFile) => {
      if (base) await this.side(["read-tree", base], { indexFile });
      const removes = changes.filter((c) => c.oid === null).map((c) => c.path);
      const adds = changes.filter((c) => c.oid !== null);
      if (adds.length > 0)
        await this.side(["update-index", "--add", "-z", "--index-info"], { indexFile, input: adds.map((c) => `${c.mode} ${c.oid}\t${c.path}\0`).join("") });
      if (removes.length > 0) await this.side(["update-index", "--force-remove", "-z", "--stdin"], { indexFile, input: `${removes.join("\0")}\0` });
      return (await this.side(["write-tree"], { indexFile })).out.trim();
    });
  }
}
