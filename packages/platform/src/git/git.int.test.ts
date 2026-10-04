import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MitoriError } from "@mitori/core";
import { gitBlobOid } from "../hash/digest.ts";
import { git, makeRepo, put, readerEnv } from "../test/repo.ts";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createGitReader, type PlatformGitReader } from "./index.ts";

const readers: PlatformGitReader[] = [];
afterAll(async () => {
  for (const r of readers) await r.close();
  cleanupTempDirs();
});

const enc = new TextEncoder();
const reader = (workTree: string | null, extra: { gitDir?: string } = {}) => {
  const r = createGitReader({ workTree, ...extra, env: readerEnv(tempDir()) });
  readers.push(r);
  return r;
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return MitoriError.is(e) ? e.code : String(e);
  }
};
const NFD = "enc/nfd-ファイル.md".normalize("NFD");
const NFC = "enc/nfd-ファイル.md".normalize("NFC");

describe("PLAT-I-008 GitReader (normal repo)", () => {
  test("lsFiles: -z paths with newline/space/NFD come back NFC; untracked separate; ignored hidden", async () => {
    const root = makeRepo({ "a.txt": "a\n", "d/b c.txt": "b", "nl\nname.txt": "n", [NFD]: "nfd", ".gitignore": "ignored.log\n" });
    put(root, { "new file.ts": "x", "ignored.log": "secret" });
    const r = reader(root);
    const files = await r.lsFiles();
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect([...byPath.keys()].sort()).toEqual([".gitignore", "a.txt", "d/b c.txt", NFC, "new file.ts", "nl\nname.txt"].sort());
    expect(byPath.get("a.txt")).toEqual({ path: "a.txt", blob: gitBlobOid(enc.encode("a\n"), "sha1"), mode: "100644", stage: 0, tracked: true });
    expect(byPath.get("new file.ts")).toEqual({ path: "new file.ts", blob: "", mode: "", stage: 0, tracked: false });
    expect(byPath.get(NFC)?.tracked).toBe(true);
  });

  test("status / statusDirty (porcelain v2): modified, staged, deleted, untracked; ignored excluded", async () => {
    const root = makeRepo({ "m.txt": "1", "s.txt": "1", "d.txt": "1", "keep.txt": "1", ".gitignore": "*.log\n" });
    put(root, { "m.txt": "2", "s.txt": "2", "u.txt": "u", "x.log": "ignored" });
    git(root, ["add", "s.txt"]);
    git(root, ["rm", "-q", "d.txt"]);
    const r = reader(root);
    const st = await r.status();
    expect(st.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "d.txt", xy: "D." },
      { path: "m.txt", xy: ".M" },
      { path: "s.txt", xy: "M." },
      { path: "u.txt", xy: "??" },
    ]);
    expect((await r.statusDirty()).sort()).toEqual(["d.txt", "m.txt", "s.txt", "u.txt"]);
  });

  test("conflict stages 1–3 in lsFiles; unmerged path is dirty", async () => {
    const root = makeRepo({ "c.txt": "base\n" });
    git(root, ["checkout", "-q", "-b", "other"]);
    put(root, { "c.txt": "other\n" });
    git(root, ["commit", "-q", "-am", "other"]);
    git(root, ["checkout", "-q", "main"]);
    put(root, { "c.txt": "main\n" });
    git(root, ["commit", "-q", "-am", "main"]);
    try {
      git(root, ["merge", "-q", "other"]);
    } catch {}
    const r = reader(root);
    const stages = (await r.lsFiles())
      .filter((f) => f.path === "c.txt")
      .map((f) => f.stage)
      .sort();
    expect(stages).toEqual([1, 2, 3]);
    expect(await r.statusDirty()).toContain("c.txt");
  });

  test("checkAttr: set / unset / value; unspecified omitted; empty input is free", async () => {
    const root = makeRepo({
      ".gitattributes": "gen/** linguist-generated\n*.min.js -diff linguist-vendored=true\n",
      "gen/a.ts": "",
      "x.min.js": "",
      "src/b.ts": "",
    });
    const r = reader(root);
    expect(await r.checkAttr(["gen/a.ts", "x.min.js", "src/b.ts"], ["linguist-generated", "linguist-vendored", "diff"])).toEqual({
      "gen/a.ts": { "linguist-generated": "set" },
      "x.min.js": { "linguist-vendored": "true", diff: "unset" },
    });
    expect(await r.checkAttr([], ["diff"])).toEqual({});
    expect(await codeOf(r.checkAttr(["a"], ["--all"]))).toBe("E_INVALID_INPUT");
  });

  test("catBlob: clean files from the fs, older blobs via the persistent cat-file, cache, errors", async () => {
    const root = makeRepo({ "a.txt": "v1\n", "big.bin": new Uint8Array(300_000).fill(7) });
    const r = reader(root);
    const files = await r.lsFiles();
    const v1 = files.find((f) => f.path === "a.txt")?.blob as string;
    put(root, { "a.txt": "v2 (dirty)\n" });
    expect(new TextDecoder().decode(await r.catBlob(v1))).toBe("v1\n"); // fs no longer matches → git
    const big = files.find((f) => f.path === "big.bin")?.blob as string;
    expect((await r.catBlob(big)).length).toBe(300_000);
    const again = await r.catBlob(v1);
    again[0] = 0; // callers get copies
    expect(new TextDecoder().decode(await r.catBlob(v1))).toBe("v1\n");
    const many = await Promise.all([v1, big, v1, big].map((b) => r.catBlob(b)));
    expect(many.map((b) => b.length)).toEqual([3, 300_000, 3, 300_000]);
    expect(await codeOf(r.catBlob("0".repeat(40)))).toBe("E_NOT_FOUND");
    expect(await codeOf(r.catBlob((await r.headTree()) as string))).toBe("E_INVALID_INPUT");
    expect(await codeOf(r.catBlob("HEAD:a.txt"))).toBe("E_INVALID_INPUT");
    await r.close();
    expect(new TextDecoder().decode(await r.catBlob(big)).length).toBe(300_000); // restarts after close
  });

  test("head / headTree / branch / gitDir / objectFormat; unborn and detached", async () => {
    const empty = makeRepo({}, { commit: false });
    const u = reader(empty);
    expect(await u.head()).toBeNull();
    expect(await u.headTree()).toBeNull();
    expect(await u.branch()).toBe("main");
    expect(await u.log({ limit: 10 })).toEqual([]);
    const root = makeRepo({ "a.txt": "a" });
    const r = reader(root);
    const head = (await r.head()) as string;
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(await r.headTree()).toBe(git(root, ["rev-parse", "HEAD^{tree}"]).trim());
    expect(await r.gitDir()).toBe(join(root, ".git"));
    expect(await r.objectFormat()).toBe("sha1");
    git(root, ["checkout", "-q", "--detach"]);
    expect(await r.branch()).toBeNull();
  });

  test("diffNames, log (newest first, name-only, limit, since), revCount", async () => {
    const root = makeRepo({ "a.txt": "1", "b.txt": "1" });
    const c1 = git(root, ["rev-parse", "HEAD"]).trim();
    put(root, { "a.txt": "2", "dir/new file.txt": "n" });
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "second: with spaces"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "empty"]);
    const c3 = git(root, ["rev-parse", "HEAD"]).trim();
    const r = reader(root);
    expect((await r.diffNames(c1, c3)).sort()).toEqual(["a.txt", "dir/new file.txt"]);
    const log = await r.log({ limit: 10 });
    expect(log.map((e) => e.subject)).toEqual(["empty", "second: with spaces", "initial"]);
    expect(log[0]?.paths).toEqual([]);
    expect(log[1]?.paths.sort()).toEqual(["a.txt", "dir/new file.txt"]);
    expect(log[2]?.paths.sort()).toEqual(["a.txt", "b.txt"]);
    expect(log[0]?.sha).toBe(c3);
    expect(log[0]?.date).toMatch(/^2026-01-01T\d\d:\d\d:\d\d\.000Z$/);
    expect((await r.log({ limit: 1 })).length).toBe(1);
    expect(await r.log({ limit: 10, sinceDays: 0 })).toEqual([]); // fixture commits are in 2026-01-01
    expect(await r.revCount(c1, c3)).toBe(2);
    expect(await r.revCount(c3, c1)).toBe(0);
    expect(await r.revCount("deadbeef", c1)).toBeNull();
    expect(await codeOf(r.diffNames("--output=/tmp/x", c1))).toBe("E_INVALID_INPUT");
    expect(await r.isShallow()).toBe(false);
  });

  test("shallow clone: isShallow, empty log, revCount null", async () => {
    const src = makeRepo({ "a.txt": "1" });
    put(src, { "a.txt": "2" });
    git(src, ["commit", "-q", "-am", "two"]);
    const dst = join(tempDir(), "clone");
    git(tempDir(), ["clone", "-q", "--depth", "1", `file://${src}`, dst]);
    const r = reader(dst);
    expect(await r.isShallow()).toBe(true);
    expect(await r.log({ limit: 10 })).toEqual([]);
    const head = (await r.head()) as string;
    expect(await r.revCount(head, head)).toBeNull();
    expect((await r.lsFiles()).map((f) => f.path)).toEqual(["a.txt"]);
  });

  test("shallow detection in a linked worktree of a shallow clone (the `shallow` file is in the common dir)", async () => {
    const src = makeRepo({ "a.txt": "1" });
    put(src, { "a.txt": "2" });
    git(src, ["commit", "-q", "-am", "two"]);
    const dst = join(tempDir(), "clone");
    git(tempDir(), ["clone", "-q", "--depth", "1", `file://${src}`, dst]);
    const wt = join(tempDir(), "wt");
    git(dst, ["worktree", "add", "-q", "-b", "feature", wt]);
    const r = reader(wt);
    expect(await r.gitDir()).toBe(join(dst, ".git", "worktrees", "wt"));
    expect(await r.isShallow()).toBe(true);
    expect(await r.log({ limit: 10 })).toEqual([]);
    expect(await r.isShallow()).toBe(git(wt, ["rev-parse", "--is-shallow-repository"]).trim() === "true");
  });

  test("SEC-05: a partial clone never lazy-fetches on read (no network, repo-local sshCommand not run)", async () => {
    const src = makeRepo({ "a.txt": "v1\n" });
    const v1 = git(src, ["rev-parse", "HEAD:a.txt"]).trim();
    put(src, { "a.txt": "v2\n" });
    git(src, ["commit", "-q", "-am", "two"]);
    git(src, ["config", "uploadpack.allowfilter", "true"]);
    const dst = join(tempDir(), "partial");
    git(tempDir(), ["-c", "protocol.file.allow=always", "clone", "-q", "--filter=blob:none", `file://${src}`, dst]);
    const marker = join(tempDir(), "pwned");
    git(dst, ["config", "remote.origin.url", "ssh://git@example.invalid/x.git"]);
    git(dst, ["config", "core.sshCommand", `sh -c 'touch ${marker}; exit 1'`]);
    const r = reader(dst);
    expect(await codeOf(r.catBlob(v1))).toBe("E_NOT_FOUND"); // v1 is only on the promisor remote
    expect(existsSync(marker)).toBe(false);
    expect(new TextDecoder().decode(await r.catBlob((await r.lsFiles())[0]?.blob as string))).toBe("v2\n"); // the batch survived
    expect((await r.log({ limit: 5 })).map((e) => e.subject)).toEqual(["two", "initial"]);
    expect(existsSync(marker)).toBe(false);
  });

  test("a vanished work tree is E_NOT_FOUND (no raw errno escapes)", async () => {
    const root = makeRepo({ "a.txt": "a" });
    const r = reader(root);
    renameSync(root, join(tempDir(), "gone"));
    expect(await codeOf(r.lsFiles())).toBe("E_NOT_FOUND");
    expect(await codeOf(r.catBlob("0".repeat(40)))).toBe("E_NOT_FOUND");
  });

  test("SEC-05: a repo-local clean filter never runs during status (plain git would run it)", async () => {
    const root = makeRepo({ "a.txt": "hello\n", ".gitattributes": "*.txt filter=evil\n" });
    const marker = join(tempDir(), "pwned");
    git(root, ["config", "filter.evil.clean", `sh -c 'touch ${marker}; cat'`]);
    git(root, ["config", "filter.evil.required", "true"]);
    const later = new Date(Date.now() + 10_000);
    utimesSync(join(root, "a.txt"), later, later);
    git(root, ["status", "--porcelain"]);
    expect(existsSync(marker)).toBe(true); // control: the planted filter is live
    rmSync(marker);
    const again = new Date(Date.now() + 20_000);
    utimesSync(join(root, "a.txt"), again, again);
    const r = reader(root);
    expect(await r.status()).toEqual([]);
    expect(await r.statusDirty()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    // a config change is picked up (cache keyed by the config mtime)
    git(root, ["config", "filter.other.process", `sh -c 'touch ${marker}'`]);
    writeFileSync(join(root, ".gitattributes"), "*.txt filter=other\n");
    await r.status();
    expect(existsSync(marker)).toBe(false);
  });

  test("SEC-05: a driver named `a=b` (which `-c` would split) and a filter in an included config file never run", async () => {
    const root = makeRepo({ "a.txt": "hello\n", "b.md": "x\n", ".gitattributes": "*.txt filter=a=b\n*.md filter=inc\n" });
    const marker = join(tempDir(), "pwned");
    git(root, ["config", "filter.a=b.clean", `sh -c 'touch ${marker}; cat'`]);
    const included = join(tempDir(), "shared.gitconfig");
    writeFileSync(included, "");
    git(root, ["config", "include.path", included]);
    let n = 0;
    const touchAll = () => {
      const t = new Date(Date.now() + 10_000 * ++n);
      for (const f of ["a.txt", "b.md"]) utimesSync(join(root, f), t, t);
    };
    touchAll();
    git(root, ["status", "--porcelain"]);
    expect(existsSync(marker)).toBe(true); // control: the `a=b` driver is live for plain git
    rmSync(marker);
    const r = reader(root);
    touchAll();
    await r.status();
    expect(existsSync(marker)).toBe(false);
    // the included file gains a driver; `.git/config` (the cache key) does not change
    writeFileSync(included, `[filter "inc"]\n\tclean = sh -c 'touch ${marker}; cat'\n`);
    touchAll();
    git(root, ["status", "--porcelain"]);
    expect(existsSync(marker)).toBe(true); // control
    rmSync(marker);
    touchAll();
    expect(await r.statusDirty()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  test("SEC-05 in a linked worktree: a filter added to the main repository's config is picked up", async () => {
    const main = makeRepo({ "a.txt": "hello\n", ".gitattributes": "*.txt filter=late\n" });
    const wt = join(tempDir(), "wt");
    git(main, ["worktree", "add", "-q", "-b", "feature", wt]);
    const r = reader(wt);
    expect(await r.status()).toEqual([]); // guard cached with no drivers
    const marker = join(tempDir(), "pwned");
    git(main, ["config", "filter.late.clean", `sh -c 'touch ${marker}; cat'`]);
    const t1 = new Date(Date.now() + 30_000);
    utimesSync(join(wt, "a.txt"), t1, t1);
    git(wt, ["status", "--porcelain"]);
    expect(existsSync(marker)).toBe(true); // control: the worktree uses the main repository's config
    rmSync(marker);
    const t2 = new Date(Date.now() + 40_000);
    utimesSync(join(wt, "a.txt"), t2, t2);
    await r.status();
    expect(existsSync(marker)).toBe(false);
  });

  test("parent GIT_* variables never leak into reads", async () => {
    const root = makeRepo({ "a.txt": "a" });
    const decoy = makeRepo({ "decoy.txt": "d" });
    process.env.GIT_DIR = join(decoy, ".git");
    process.env.GIT_INDEX_FILE = join(decoy, ".git", "index");
    process.env.GIT_WORK_TREE = decoy;
    try {
      const r = reader(root);
      expect((await r.lsFiles()).map((f) => f.path)).toEqual(["a.txt"]);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_INDEX_FILE;
      delete process.env.GIT_WORK_TREE;
    }
  });
});

describe("PLAT-I-008 / CONS-27 GitReader flavours: sha256, shadow, side", () => {
  test("sha256 repository: same result shapes with 64-hex ids", async () => {
    const root = makeRepo({ "a.txt": "a\n", "d/b.txt": "b" }, { objectFormat: "sha256" });
    put(root, { "u.txt": "u" });
    const r = reader(root);
    expect(await r.objectFormat()).toBe("sha256");
    const files = await r.lsFiles();
    expect(files.map((f) => f.path).sort()).toEqual(["a.txt", "d/b.txt", "u.txt"]);
    const a = files.find((f) => f.path === "a.txt");
    expect(a?.blob).toBe(gitBlobOid(enc.encode("a\n"), "sha256"));
    expect(a?.blob).toMatch(/^[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(await r.catBlob(a?.blob as string))).toBe("a\n");
    put(root, { "a.txt": "changed" });
    expect(new TextDecoder().decode(await r.catBlob(a?.blob as string))).toBe("a\n");
    expect((await r.head())?.length).toBe(64);
    expect((await r.log({ limit: 5 }))[0]?.paths.sort()).toEqual(["a.txt", "d/b.txt"]);
  });

  test("shadow repo (GIT_DIR + GIT_WORK_TREE): same shape, every file untracked, nothing written into the dir", async () => {
    const dir = tempDir("mitori-nongit-");
    put(dir, { "app.py": "print(1)\n", "notes/メモ.md": "x", "node_modules/leftpad/index.js": "", ".venv/lib/x.py": "" });
    const shadow = join(tempDir(), "repos", "ws_x", "shadow.git");
    mkdirSync(shadow, { recursive: true });
    git(dir, ["init", "-q", "--bare", shadow]);
    git(dir, ["--git-dir", shadow, "config", "core.bare", "false"]);
    writeFileSync(join(shadow, "info", "exclude"), "node_modules/\n.venv/\n");
    const r = reader(dir, { gitDir: shadow });
    const files = await r.lsFiles();
    expect(files.map((f) => f.path).sort()).toEqual(["app.py", "notes/メモ.md"]);
    expect(files.every((f) => !f.tracked && f.blob === "" && f.stage === 0 && f.mode === "")).toBe(true);
    expect(await r.gitDir()).toBe(shadow);
    expect(await r.head()).toBeNull();
    expect((await r.statusDirty()).sort()).toEqual(["app.py", "notes/メモ.md"]);
    expect(await r.lsOthers({ directories: true })).toEqual(expect.arrayContaining(["app.py"]));
    expect(readdirSync(dir).sort()).toEqual([".venv", "app.py", "node_modules", "notes"]);
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  test("lsOthers --directory reports nested repositories as `dir/`", async () => {
    const root = makeRepo({ "a.txt": "a" });
    mkdirSync(join(root, "sub"));
    git(join(root, "sub"), ["init", "-q"]);
    put(root, { "sub/x.txt": "x", "loose/y.txt": "y" });
    const r = reader(root);
    expect((await r.lsOthers({ directories: true })).sort()).toEqual(["loose/", "sub/"]);
    expect((await r.lsOthers({ directories: false })).sort()).toEqual(["loose/y.txt", "sub/"]);
  });

  test("side repo (bare, alternates → user objects): catBlob, log, diffNames work without a work tree", async () => {
    const user = makeRepo({ "a.txt": "user content\n" });
    const blob = (await reader(user).lsFiles())[0]?.blob as string;
    const side = join(tempDir(), "side.git");
    git(user, ["init", "-q", "--bare", side]);
    writeFileSync(join(side, "objects", "info", "alternates"), `${join(user, ".git", "objects")}\n`);
    const head = git(user, ["rev-parse", "HEAD"]).trim();
    git(user, ["--git-dir", side, "update-ref", "refs/mitori/j/1/base", head]);
    git(user, ["--git-dir", side, "symbolic-ref", "HEAD", "refs/mitori/j/1/base"]);
    const r = reader(null, { gitDir: side });
    expect(new TextDecoder().decode(await r.catBlob(blob))).toBe("user content\n");
    expect(await r.head()).toBe(head);
    expect((await r.log({ limit: 5 }))[0]?.paths).toEqual(["a.txt"]);
    expect(await r.gitDir()).toBe(side);
    expect(await codeOf(r.lsFiles())).toBe("E_GIT_FAILED");
  });
});

describe("GitReader budget (MILESTONES WP-01): lsFiles 1.2k files ≤ 20 ms; shadow same shape", () => {
  test("1,200 tracked files, warm median of 7", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 1200; i++) files[`pkg${i % 30}/sub${i % 7}/file_${i}.ts`] = `export const v${i} = ${i};\n`;
    const root = makeRepo(files);
    const r = reader(root);
    await r.lsFiles();
    const ms: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const out = await r.lsFiles();
      ms.push(performance.now() - t0);
      expect(out.length).toBe(1200);
    }
    ms.sort((a, b) => a - b);
    const median = ms[3] as number;
    console.log(`lsFiles 1.2k: median ${median.toFixed(1)} ms (min ${ms[0]?.toFixed(1)}, max ${ms[6]?.toFixed(1)})`);
    // generous deadline; the warm listing is timed by bench idx.warm.rescan.s01 (bench/idx.bench.ts), load-gated
    expect(median).toBeLessThanOrEqual(1_000);

    // shadow flavour of the same tree: same entry shape (untracked)
    const shadow = join(tempDir(), "shadow.git");
    git(root, ["init", "-q", "--bare", shadow]);
    git(root, ["--git-dir", shadow, "config", "core.bare", "false"]);
    writeFileSync(join(shadow, "info", "exclude"), ".git/\n");
    const s = reader(root, { gitDir: shadow });
    const sh = await s.lsFiles();
    expect(sh.length).toBe(1200);
    expect(Object.keys(sh[0] as object).sort()).toEqual(Object.keys((await r.lsFiles())[0] as object).sort());
  });
});
