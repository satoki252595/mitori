// Git safety against real repositories (loop spec §7, §13.5; testing spec GIT-S-01…07, LOOP-I-030…035, RT-09/18/21/24/32).
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_REFS, type HunkId, type JobId } from "@mitori/core";
import { childEnv } from "./exec.ts";
import { type GitWorld, gitWorld, userRepoState } from "./test/world.ts";

let w: GitWorld | null = null;
const extra: string[] = [];
afterEach(async () => {
  await w?.dispose();
  w = null;
  for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FETCH = "internal/meta/fetch.go";
const README = "README.md";
let jobSeq = 0;
const newJob = () => `j_${String(++jobSeq).padStart(10, "0")}` as JobId;
const read = (p: string) => readFileSync(join((w as GitWorld).repo.root, p), "utf8");
const write = (p: string, s: string) => writeFileSync(join((w as GitWorld).repo.root, p), s);
const indexBytes = () => readFileSync(join((w as GitWorld).repo.root, ".git/index"));
const sideGit = (args: string[]) => {
  const r = spawnSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_DIR: (w as GitWorld).git.ws.sideDir } });
  return { code: r.status, out: r.stdout.trim() };
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const canary = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "mitori-canary-")));
  extra.push(d);
  return join(d, "ran");
};

/** A one-file patch job on the current working tree: snapshot S, head = S with `edit` applied to `path`. */
async function jobOn(path: string, edit: (text: string) => string): Promise<{ job: JobId; base: string; next: string }> {
  const g = (w as GitWorld).git;
  const s = await g.snapshot((w as GitWorld).deps.deny());
  const job = newJob();
  const cur = await g.blobText(((await g.ws.lsTree(s.commit, [path]))[0] as { oid: string }).oid);
  const next = edit(cur);
  await g.buildTree(job, s.commit, { [path]: next });
  return { job, base: s.commit, next };
}

describe("LOOP-I-030 / AC-L50 / GIT-S-06 snapshot reads the user's repo and writes only the side repo", () => {
  test("dirty + untracked are in the snapshot; refs, objects, worktrees, config, index and branches are unchanged", async () => {
    w = await gitWorld("go-small", { step: "dirty" });
    const before = userRepoState(w);
    const index = indexBytes();
    const s = await w.git.snapshot(w.deps.deny());
    const files = await w.git.ws.lsTree(s.commit);
    expect(files.map((f) => f.path)).toContain("notes/todo.md");
    expect(await w.git.blobText((files.find((f) => f.path === FETCH) as { oid: string }).oid)).toBe(read(FETCH));
    // reuse: nothing changed ⇒ same commit without git writes
    const again = await w.git.snapshot(w.deps.deny());
    expect(again).toMatchObject({ commit: s.commit, reused: true });
    write("notes/todo.md", "changed\n");
    expect((await w.git.snapshot(w.deps.deny())).commit).not.toBe(s.commit);
    expect(indexBytes().equals(index)).toBe(true);
    expect(userRepoState(w)).toEqual(before);
  });

  test("RT-32: untracked secrets never enter a snapshot or the side repo; the harmless control file does", async () => {
    w = await gitWorld("secrets", { step: "dirty" });
    const s = await w.git.snapshot(w.deps.deny());
    const paths = (await w.git.ws.lsTree(s.commit)).map((f) => f.path);
    expect(paths).toContain("notes/scratch.md");
    for (const p of [
      "credentials.json",
      "service-account.json",
      "prod.tfvars",
      "kubeconfig",
      "id_ecdsa",
      "deploy.ppk",
      ".docker/config.json",
      ".aws/credentials",
      ".env",
      ".env.production",
    ]) {
      expect(paths).not.toContain(p);
      const oid = w.userGit(["hash-object", "--", p]).trim();
      expect(sideGit(["cat-file", "-e", oid]).code).not.toBe(0);
    }
    expect(s.skippedUntracked).toEqual(expect.arrayContaining(["credentials.json", "prod.tfvars"]));
  });

  test("AC-L51: a tracked deny-glob file is absent from the snapshot and untouched by accept", async () => {
    w = await gitWorld("go-small");
    mkdirSync(join(w.repo.root, ".github/workflows"), { recursive: true });
    write(".github/workflows/ci.yml", "on: push\n");
    w.userGit(["add", ".github"]);
    w.userGit(["commit", "-qm", "ci"]);
    write(".github/workflows/ci.yml", "on: push\njobs: {}\n");
    const { job } = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 2"));
    const { base, head } = await w.git.commits(job);
    expect((await w.git.ws.lsTree(base)).map((f) => f.path)).not.toContain(".github/workflows/ci.yml");
    expect((await w.git.diff(job)).map((d) => d.path)).toEqual([FETCH]);
    expect(head).not.toBe(base);
    await w.git.accept(job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(".github/workflows/ci.yml")).toBe("on: push\njobs: {}\n");
  });
});

