import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureRepo } from "../../src/contract.ts";
import { buildFixture } from "../../src/fixtures/index.ts";
import { fixtureDir } from "../../src/fixtures/spec.ts";

const repos: FixtureRepo[] = [];
const build = async (...args: Parameters<typeof buildFixture>) => {
  const r = await buildFixture(...args);
  repos.push(r);
  return r;
};
afterEach(async () => {
  for (const r of repos.splice(0)) await r.dispose();
});

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  return new TextDecoder().decode(r.stdout).trimEnd();
};

describe("fixtures: buildFixture (testing spec 2.2)", () => {
  test("go-small is a git repo with three deterministic commits on main", async () => {
    const repo = await build("go-small");
    expect(repo.git).toBe(true);
    expect(repo.commits).toHaveLength(3);
    expect(git(repo.root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo.root, "log", "--format=%an <%ae> %aI %s", "--reverse").split("\n")).toEqual([
      "mitori fixture <fixture@mitori.invalid> 2026-01-01T00:00:00Z init: tsundoku service",
      "mitori fixture <fixture@mitori.invalid> 2026-01-01T00:01:00Z meta: retry a failed lookup exactly once",
      "mitori fixture <fixture@mitori.invalid> 2026-01-01T00:02:00Z server: paginate GET /api/books",
    ]);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
    // build-only entries are never copied
    for (const f of ["fixture.json", "history", "dirty"]) expect(existsSync(join(repo.root, f))).toBe(false);
  });

  test("the same fixture built twice has the same commit ids; they match fixtures/golden/<name>/commits.json", async () => {
    const [a, b] = [await build("go-small"), await build("go-small")];
    expect(a.root).not.toBe(b.root);
    expect(a.commits).toEqual(b.commits);
    const golden = JSON.parse(readFileSync(join(fixtureDir("go-small"), "../../golden/go-small/commits.json"), "utf8"));
    expect(golden.commits).toEqual(a.commits);
  });

  test("checkout(step) moves the working tree through history; digest tracks every change incl. untracked files", async () => {
    const repo = await build("go-small");
    const tip = await repo.digest();
    expect(await repo.digest()).toBe(tip);

    await repo.checkout(0);
    expect(existsSync(join(repo.root, "internal/meta/fetch_test.go"))).toBe(false);
    expect(await repo.digest()).not.toBe(tip);
    await repo.checkout(2);
    expect(await repo.digest()).not.toBe(tip); // same files, but HEAD is now detached
    git(repo.root, "checkout", "-q", "main");
    expect(await repo.digest()).toBe(tip);

    await repo.write("notes/new.txt", "untracked");
    expect(await repo.digest()).not.toBe(tip);
    await expect(repo.checkout(3)).rejects.toThrow(/no history step 3/);
  });

  test("step: 'dirty' adds one uncommitted change and one untracked file on top of the tip", async () => {
    const repo = await build("go-small", { step: "dirty" });
    expect(git(repo.root, "status", "--porcelain").split("\n").sort()).toEqual([" M internal/meta/fetch.go", "?? notes/"]);
    expect(readFileSync(join(repo.root, "notes/todo.md"), "utf8")).toContain("maxRetries");
  });

  test("step: n checks that commit out (detached); write() refuses paths outside the root", async () => {
    const repo = await build("go-small", { step: 1 });
    expect(git(repo.root, "rev-parse", "HEAD")).toBe(repo.commits[1] as string);
    await expect(repo.write("../escape.txt", "x")).rejects.toThrow(/escapes/);
    await expect(repo.write("/etc/escape.txt", "x")).rejects.toThrow(/escapes/);
  });

  test("dispose removes the temp dir; unknown fixtures are E_NOT_FOUND", async () => {
    const repo = await buildFixture("ts-small");
    await repo.dispose();
    expect(existsSync(repo.root)).toBe(false);
    await expect(buildFixture("does-not-exist" as never)).rejects.toThrow(/no fixture/);
  });
});
