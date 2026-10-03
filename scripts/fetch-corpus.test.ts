import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CorpusEntry, type CorpusLock, cacheName, contentHash, fetchEntry, fillLock, lintLock, parseArgs, verifyEntry } from "./fetch-corpus.ts";
import { ROOT } from "./lib/repo.ts";

const run = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

let work = "";
let upstream = "";
let head = "";
const cache = () => join(work, "cache");

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "mitori-corpus-test-"));
  upstream = join(work, "from", "demo");
  mkdirSync(join(upstream, "src/pkg/testdata"), { recursive: true });
  run(upstream, "init", "-q", "-b", "main");
  writeFileSync(join(upstream, "README.md"), "demo\n");
  writeFileSync(join(upstream, "src/pkg/a.go"), "package pkg\n");
  writeFileSync(join(upstream, "src/pkg/testdata/big.txt"), "fixture data\n");
  run(upstream, "add", "-A");
  run(upstream, "commit", "-q", "-m", "one");
  writeFileSync(join(upstream, "src/pkg/b.go"), "package pkg\n\nfunc B() {}\n");
  run(upstream, "add", "-A");
  run(upstream, "commit", "-q", "-m", "two");
  run(upstream, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  head = run(upstream, "rev-parse", "HEAD");
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const entry = (over: Partial<CorpusEntry> = {}): CorpusEntry => ({
  name: "demo",
  url: "https://github.com/example/demo",
  commit: head,
  tree: null,
  depth: 1,
  role: "test",
  ...over,
});
const opts = () => ({ cacheRoot: cache(), from: [join(work, "from")] });

describe("fetch-corpus", () => {
  test("the committed lock is well formed and pins the spec's SHAs (testing spec 2.7)", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "bench/corpus.lock.json"), "utf8")) as CorpusLock;
    expect(lintLock(lock)).toEqual([]);
    const sha = Object.fromEntries(lock.repos.map((r) => [r.name, r.commit]));
    expect(sha.flask).toBe("d73fa1cdcbd8b1465c151db8924ba58b1dd14e35");
    expect(sha.react).toBe("7c6ac13e19fef500b7f669a16bbd01ecc95965ca");
    expect(sha.crit).toBe("406875dd31e0eacc9af33b7643d54100620e8775");
    expect(lock.repos.map((r) => r.name)).toEqual(["flask", "ripgrep", "hono", "excalidraw", "fastapi", "react", "crit", "m3e-canvas", "gostd"]);
    expect(lock.repos.filter((r) => r.ci).map((r) => r.name)).toEqual(["flask", "crit"]);
    expect(lock.repos.find((r) => r.name === "crit")?.depth).toBe(41);
  });

  test("lintLock rejects malformed entries and clashing cache directories", () => {
    const bad: CorpusLock = {
      v: "mitori.corpus-lock/1",
      repos: [
        entry({ commit: "abc" }),
        entry({ name: "x y", url: "http://example.com/a" }),
        entry({ commit: null }),
        entry({ name: "dup" }),
        entry({ name: "dup" }),
      ],
    };
    const msgs = lintLock(bad).join("\n");
    expect(msgs).toContain("commit must be 40 hex");
    expect(msgs).toContain("name must be a lower-case slug");
    expect(msgs).toContain("url must be an https github.com repository");
    expect(msgs).toContain("needs a tag to resolve");
    expect(msgs).toContain("cache directory dup@");
  });

  test("fetch → verify: pinned commit and tree match, a local change or a wrong tree does not", () => {
    const e = entry();
    expect(verifyEntry(e, cache()).status).toBe("missing");
    const got = fetchEntry(e, opts());
    expect(got.commit).toBe(head);
    expect(verifyEntry(e, cache())).toMatchObject({ status: "unresolved" }); // tree not in the lock yet
    expect(fillLock(e, got)).toBe(true);
    expect(fillLock(e, { ...got, tree: "0".repeat(40) })).toBe(false); // never replaces a known value
    expect(verifyEntry(e, cache()).status).toBe("ok");

    writeFileSync(join(cache(), cacheName(e), "README.md"), "changed\n");
    expect(verifyEntry(e, cache())).toMatchObject({ status: "mismatch", detail: expect.stringContaining("local changes") });
    rmSync(join(cache(), cacheName(e)), { recursive: true, force: true });
    fetchEntry(e, opts());
    expect(verifyEntry({ ...e, tree: "1".repeat(40) }, cache())).toMatchObject({ status: "mismatch", detail: expect.stringContaining("tree") });
  });

  test("a tag-pinned entry with a subdir becomes a plain directory without the excluded dirs; its content hash is verified", () => {
    const e = entry({ name: "stdlib", commit: null, tag: "v1.0.0", subdir: "src", exclude: ["testdata"], contentHash: null });
    mkdirSync(join(work, "from"), { recursive: true });
    Bun.spawnSync(["ln", "-s", upstream, join(work, "from", "stdlib")]);
    const got = fetchEntry(e, opts());
    expect(got.commit).toBe(head);
    expect(got.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const dir = join(cache(), `stdlib@${head.slice(0, 12)}`);
    expect(readFileSync(join(dir, "pkg/b.go"), "utf8")).toContain("func B()");
    expect(
      Bun.spawnSync(["ls", join(dir, "pkg")])
        .stdout.toString()
        .trim()
        .split("\n"),
    ).toEqual(["a.go", "b.go"]);
    expect(contentHash(dir)).toBe(got.contentHash as string);

    expect(verifyEntry(e, cache()).status).toBe("unresolved"); // commit still null in the lock
    expect(fillLock(e, got)).toBe(true);
    expect(verifyEntry(e, cache()).status).toBe("ok");
    writeFileSync(join(dir, "pkg/a.go"), "package changed\n");
    expect(verifyEntry(e, cache()).status).toBe("mismatch");
  });

  test("parseArgs", () => {
    expect(parseArgs([])).toMatchObject({ only: null, verify: false, strict: false, from: [], cache: null, updateLock: false });
    expect(parseArgs(["--only", "crit,flask", "--verify", "--strict", "--from", "/a,/b", "--cache", "/c", "--update-lock"])).toEqual({
      only: ["crit", "flask"],
      verify: true,
      strict: true,
      from: ["/a", "/b"],
      cache: "/c",
      updateLock: true,
    });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["--only"])).toThrow(/needs a value/);
  });
});
