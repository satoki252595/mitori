import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpawnSpec } from "@mitori/agent";
import { createFakeSpawner } from "@mitori/agent/testing";
import type { JobId } from "@mitori/core";
import { createGitSafety } from "./safety.ts";
import { gitWorld, userRepoState } from "./test/world.ts";

test("GitHub PR publishes only the reviewed delta from side.git, preserves user objects/refs/index and rejects dirty-base edits before push", async () => {
  const w = await gitWorld("go-small");
  w.userGit(["remote", "add", "origin", "https://github.com/example/fixture.git"]);
  const parent = w.userGit(["rev-parse", "HEAD"]).trim();
  const fake = createFakeSpawner(),
    calls: SpawnSpec[] = [];
  fake.script(
    (s) => s.command === "/opt/trusted/gh",
    (s) => {
      calls.push(s);
      if (s.argv[0] === "auth") return { stdout: ["authenticated"] };
      if (s.argv[1] === "repos/example/fixture") return { stdout: ['{"push":true,"base":"main"}'] };
      if (s.argv[1]?.includes("git/ref")) return { stdout: [parent] };
      if (s.argv[0] === "pr") return { stdout: ["https://github.com/example/fixture/pull/1"] };
      throw new Error("unexpected gh call");
    },
  );
  fake.script(
    (s) => s.command === "git" && s.argv.includes("push"),
    (s) => {
      calls.push(s);
      return { stdout: [] };
    },
  );
  const git = createGitSafety({
    ...w.deps,
    gh: "/opt/trusted/gh",
    spawner: { spawn: (s) => (s.command === "/opt/trusted/gh" || s.argv.includes("push") ? fake.spawn(s) : w.deps.spawner.spawn(s)) },
  });
  try {
    writeFileSync(join(w.repo.root, "unrelated.txt"), "private uncommitted note\n");
    const before = userRepoState(w),
      s = await git.snapshot(w.deps.deny());
    const job = "j_pr00000001" as JobId;
    await git.buildTree(job, s.commit, { "README.md": "Reviewed change.\n" });
    const req = {
      title: "Reviewed change",
      body: "Human reviewed the passing gates.",
      draft: true,
      slug: "reviewed-change",
      threadIds: [],
      trailers: { "Mitori-Thread": "th_12345678" },
    };
    const r = await git.createPullRequest(job, req);
    expect(r.url).toBe("https://github.com/example/fixture/pull/1");
    const push = calls.find((c) => c.argv.includes("push"))!;
    expect(push.env.GIT_DIR).toBe(git.ws.sideDir);
    expect(push.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    const commit = push.argv.at(-1)!.split(":")[0]!;
    expect((await git.ws.lsTree(commit)).map((e) => e.path)).not.toContain("unrelated.txt");
    expect((await git.ws.rawDiff(parent, commit)).map((e) => e.path)).toEqual(["README.md"]);
    expect((await git.ws.side(["show", "-s", "--format=%P", commit])).out).toBe(parent);
    expect(userRepoState(w)).toEqual(before);
    writeFileSync(join(w.repo.root, "README.md"), "unreviewed preexisting change\n");
    const dirty = await git.snapshot(w.deps.deny());
    const job2 = "j_pr00000002" as JobId;
    await git.buildTree(job2, dirty.commit, { "README.md": "Changed from a dirty base.\n" });
    await expect(git.createPullRequest(job2, req)).rejects.toMatchObject({ code: "E_PRECONDITION" });
    expect(calls.filter((c) => c.argv.includes("push"))).toHaveLength(1);
    expect(userRepoState(w)).toEqual(before);
  } finally {
    await git.close();
    await w.dispose();
  }
});
