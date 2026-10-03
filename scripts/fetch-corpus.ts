// `bun scripts/fetch-corpus.ts [--only a,b] [--verify [--strict]] [--from dir[,dir]] [--cache dir] [--update-lock]`
// Shallow-clones the pinned benchmark/eval corpus (testing spec 2.7, bench/corpus.lock.json) into
// ~/.cache/mitori-corpus/<name>@<sha12>/ (never into the repository) and verifies it against the lock.
//   (default)        fetch what is missing or does not verify
//   --verify         check that every fetched corpus is exactly the pinned commit + tree and has no local changes;
//                    corpora that were never fetched are reported, and fail only with --strict
//   --from a,b       look for a local clone `<dir>/<name>` before going to the network (offline machines, CI caches)
//   --update-lock    write the tree / content hashes that the lock does not know yet (only fills nulls, never replaces)
//   --only a,b       restrict to some corpora (e.g. `--only crit,flask`, what the PR CI fetches)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { renderJson } from "./budgets-merge.ts";
import { ROOT } from "./lib/repo.ts";

export const LOCK_PATH = "bench/corpus.lock.json";

export interface CorpusEntry {
  name: string;
  url: string;
  /** Pinned commit (40 hex). Null only for an entry that is pinned by `tag` and not resolved yet. */
  commit: string | null;
  /** Release tag to resolve into `commit` (the Go standard library is pinned by tag, then by hash). */
  tag?: string;
  /** `git rev-parse <commit>^{tree}`; filled by --update-lock. */
  tree: string | null;
  /** Clone depth (crit needs 41 commits for the anchor history replay). */
  depth: number;
  /** Fetched by the PR CI job. */
  ci?: boolean;
  /** Export only this directory (gostd: `src`) as a plain, git-less directory. */
  subdir?: string;
  /** Directory names left out of the export (gostd: `testdata`). */
  exclude?: string[];
  /** sha256 over the exported files; filled by --update-lock (exported corpora only). */
  contentHash?: string | null;
  role: string;
}

export interface CorpusLock {
  v: "mitori.corpus-lock/1";
  repos: CorpusEntry[];
}

const SHA = /^[0-9a-f]{40}$/;

