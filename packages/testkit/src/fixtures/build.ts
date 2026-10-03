// Deterministic fixture construction (testing spec §2.2): copy → generate → git history with fixed identity/dates →
// symlinks → dirty state. Fixture trees are stored WITHOUT .git; they become git repos only here, at test time.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { GitOid, RepoPath, Xxh3 } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import type { FixtureName, FixtureRepo } from "../contract.ts";
import { generate } from "./generators.ts";
import { type FixtureSpec, fixtureDir, readSpec, safeName } from "./spec.ts";

/** Step k is committed at 2026-01-01T00:00:00Z + k minutes (unix seconds). */
const EPOCH = 1767225600;
/** Entries of the fixture directory that describe the build and are never copied into the working tree. */
const BUILD_ONLY = new Set(["fixture.json", "history", "dirty"]);

const GIT_ENV_BASE = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "mitori fixture",
  GIT_AUTHOR_EMAIL: "fixture@mitori.invalid",
  GIT_COMMITTER_NAME: "mitori fixture",
  GIT_COMMITTER_EMAIL: "fixture@mitori.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

function git(cwd: string, args: readonly string[], step = 0): string {
  const date = `@${EPOCH + step * 60} +0000`;
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: cwd, ...GIT_ENV_BASE, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (r.status !== 0) throw new MitoriError("E_GIT_FAILED", `git ${args.join(" ")} failed: ${r.stderr.trim()}`, { params: { cwd } });
  return r.stdout;
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (BUILD_ONLY.has(entry)) continue;
    cpSync(join(from, entry), join(to, entry), { recursive: true, verbatimSymlinks: true, force: true });
  }
}

function put(root: string, rel: RepoPath, data: string | Uint8Array): void {
  const abs = safeJoin(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}

/** Join a repo-relative path onto `root`, rejecting absolute paths and `..` traversal. */
function safeJoin(root: string, rel: RepoPath): string {
  const n = normalize(rel);
  if (isAbsolute(rel) || n === ".." || n.startsWith(`..${sep}`)) throw new MitoriError("E_PATH_OUTSIDE", `path escapes the fixture root: ${rel}`);
  return join(root, n);
}

function applyPatch(root: string, file: string): void {
  const r = spawnSync("git", ["apply", "--whitespace=nowarn", file], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...GIT_ENV_BASE } });
  if (r.status !== 0) throw new MitoriError("E_PATCH_APPLY", `cannot apply ${file}: ${r.stderr.trim()}`);
}

function makeSymlink(root: string, rel: RepoPath, target: string): void {
  const abs = safeJoin(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  symlinkSync(target, abs);
}

/** Copy the step-0 tree, run generators and create tracked symlinks. */
function prepareTree(name: FixtureName, spec: FixtureSpec, root: string): void {
  copyTree(fixtureDir(name), root);
  for (const g of spec.generate) put(root, g.path, generate(g));
  for (const s of spec.symlinks) if (s.tracked !== false) makeSymlink(root, s.path, s.target);
}

function applyDirty(name: FixtureName, spec: FixtureSpec, root: string): void {
  for (const d of spec.dirty) {
    if (d.patch) applyPatch(root, join(fixtureDir(name), d.patch));
    for (const u of d.untracked ?? []) put(root, u, readFileSync(join(fixtureDir(name), "dirty/untracked", u)));
  }
}

/**
 * The working tree of a fixture at `step` (0-based history step; default = last) without a `.git`: used where only
 * file content matters (truth consistency). `"dirty"` additionally applies the uncommitted state.
 */
export function materializeTree(name: FixtureName, opts: { step?: number | "dirty"; into: string }): FixtureSpec {
  const spec = readSpec(name);
  const last = spec.history.length - 1;
  const upTo = opts.step === undefined || opts.step === "dirty" ? last : opts.step;
  if (!Number.isInteger(upTo) || upTo < 0 || upTo > last) throw new MitoriError("E_INVALID_INPUT", `fixture ${name} has no history step ${String(opts.step)}`);
  prepareTree(name, spec, opts.into);
  for (let k = 1; k <= upTo; k++) applyPatch(opts.into, join(fixtureDir(name), spec.history[k]?.patch ?? ""));
  if (opts.step === "dirty") applyDirty(name, spec, opts.into);
  for (const s of spec.symlinks) if (s.tracked === false) makeSymlink(opts.into, s.path, s.target);
  return spec;
}

/** xxh3-64 of a buffer as 16 hex chars. */
const xxh3 = (data: Uint8Array | string): Xxh3 => Bun.hash.xxHash3(data).toString(16).padStart(16, "0");

/** Volatile git internals that change without the repository changing (index stat cache, reflogs, FETCH_HEAD). */
const DIGEST_SKIP = new Set([".git/index", ".git/FETCH_HEAD", ".git/gc.log", ".git/logs"]);

function digestTree(root: string): Xxh3 {
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel)).sort()) {
      const r = rel === "" ? entry : `${rel}/${entry}`;
      if (DIGEST_SKIP.has(r)) continue;
      const abs = join(root, r);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) lines.push(`${r}\0link\0${xxh3(readlinkSync(abs))}`);
      else if (st.isDirectory()) walk(r);
      else lines.push(`${r}\0${(st.mode & 0o777).toString(8)}\0${xxh3(readFileSync(abs))}`);
    }
  };
  walk("");
  return xxh3(lines.join("\n"));
}

/**
 * Materialize a fixture into a fresh temp dir. Git fixtures get the whole history as commits on `main` (so
 * `commits` is always complete); `opts.step` then checks that step out (detached). `"dirty"` = tip + the
 * uncommitted/untracked state of `fixture.json`.
 */
export async function build(name: FixtureName, opts: { step?: number | "dirty"; into?: string } = {}): Promise<FixtureRepo> {
  const spec = readSpec(name);
  const base = opts.into ?? mkdtempSync(join(tmpdir(), "mitori-fx-"));
  mkdirSync(base, { recursive: true });
  const root = join(realpathSync(base), safeName(name));
  if (existsSync(root)) throw new MitoriError("E_PRECONDITION", `fixture target already exists: ${root}`);
  const commits: GitOid[] = [];
  const dir = fixtureDir(name);

  prepareTree(name, spec, root);
  if (spec.git) {
    git(root, ["init", "-q", "-b", spec.branch, `--object-format=${spec.objectFormat}`]);
    for (const [k, h] of spec.history.entries()) {
      if (k > 0) applyPatch(root, join(dir, h.patch ?? ""));
      git(root, ["add", "-A"], k);
      git(root, ["commit", "-q", "--allow-empty-message", "-m", h.message], k);
      commits.push(git(root, ["rev-parse", "HEAD"]).trim());
    }
  }
  for (const s of spec.symlinks) if (s.tracked === false) makeSymlink(root, s.path, s.target);
  if (opts.step === "dirty") applyDirty(name, spec, root);

  const repo: FixtureRepo = {
    name,
    root,
    git: spec.git,
    commits,
    async checkout(step) {
      const sha = commits[step];
      if (!spec.git || sha === undefined) throw new MitoriError("E_INVALID_INPUT", `fixture ${name} has no history step ${step}`);
      git(root, ["checkout", "-q", "-f", "--detach", sha]);
    },
    async write(path, content) {
      put(root, path, content);
    },
    async digest() {
      return digestTree(root);
    },
    async dispose() {
      rmSync(opts.into ? root : base, { recursive: true, force: true });
    },
  };
  if (typeof opts.step === "number" && opts.step !== commits.length - 1) await repo.checkout(opts.step);
  return repo;
}
