// The process-free answers of the GitReader (perf): HEAD from the ref files agrees with `rev-parse HEAD^{commit}` for
// branches (loose and packed), detached HEADs, unborn branches and linked worktrees, and gives up on what it cannot
// decide; the one-process tagged listing equals the two listings it replaces, adversarial file names included.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, makeRepo, put, readerEnv } from "../test/repo.ts";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createGitReader, type PlatformGitReader } from "./index.ts";
import { headFromFiles, parseTaggedListing } from "./local.ts";
import { nfc, splitZ } from "./run.ts";

const readers: PlatformGitReader[] = [];
afterAll(async () => {
  for (const r of readers) await r.close();
  cleanupTempDirs();
});
const reader = (workTree: string) => {
  const r = createGitReader({ workTree, env: readerEnv(tempDir()) });
  readers.push(r);
  return r;
};
const revParse = (cwd: string) => {
  try {
    return git(cwd, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).trim();
  } catch {
    return null;
  }
};
const dirs = (cwd: string) => ({
  gitDir: git(cwd, ["rev-parse", "--absolute-git-dir"]).trim(),
  common: resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]).trim()),
});

describe("headFromFiles ≡ rev-parse HEAD^{commit}", () => {
  test("loose branch, packed branch, detached, unborn", async () => {
    const root = makeRepo({ "a.txt": "a" });
    const { gitDir, common } = dirs(root);
    const r = reader(root);
    expect(headFromFiles(gitDir, common)).toBe(revParse(root) as string);
    expect(await r.head()).toBe(revParse(root));

    git(root, ["pack-refs", "--all"]);
    expect(headFromFiles(gitDir, common)).toBe(revParse(root) as string);

    put(root, { "b.txt": "b" });
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "second"]); // loose ref again, newer than the packed one
    expect(headFromFiles(gitDir, common)).toBe(revParse(root) as string);
    expect(await r.head()).toBe(revParse(root));

    git(root, ["checkout", "-q", "--detach", "HEAD~1"]);
    expect(headFromFiles(gitDir, common)).toBe(revParse(root) as string);

    git(root, ["checkout", "-q", "--orphan", "fresh"]);
    expect(headFromFiles(gitDir, common)).toBeNull();
    expect(await r.head()).toBeNull();
  });

  test("a linked worktree: HEAD in its own git dir, the branch in the common dir", async () => {
    const root = makeRepo({ "a.txt": "a" });
    const wt = join(tempDir(), "wt");
    git(root, ["worktree", "add", "-q", "-b", "side", wt]);
    put(wt, { "w.txt": "w" });
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-q", "-m", "on side"]);
    const { gitDir, common } = dirs(wt);
    expect(gitDir).not.toBe(common);
    expect(headFromFiles(gitDir, common)).toBe(revParse(wt) as string);
    expect(await reader(wt).head()).toBe(revParse(wt));
  });

  test("undecidable shapes defer to git: symbolic chains, reftable, garbage", () => {
    const d = tempDir();
    mkdirSync(join(d, "refs", "heads"), { recursive: true });
    writeFileSync(join(d, "HEAD"), "ref: refs/heads/a\n");
    writeFileSync(join(d, "refs", "heads", "a"), "ref: refs/heads/b\n");
    expect(headFromFiles(d, d)).toBeUndefined();
    writeFileSync(join(d, "HEAD"), "ref: refs/heads/.invalid\n");
    expect(headFromFiles(d, d)).toBeUndefined();
    writeFileSync(join(d, "HEAD"), "ref: refs/heads/../../config\n");
    expect(headFromFiles(d, d)).toBeUndefined();
    writeFileSync(join(d, "HEAD"), "not a ref\n");
    expect(headFromFiles(d, d)).toBeUndefined();
    writeFileSync(join(d, "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(d, "reftable"));
    expect(headFromFiles(d, d)).toBeUndefined();
  });
});

describe("one-process tagged listing", () => {
  test("equals `--cached -s` + `--others`, an untracked file named like a stage line stays untracked", async () => {
    const root = makeRepo({ "a.txt": "a\n", "d/b c.txt": "b", ".gitignore": "*.log\n" });
    const fake = "100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0\tfake.txt";
    put(root, { [fake]: "x", "new.ts": "n", "x.log": "ignored" });
    const listed = await reader(root).lsFiles();
    const cached = splitZ(new TextEncoder().encode(git(root, ["ls-files", "-z", "-s", "--cached"]))).map((l) => nfc(l.slice(l.indexOf("\t") + 1)));
    const others = splitZ(new TextEncoder().encode(git(root, ["ls-files", "-z", "--others", "--exclude-standard"])));
    expect(listed.filter((e) => e.tracked).map((e) => e.path)).toEqual(cached);
    expect(
      listed
        .filter((e) => !e.tracked)
        .map((e) => e.path)
        .sort(),
    ).toEqual([...others].sort());
    expect(listed.find((e) => e.path === fake)).toEqual({ path: fake, blob: "", mode: "", stage: 0, tracked: false });
    expect(parseTaggedListing(["H 100644 abc 0\tx", "? y", "", "?"])).toEqual([
      { path: "x", blob: "abc", mode: "100644", stage: 0, tracked: true },
      { path: "y", blob: "", mode: "", stage: 0, tracked: false },
    ]);
  });
});