describe("LOOP-I-032 / AC-L53 scope verification", () => {
  test("README outside WRITE, deny glob, secret addition, symlink and mode change are all reported", async () => {
    w = await gitWorld("go-small");
    const s = await w.git.snapshot(w.deps.deny());
    const job = newJob();
    await w.git.buildTree(job, s.commit, {
      [README]: `${read(README)}\nmore\n`,
      [FETCH]: read(FETCH).replace("const requestTimeout", 'const awsKey = "AKIAIOSFODNN7EXAMPL3"\nconst requestTimeout'),
      ".env.local": "X=1\n",
    });
    const r = await w.git.checkScope(job, [FETCH], w.deps.deny());
    expect(r.ok).toBe(false);
    expect(r.outside).toEqual([".env.local", README]);
    expect(r.denied).toEqual([".env.local"]);
    expect(r.secrets.length).toBeGreaterThan(0);
    expect(r.secrets[0]).toMatch(/^internal\/meta\/fetch\.go:\d+:/);
    // RT-09: a symlink and an exec bit appear in an agent-style worktree
    const job2 = newJob();
    const wt = await w.git.createWorktree(job2, s.commit, { dependencyLinks: false });
    symlinkSync("/etc/passwd", join(wt.path, "internal/meta/link"));
    chmodSync(join(wt.path, "Makefile"), 0o755);
    await w.git.commitHead(job2, wt.path, 1);
    const r2 = await w.git.checkScope(job2, ["internal/meta/link", "Makefile"], w.deps.deny());
    expect(r2.modes).toEqual([
      { path: "Makefile", change: "mode" },
      { path: "internal/meta/link", change: "symlink" },
    ]);
    await w.git.removeWorktree(job2);
    expect(existsSync(wt.path)).toBe(false);
  });

  test("GIT-S-01: a global diff.external / textconv changes neither the hunks nor the secret scan", async () => {
    const marker = canary();
    w = await gitWorld("go-small", {
      gitconfig: `[diff]\n\texternal = sh -c 'touch ${marker}; echo HIJACKED'\n[diff "go"]\n\ttextconv = sh -c 'touch ${marker}; echo HIJACKED'\n`,
    });
    write(".gitattributes", "*.go diff=go\n");
    const { job } = await jobOn(FETCH, (t) =>
      t.replace("const requestTimeout", 'const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB"\nconst requestTimeout'),
    );
    const d = await w.git.diff(job);
    expect(d[0]?.hunks[0]?.lines.join("\n")).toContain('+const token = "ghp_');
    expect(JSON.stringify(d)).not.toContain("HIJACKED");
    expect((await w.git.checkScope(job, [FETCH], w.deps.deny())).secrets).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("GIT-S-02 / GIT-S-05 repository-local command config", () => {
  test("filter drivers (also one named a=b) never run before git_config is trusted; detection yields a stable trust hash", async () => {
    const marker = canary();
    w = await gitWorld("go-small");
    w.userGit(["config", "filter.evil.clean", `sh -c 'touch ${marker}-evil; cat'`]);
    w.userGit(["config", "filter.a=b.clean", `sh -c 'touch ${marker}-ab; cat'`]);
    w.userGit(["config", "diff.external", `sh -c 'touch ${marker}-diff'`]);
    write(".gitattributes", "*.go filter=evil\n*.md filter=a=b\n");
    write(FETCH, `${read(FETCH)}// dirty\n`);
    write(README, `${read(README)}dirty\n`);
    const s = await w.git.snapshot(w.deps.deny());
    expect(existsSync(`${marker}-evil`) || existsSync(`${marker}-ab`) || existsSync(`${marker}-diff`)).toBe(false);
    const t = await w.git.configTrust();
    expect(t.keys).toEqual(["diff.external", "filter.a=b.clean", "filter.evil.clean"]);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    // the neutralizers travel as GIT_CONFIG_* env (key and value separate), never as `-c`
    const env = childEnv(w.git.ws.deps, w.git.ws.userCall());
    expect(
      Object.entries(env)
        .filter(([k]) => k.startsWith("GIT_CONFIG_KEY_"))
        .map(([, v]) => v),
    ).toContain("filter.a=b.clean");
    // trusted ⇒ the user's own filter applies to mitori's `add` like it does to theirs
    w.trust.set(t.hash as string, "trusted");
    write(FETCH, `${read(FETCH)}// dirty 2\n`);
    const s2 = await w.git.snapshot(w.deps.deny());
    expect(s2.commit).not.toBe(s.commit);
    expect(existsSync(`${marker}-evil`)).toBe(true);
  });

  test("GIT-S-03 / GIT-S-04: the child env is built from empty, stdin is /dev/null, every call has a timeout", async () => {
    const env = childEnv({ env: { PATH: "/usr/bin", HOME: "/h" } }, { gitDir: "/s", indexFile: "/t/idx" });
    expect(env.GIT_INDEX_FILE).toBe("/t/idx");
    expect(Object.keys(env).sort()).toEqual(
      [
        "GIT_ATTR_NOSYSTEM",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_DIR",
        "GIT_INDEX_FILE",
        "GIT_LFS_SKIP_SMUDGE",
        "GIT_NO_LAZY_FETCH",
        "GIT_OPTIONAL_LOCKS",
        "GIT_TERMINAL_PROMPT",
        "HOME",
        "LC_ALL",
        "PATH",
      ].sort(),
    );
    // a parent GIT_INDEX_FILE / GIT_DIR never leaks into a call that did not ask for one
    process.env.GIT_INDEX_FILE = "/parent/index";
    try {
      expect(childEnv({ env: {} }, {}).GIT_INDEX_FILE).toBeUndefined();
    } finally {
      delete process.env.GIT_INDEX_FILE;
    }
    const specs: { stdin: string; keepStdinOpen: boolean; timeoutMs: number }[] = [];
    w = await gitWorld("go-small");
    const spawner = w.deps.spawner;
    const real = spawner.spawn.bind(spawner);
    spawner.spawn = ((spec) => {
      specs.push(spec);
      return real(spec);
    }) as typeof spawner.spawn;
    await w.git.snapshot(w.deps.deny());
    expect(specs.length).toBeGreaterThan(3);
    for (const s of specs) {
      expect(s.keepStdinOpen).toBe(false);
      expect(s.timeoutMs).toBeGreaterThan(0);
    }
  });
});

describe("LOOP-I-034 / AC-L54 accept and undo", () => {
  test("accept writes uncommitted with a checkpoint; undo restores byte-exactly; a later user edit is diverged unless forced", async () => {
    w = await gitWorld("go-small", { step: "dirty" });
    const original = read(FETCH);
    const { job, next } = await jobOn(FETCH, (t) => t.replace("const maxRetries = 1", "const maxRetries = 3"));
    const acc = await w.git.accept(job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(FETCH)).toBe(next);
    expect(w.userGit(["status", "--porcelain", "--", FETCH])).toBe(` M ${FETCH}\n`);
    expect(sideGit(["rev-parse", GIT_REFS.checkpoint(acc.checkpoint.id)]).out).toBe(acc.checkpoint.before);
    expect(sideGit(["rev-parse", GIT_REFS.integration]).out).toBe(acc.checkpoint.after);
    expect(acc.files).toEqual([{ path: FETCH, before: expect.any(String), after: expect.any(String), mode: "100644" }]);
    // the user edits the accepted file again ⇒ diverged, untouched
    write(FETCH, `${next}// mine\n`);
    const u1 = await w.git.undo(acc.checkpoint.id, false);
    expect(u1).toMatchObject({ restored: [], diverged: [FETCH] });
    expect(read(FETCH)).toBe(`${next}// mine\n`);
    // forced: the current state is kept as pre-force first
    const u2 = await w.git.undo(acc.checkpoint.id, true);
    expect(u2.restored).toEqual([FETCH]);
    expect(read(FETCH)).toBe(original);
    const pre = sideGit(["rev-parse", GIT_REFS.preForce(acc.checkpoint.id)]).out;
    expect(sideGit(["show", `${pre}:${FETCH}`]).out).toContain("// mine");
    expect(await codeOf(w.git.undo(acc.checkpoint.id, false))).toBe("E_PRECONDITION");
  });

  test("partial accept: one hunk now, the other later; H′ ≠ head until the last one", async () => {
    w = await gitWorld("go-small");
    const { job } = await jobOn(FETCH, (t) =>
      t.replace("// requestTimeout bounds", "// requestTimeout limits").replace("return md, nil\n}", "return md, nil // ok\n}"),
    );
    const [d] = await w.git.diff(job);
    const ids = (d?.hunks ?? []).map((h) => h.id);
    expect(ids).toHaveLength(2);
    const first = await w.git.selection(job, [ids[0] as HunkId]);
    expect(first.full).toBe(false);
    await w.git.accept(job, { accept: [ids[0] as HunkId] }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(FETCH)).toContain("// requestTimeout limits");
    expect(read(FETCH)).not.toContain("// ok");
    const all = await w.git.selection(job, ids);
    expect(all.full).toBe(true);
    await w.git.accept(job, { accept: ids }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(FETCH)).toContain("return md, nil // ok");
  });

  test("auto-commit: one commit with trailers (user hooks run); undo reverts it with a new commit", async () => {
    w = await gitWorld("go-small");
    const marker = canary();
    // the default hooks dir always runs; a local core.hooksPath (command-bearing) only once git_config is trusted
    w.userGit(["config", "core.hooksPath", ".githooks"]);
    for (const [dir, tag] of [
      [".githooks", "redirected"],
      [".git/hooks", "default"],
    ] as const) {
      mkdirSync(join(w.repo.root, dir), { recursive: true });
      write(`${dir}/pre-commit`, `#!/bin/sh\ntouch ${marker}-${tag}\n`);
      chmodSync(join(w.repo.root, dir, "pre-commit"), 0o755);
    }
    const { job } = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 4"));
    const acc = await w.git.accept(
      job,
      { accept: "all" },
      { autoCommit: { message: "meta: configurable retries\n", trailers: { "Mitori-Thread": "th_00000001" } }, writeScope: [FETCH] },
    );
    expect(acc.checkpoint.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(`${marker}-default`)).toBe(true);
    expect(existsSync(`${marker}-redirected`)).toBe(false);
    expect(w.userGit(["log", "-1", "--format=%B"])).toContain("Mitori-Thread: th_00000001");
    expect(w.userGit(["status", "--porcelain", "--", FETCH])).toBe("");
    const u = await w.git.undo(acc.checkpoint.id, false);
    expect(u.restored).toEqual([FETCH]);
    expect(w.userGit(["log", "-1", "--format=%B"])).toContain(`Mitori-Undo: ${acc.checkpoint.id}`);
    expect(read(FETCH)).toContain("maxRetries = 1");
    const t = await w.git.configTrust();
    w.trust.set(t.hash as string, "trusted");
    const j2 = await jobOn(FETCH, (s) => s.replace("maxRetries = 1", "maxRetries = 5"));
    await w.git.accept(j2.job, { accept: "all" }, { autoCommit: { message: "again\n", trailers: {} }, writeScope: [FETCH] });
    expect(existsSync(`${marker}-redirected`)).toBe(true);
  });
});

describe("LOOP-I-033 / AC-L55 / RT-21 merge pre-check and TOCTOU", () => {
  test("two jobs on the same line: the second accept is E_GIT_MERGE_CONFLICT; different hunks merge", async () => {
    w = await gitWorld("go-small");
    const a = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 2"));
    const b = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 5"));
    const c = await jobOn(FETCH, (t) => t.replace("return md, nil\n}", "return md, nil // c\n}"));
    await w.git.accept(a.job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    const pre = await w.git.precheck(b.job, { accept: "all" });
    expect(pre).toMatchObject({ clean: false, conflicts: [FETCH] });
    expect(await codeOf(w.git.accept(b.job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] }))).toBe("E_GIT_MERGE_CONFLICT");
    await w.git.accept(c.job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(FETCH)).toContain("maxRetries = 2");
    expect(read(FETCH)).toContain("// c");
  });

  test("a save right before the write is re-snapshotted and merged, never overwritten; endless churn ⇒ E_GIT_DIVERGED", async () => {
    w = await gitWorld("go-small");
    const { job } = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 2"));
    const g = w.git.ws;
    const real = g.currentBlobs.bind(g);
    let saves = 0;
    g.currentBlobs = async (paths) => {
      if (saves++ === 0) write(FETCH, read(FETCH).replace("// Package meta", "// Package meta (saved)"));
      return real(paths);
    };
    await w.git.accept(job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    expect(read(FETCH)).toContain("(saved)");
    expect(read(FETCH)).toContain("maxRetries = 2");
    const j2 = await jobOn(FETCH, (t) => t.replace("return md, nil\n}", "return md, nil // two\n}"));
    let n = 0;
    g.currentBlobs = async (paths) => {
      write(FETCH, read(FETCH).replace(/\/\/ churn \d+\n|$/, `// churn ${n++}\n`));
      return real(paths);
    };
    expect(await codeOf(w.git.accept(j2.job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] }))).toBe("E_GIT_DIVERGED");
    expect(read(FETCH)).not.toContain("// two");
  });
});

describe("RT-18 / AC-L56 hooks", () => {
  test("husky / core.hooksPath / .git/hooks never run during snapshot, worktree, head commit, accept", async () => {
    w = await gitWorld("go-small");
    const marker = canary();
    w.userGit(["config", "core.hooksPath", ".husky"]);
    mkdirSync(join(w.repo.root, ".husky"));
    for (const hook of ["pre-commit", "post-checkout", "post-index-change", "reference-transaction", "pre-auto-gc"]) {
      for (const dir of [".husky", ".git/hooks"]) {
        write(`${dir}/${hook}`, `#!/bin/sh\ntouch ${marker}\n`);
        chmodSync(join(w.repo.root, dir, hook), 0o755);
      }
    }
    const { job, base } = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 2"));
    const wt = await w.git.createWorktree(newJob(), base, { dependencyLinks: false });
    writeFileSync(join(wt.path, FETCH), "x\n");
    await w.git.accept(job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    expect(existsSync(marker)).toBe(false);
  });
});

describe("GIT-S-07 / SEC-08 the user's worktree admin survives", () => {
  test("a prunable user worktree is still registered after job worktrees were created, removed and gc'd", async () => {
    w = await gitWorld("go-small");
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "mitori-userwt-")));
    extra.push(outside);
    w.userGit(["worktree", "add", "-q", join(outside, "mine"), "HEAD"]);
    rmSync(join(outside, "mine"), { recursive: true, force: true });
    const before = w.userGit(["worktree", "list", "--porcelain"]);
    expect(before).toContain("prunable");
    const s = await w.git.snapshot(w.deps.deny());
    const job = newJob();
    await w.git.createWorktree(job, s.commit, { dependencyLinks: false });
    await w.git.removeWorktree(job);
    await w.git.gc([]);
    expect(w.userGit(["worktree", "list", "--porcelain"])).toBe(before);
    expect(existsSync(join(w.repo.root, ".git/worktrees"))).toBe(true);
  });
});