/** Shape problems of the lock itself (also run by --verify). */
export function lintLock(lock: CorpusLock): string[] {
  const out: string[] = [];
  if (lock.v !== "mitori.corpus-lock/1") out.push(`"v" must be "mitori.corpus-lock/1"`);
  const dirs = new Set<string>();
  for (const e of lock.repos) {
    const p = (m: string) => out.push(`${e.name}: ${m}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.name)) p("name must be a lower-case slug");
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(e.url)) p("url must be an https github.com repository");
    if (e.commit !== null && !SHA.test(e.commit)) p("commit must be 40 hex characters or null");
    if (e.commit === null && !e.tag) p("an entry without a commit needs a tag to resolve");
    if (e.tree !== null && !SHA.test(e.tree)) p("tree must be 40 hex characters or null");
    if (!Number.isInteger(e.depth) || e.depth < 1) p("depth must be a positive integer");
    if (e.contentHash != null && !/^[0-9a-f]{64}$/.test(e.contentHash)) p("contentHash must be 64 hex characters");
    const dir = cacheName(e);
    if (dirs.has(dir)) p(`cache directory ${dir} is not unique`);
    dirs.add(dir);
  }
  return out;
}

/** `<name>@<sha12>` (or `<name>@<tag>` while a tag-pinned entry has no commit yet). */
export const cacheName = (e: { name: string; commit: string | null; tag?: string | undefined }): string =>
  `${e.name}@${e.commit ? e.commit.slice(0, 12) : (e.tag ?? "unpinned")}`;

export function defaultCacheRoot(env: Record<string, string | undefined> = process.env): string {
  return env.MITORI_CORPUS_DIR ?? join(homedir(), ".cache", "mitori-corpus");
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_LFS_SKIP_SMUDGE: "1",
  LC_ALL: "C",
};

function git(cwd: string, args: readonly string[], opts: { allowFile?: boolean } = {}): string {
  const protocols = opts.allowFile ? ["-c", "protocol.file.allow=always"] : ["-c", "protocol.file.allow=never"];
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false", ...protocols, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...GIT_ENV },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/** sha256 over (relative path, file sha256) of every file and symlink below `dir`, in path order. */
export function contentHash(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel === "" ? name : `${rel}/${name}`;
      const abs = join(dir, r);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) lines.push(`${r}\0link:${readlinkSync(abs)}`);
      else if (st.isDirectory()) walk(r);
      else lines.push(`${r}\0${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
    }
  };
  walk("");
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export type VerifyStatus = "ok" | "missing" | "mismatch" | "unresolved";

export interface Verdict {
  status: VerifyStatus;
  detail: string;
}

/** Compare one fetched corpus with the lock. */
export function verifyEntry(e: CorpusEntry, cacheRoot: string): Verdict {
  if (e.commit === null) return { status: "unresolved", detail: `tag ${e.tag} is not resolved to a commit yet (fetch --only ${e.name} --update-lock)` };
  const dir = join(cacheRoot, cacheName(e));
  if (!existsSync(dir)) return { status: "missing", detail: "not fetched" };
  if (e.subdir) {
    if (!e.contentHash) return { status: "unresolved", detail: "no contentHash in the lock yet (fetch --update-lock)" };
    const actual = contentHash(dir);
    return actual === e.contentHash
      ? { status: "ok", detail: `content ${actual.slice(0, 12)}` }
      : { status: "mismatch", detail: `content hash ${actual.slice(0, 12)} != ${e.contentHash.slice(0, 12)}` };
  }
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  if (head !== e.commit) return { status: "mismatch", detail: `HEAD ${head.slice(0, 12)} != pinned ${e.commit.slice(0, 12)}` };
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"]).trim();
  if (e.tree === null) return { status: "unresolved", detail: "no tree hash in the lock yet (fetch --update-lock)" };
  if (tree !== e.tree) return { status: "mismatch", detail: `tree ${tree.slice(0, 12)} != ${e.tree.slice(0, 12)}` };
  const dirty = git(dir, ["status", "--porcelain", "--untracked-files=all"]).trim();
  if (dirty) return { status: "mismatch", detail: `working tree has local changes (${dirty.split("\n").length} paths)` };
  return { status: "ok", detail: `commit ${head.slice(0, 12)}, tree ${tree.slice(0, 12)}` };
}

export interface FetchOptions {
  cacheRoot: string;
  /** Directories that may contain a local clone `<dir>/<name>`. */
  from: readonly string[];
}

/** Where to fetch from: a local clone if one is available, else the https URL. */
function sourceOf(e: CorpusEntry, from: readonly string[]): { source: string; local: boolean } {
  for (const dir of from) {
    const candidate = join(resolve(dir), e.name);
    if (existsSync(candidate)) return { source: candidate, local: true };
  }
  return { source: e.url, local: false };
}

export interface Fetched {
  commit: string;
  tree: string;
  contentHash?: string;
}

/** Fetch one corpus into the cache (atomic: a temp dir is renamed into place). */
export function fetchEntry(e: CorpusEntry, opts: FetchOptions): Fetched {
  mkdirSync(opts.cacheRoot, { recursive: true });
  const tmp = join(opts.cacheRoot, `.tmp-${e.name}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const { source, local } = sourceOf(e, opts.from);
    const net = { allowFile: local };
    git(tmp, ["init", "-q"]);
    git(tmp, ["remote", "add", "origin", source]);
    let commit = e.commit;
    if (commit === null) {
      const ref = `refs/tags/${e.tag}`;
      const listed = git(tmp, ["ls-remote", "origin", ref, `${ref}^{}`], net)
        .trim()
        .split("\n")
        .filter(Boolean);
      const peeled = listed.find((l) => l.endsWith("^{}")) ?? listed[0];
      commit = peeled?.split("\t")[0] ?? null;
      if (commit === null || !SHA.test(commit)) throw new Error(`${e.name}: cannot resolve tag ${e.tag} at ${source}`);
    }
    const filter = local ? [] : ["--filter=blob:none"];
    git(tmp, ["fetch", "-q", "--depth", String(e.depth), ...filter, "origin", commit], net);
    git(tmp, ["checkout", "-q", "--detach", "FETCH_HEAD"], net);
    const head = git(tmp, ["rev-parse", "HEAD"]).trim();
    if (head !== commit) throw new Error(`${e.name}: fetched ${head} but the lock pins ${commit}`);
    const tree = git(tmp, ["rev-parse", "HEAD^{tree}"]).trim();
    const final = join(opts.cacheRoot, cacheName({ name: e.name, commit, tag: e.tag }));
    rmSync(final, { recursive: true, force: true });
    if (!e.subdir) {
      renameSync(tmp, final);
      return { commit, tree };
    }
    const sub = join(tmp, e.subdir);
    if (!existsSync(sub)) throw new Error(`${e.name}: ${e.subdir}/ is not in ${commit}`);
    cpSync(sub, final, { recursive: true, filter: (src) => !(e.exclude ?? []).includes(src.split("/").at(-1) ?? "") });
    return { commit, tree, contentHash: contentHash(final) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ParsedArgs {
  only: string[] | null;
  verify: boolean;
  strict: boolean;
  from: string[];
  cache: string | null;
  updateLock: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const value = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    if (at < 0) return null;
    const v = argv[at + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const list = (s: string | null) => (s === null ? [] : s.split(",").filter(Boolean));
  const known = new Set(["--only", "--verify", "--strict", "--from", "--cache", "--update-lock"]);
  for (const a of argv) if (a.startsWith("--") && !known.has(a)) throw new Error(`unknown flag ${a}`);
  const only = value("--only");
  return {
    only: only === null ? null : list(only),
    verify: argv.includes("--verify"),
    strict: argv.includes("--strict"),
    from: [...list(value("--from")), ...list(process.env.MITORI_CORPUS_FROM ?? null)],
    cache: value("--cache"),
    updateLock: argv.includes("--update-lock"),
  };
}

function readLock(): CorpusLock {
  return JSON.parse(readFileSync(join(ROOT, LOCK_PATH), "utf8")) as CorpusLock;
}

/** Fill the hashes the lock does not know yet; never replaces a known value. Returns true when something changed. */
export function fillLock(entry: CorpusEntry, got: Fetched): boolean {
  let changed = false;
  if (entry.commit === null) {
    entry.commit = got.commit;
    changed = true;
  }
  if (entry.tree === null) {
    entry.tree = got.tree;
    changed = true;
  }
  if (entry.subdir && !entry.contentHash && got.contentHash) {
    entry.contentHash = got.contentHash;
    changed = true;
  }
  return changed;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const lock = readLock();
  const problems = lintLock(lock);
  for (const p of problems) console.error(`${LOCK_PATH}: ${p}`);
  if (problems.length) return 1;

  const cacheRoot = resolve(args.cache ?? defaultCacheRoot());
  const names = new Set(lock.repos.map((r) => r.name));
  for (const o of args.only ?? []) if (!names.has(o)) throw new Error(`--only ${o}: not in ${LOCK_PATH} (${[...names].join(", ")})`);
  const selected = lock.repos.filter((r) => args.only === null || args.only.includes(r.name));
  let failed = 0;

  if (args.verify) {
    const verdicts = selected.map((e) => ({ e, v: verifyEntry(e, cacheRoot) }));
    for (const { e, v } of verdicts) console.log(`${v.status.padEnd(10)} ${cacheName(e).padEnd(26)} ${v.detail}`);
    const count = (...s: VerifyStatus[]) => verdicts.filter(({ v }) => s.includes(v.status)).length;
    const absent = count("missing", "unresolved");
    const required = args.strict || args.only !== null;
    failed = count("mismatch") + (required ? absent : 0);
    const note = absent && !required ? `, ${absent} not fetched or unresolved (--strict or --only requires them)` : "";
    console.log(`fetch-corpus --verify: ${count("ok")} ok, ${failed} failed${note}`);
    return failed ? 1 : 0;
  }

  let lockChanged = false;
  for (const e of selected) {
    const before = verifyEntry(e, cacheRoot);
    if (before.status === "ok") {
      console.log(`ok      ${cacheName(e).padEnd(26)} already fetched`);
      continue;
    }
    try {
      const t0 = performance.now();
      const got = fetchEntry(e, { cacheRoot, from: args.from });
      if (args.updateLock && fillLock(e, got)) lockChanged = true;
      console.log(
        `fetched ${cacheName({ name: e.name, commit: got.commit, tag: e.tag }).padEnd(26)} tree ${got.tree.slice(0, 12)} (${Math.round(performance.now() - t0)} ms)`,
      );
    } catch (err) {
      failed++;
      console.error(`failed  ${e.name}: ${(err as Error).message}`);
    }
  }
  if (lockChanged) {
    writeFileSync(join(ROOT, LOCK_PATH), `${renderJson(lock)}\n`);
    console.log(`${LOCK_PATH}: updated`);
  }
  console.log(
    `fetch-corpus: ${failed ? `${failed} failed` : "ok"} (cache ${relative(homedir(), cacheRoot).startsWith("..") ? cacheRoot : `~/${relative(homedir(), cacheRoot)}`})`,
  );
  return failed ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`fetch-corpus: ${(err as Error).message}`);
    process.exit(2);
  }
}