describe("LOOP-I-035 shadow repo, remote-readonly export, gc, crash recovery", () => {
  test("AC-L61: a directory without git (shadow.git) snapshots, accepts and undoes without creating .git", async () => {
    w = await gitWorld("nongit");
    const shadow = join(w.git.ws.repoDir, "shadow.git");
    const env = { ...process.env, GIT_DIR: shadow, GIT_WORK_TREE: w.repo.root };
    spawnSync("git", ["init", "--bare", "-q", shadow], { env: process.env });
    spawnSync("git", ["add", "-A"], { cwd: w.repo.root, env });
    spawnSync("git", ["commit", "-qm", "baseline"], { cwd: w.repo.root, env });
    const target = (spawnSync("git", ["-c", "core.quotepath=off", "ls-files"], { cwd: w.repo.root, env, encoding: "utf8" })
      .stdout.split("\n")
      .find((p) => p.endsWith(".md")) ?? "") as string;
    expect(target).not.toBe("");
    const original = read(target);
    const { job } = await jobOn(target, (t) => `${t}追記\n`);
    const acc = await w.git.accept(job, { accept: "all" }, { autoCommit: null, writeScope: [target] });
    expect(read(target)).toBe(`${original}追記\n`);
    await w.git.undo(acc.checkpoint.id, false);
    expect(read(target)).toBe(original);
    expect(existsSync(join(w.repo.root, ".git"))).toBe(false);
  });

  test("AC-L60: exportPatch writes a secret-scanned .patch with trailers and leaves the tree alone", async () => {
    w = await gitWorld("go-small");
    const before = read(FETCH);
    const { job } = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 6"));
    const file = await w.git.exportPatchWith(
      job,
      { accept: "all" },
      { message: "meta: six retries\n", trailers: { "Mitori-Agent": "claude-cli/claude-sonnet-5-5" } },
    );
    expect(file).toBe(join(w.deps.home, "repos", w.deps.ws.key, "patches", `${job}.patch`));
    const text = readFileSync(file, "utf8");
    expect(text).toContain("Subject: [PATCH] meta: six retries");
    expect(text).toContain("Mitori-Agent: claude-cli/claude-sonnet-5-5");
    expect(text).toContain("+const maxRetries = 6");
    expect(read(FETCH)).toBe(before);
    const secret = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", 'maxRetries = 1\nconst k = "AKIAIOSFODNN7EXAMPL3"'));
    expect(await codeOf(w.git.exportPatchWith(secret.job, { accept: "all" }, { message: "x\n", trailers: {} }))).toBe("E_SECRET_DETECTED");
  });

  test("gc removes worktrees of inactive jobs and keeps fresh refs; recoverAccept sorts out interrupted journals", async () => {
    w = await gitWorld("go-small");
    const s = await w.git.snapshot(w.deps.deny());
    const keep = newJob();
    const drop = newJob();
    const wtKeep = await w.git.createWorktree(keep, s.commit, { dependencyLinks: false });
    const wtDrop = await w.git.createWorktree(drop, s.commit, { dependencyLinks: false });
    expect(await w.git.gc([keep])).toEqual({ worktrees: 1, refs: 0 });
    expect(existsSync(wtKeep.path)).toBe(true);
    expect(existsSync(wtDrop.path)).toBe(false);
    expect(sideGit(["rev-parse", GIT_REFS.jobBase(drop)]).code).toBe(0);

    // completed: files are at `after`, journal still says writing
    const a = await jobOn(FETCH, (t) => t.replace("maxRetries = 1", "maxRetries = 7"));
    const acc = await w.git.accept(a.job, { accept: "all" }, { autoCommit: null, writeScope: [FETCH] });
    w.deps.db.run("UPDATE job_checkpoints SET state = 'writing', after = '' WHERE id = ?", [acc.checkpoint.id]);
    expect(await w.git.recoverAccept(acc.checkpoint.id)).toBe("completed");
    expect(w.git.journal.get(acc.checkpoint.id)?.state).toBe("done");
    // not applied: files are back at `before`
    await w.git.undo(acc.checkpoint.id, false);
    w.deps.db.run("UPDATE job_checkpoints SET state = 'writing', undone_at = NULL WHERE id = ?", [acc.checkpoint.id]);
    expect(await w.git.recoverAccept(acc.checkpoint.id)).toBe("not_applied");
    expect(w.git.journal.get(acc.checkpoint.id)).toBeNull();
    // mixed: two files, one written ⇒ rolled back to before
    const b = await (async () => {
      const g = (w as GitWorld).git;
      const snap = await g.snapshot((w as GitWorld).deps.deny());
      const job = newJob();
      await g.buildTree(job, snap.commit, { [FETCH]: read(FETCH).replace("maxRetries = 1", "maxRetries = 8"), [README]: `${read(README)}x\n` });
      return job;
    })();
    const acc2 = await w.git.accept(b, { accept: "all" }, { autoCommit: null, writeScope: [FETCH, README] });
    const readmeAfter = read(README);
    w.userGit(["checkout", "--", README]);
    w.deps.db.run("UPDATE job_checkpoints SET state = 'writing' WHERE id = ?", [acc2.checkpoint.id]);
    expect(await w.git.recoverAccept(acc2.checkpoint.id)).toBe("rolled_back");
    expect(read(FETCH)).toContain("maxRetries = 1");
    expect(read(README)).not.toBe(readmeAfter);
  });

  test("F1 remainder: escaping tracked symlinks are never checked out, yet stay in the head commit; dependency links come and go", async () => {
    w = await gitWorld("go-small");
    const root = w.repo.root;
    const outsideFile = join(realpathSync(mkdtempSync(join(tmpdir(), "mitori-outside-"))), "secret.txt");
    extra.push(join(outsideFile, ".."));
    writeFileSync(outsideFile, "TOP SECRET\n");
    symlinkSync(outsideFile, join(root, "abs"));
    symlinkSync("../../../etc", join(root, "climb"));
    symlinkSync("abs", join(root, "chain"));
    symlinkSync(".git/config", join(root, "gitcfg"));
    symlinkSync(README, join(root, "inside"));
    w.userGit(["add", "abs", "climb", "chain", "gitcfg", "inside"]);
    w.userGit(["commit", "-q", "-m", "symlinks"]);
    writeFileSync(join(root, ".git/info/exclude"), "node_modules/\n");
    mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules/pkg/index.js"), "x\n");
    const s = await w.git.snapshot(w.deps.deny());
    const job = newJob();
    const wt = await w.git.createWorktree(job, s.commit, { dependencyLinks: false });
    const present = (p: string) => {
      try {
        return lstatSync(join(wt.path, p)).isSymbolicLink() ? "link" : "file";
      } catch {
        return "absent";
      }
    };
    expect(["abs", "climb", "chain", "gitcfg", "inside", "node_modules"].map(present)).toEqual(["absent", "absent", "absent", "absent", "link", "absent"]);
    // the head commit of an untouched worktree is the base tree: nothing was "deleted"
    writeFileSync(join(wt.path, FETCH), `${read(FETCH)}// x\n`);
    const head = await w.git.commitHead(job, wt.path, 1);
    const tree = (await w.git.ws.lsTree(head)).map((f) => f.path);
    for (const p of ["abs", "climb", "chain", "gitcfg", "inside"]) expect(tree).toContain(p);
    expect((await w.git.diffCommits(s.commit, head)).map((f) => f.path)).toEqual([FETCH]);
    // the gates' links: made, then dropped again (the user's real directory is untouched)
    expect(await w.git.linkDependencies(job)).toEqual(["node_modules"]);
    expect(present("node_modules")).toBe("link");
    expect((await w.git.diffCommits(s.commit, await w.git.commitHead(job, wt.path, 2))).map((f) => f.path)).toEqual([FETCH]);
    await w.git.unlinkDependencies(job);
    expect(present("node_modules")).toBe("absent");
    expect(readFileSync(join(root, "node_modules/pkg/index.js"), "utf8")).toBe("x\n");
  });

  test("RT-24 / SEC-18: LFS pointers and filter / working-tree-encoding paths are unwritable", async () => {
    w = await gitWorld("go-small");
    write("big.bin", readFileSync(join(import.meta.dir, "../../../../fixtures/injection/RT-24-lfs-pointer.txt"), "utf8"));
    write(".gitattributes", "*.dat filter=lfs\nlatin.txt working-tree-encoding=ISO-8859-1\n");
    write("x.dat", "data\n");
    write("latin.txt", "abc\n");
    w.userGit(["add", "big.bin", "x.dat", "latin.txt", ".gitattributes"]);
    w.userGit(["-c", "filter.lfs.clean=cat", "commit", "-qm", "lfs"]);
    const blobOf = (p: string) => w?.userGit(["rev-parse", `HEAD:${p}`]).trim() ?? null;
    expect(await w.git.unwritable(["big.bin", "x.dat", "latin.txt", FETCH], blobOf)).toEqual(["big.bin", "latin.txt", "x.dat"]);
    expect(statSync(join(w.repo.root, "big.bin")).size).toBeLessThan(200);
  });
});
