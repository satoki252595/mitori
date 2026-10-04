// loop.* / git.* / mcp.* — the review-loop budgets (loop spec §0.3, bench/budgets/loop.json):
// - loop.threadCreate: `POST /ws/:ws/threads` against the in-process daemon (the real composition of test/int/harness.ts)
// - loop.bundle: an M-tier bundle (3 anchors, REL, RULES, threads) over go-small — the WP-08a golden case `batch3`
// - git.*: the git safety layer with the production adapters on a local clone of crit (1.2k files, the "≤ 2k files"
//   class): snapshot + worktree, merge pre-check, accept of a 5-file change (undone after each run, untimed)
// - mcp.init: a cold `mitori mcp` process answering `initialize` (the compiled binary when dist/ has a current one)
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretScanner, DEFAULT_DENY_GLOBS, type JobId, type ThreadDetail, type WorkspaceInfo, type WorkspaceKey } from "@mitori/core";
import { createFsReader, createGitReader, createHasher, createSafeWriter, createSpawner, systemClock } from "@mitori/platform";
import { createTestLogger, memDb } from "@mitori/platform/testing";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { createBundleBuilder } from "../packages/loop/src/bundle/index.ts";
import { CASES, goSmallWorld } from "../packages/loop/src/bundle/test/cases.ts";
import { createGitSafety, type GitSafetyHandle } from "../packages/loop/src/git/safety.ts";
import { serialQueue } from "../packages/loop/src/git/test/world.ts";
import { LOOP_MIGRATIONS } from "../packages/loop/src/review/index.ts";
import { type Int, startInt } from "../test/int/harness.ts";
import { RETRY_ANCHOR, RETRY_FILE } from "../test/int/router.ts";
import { REPO_ROOT, scratch } from "./lib/child.ts";
import { type BenchContext, defineBench } from "./runner/define.ts";

/* ------------------------------------------------------------------------------------------- thread create */

export const threadCreate = defineBench<{ int: Int; repo: FixtureRepo; ws: WorkspaceKey; n: number }>({
  id: "loop.threadCreate",
  suite: "loop",
  mode: "inproc",
  runs: 30,
  async setup() {
    const repo = await buildFixture("go-small");
    const int = await startInt();
    const ws = (await int.open(repo.root)).ws;
    return { int, repo, ws, n: 0 };
  },
  async run(s) {
    const t0 = performance.now();
    const th = await s.int.json<ThreadDetail>("POST", `/ws/${s.ws}/threads`, {
      anchor: { primary: "code", code: { path: RETRY_FILE, start: RETRY_ANCHOR.start, end: RETRY_ANCHOR.end } },
      intent: "question",
      body: `この再試行はどう動く？ (${++s.n})`,
      draft: false,
    });
    const ms = performance.now() - t0;
    if (!th.id.startsWith("th_")) throw new Error("no thread created");
    return ms;
  },
  async teardown(s) {
    await s.int.close();
    await s.repo.dispose();
  },
});

/* ------------------------------------------------------------------------------------------------- bundle */

export const bundleM = defineBench<{ builder: ReturnType<typeof createBundleBuilder>; w: ReturnType<typeof goSmallWorld>; run: (typeof CASES)[number]["run"] }>(
  {
    id: "loop.bundle",
    suite: "loop",
    mode: "inproc",
    budgetStat: "p95",
    runs: 100,
    warmup: 10,
    setup() {
      const w = goSmallWorld();
      const c = CASES.find((x) => x.name === "batch3");
      if (!c) throw new Error("the bundle case batch3 is gone");
      return { builder: createBundleBuilder(w.deps), w, run: c.run };
    },
    run: (s) => s.run(s.builder, s.w),
  },
);

/* ---------------------------------------------------------------------------------------------------- git */

interface GitBench {
  root: string;
  git: GitSafetyHandle;
  dispose(): Promise<void>;
  n: number;
}

const FILES = ["internal/diff/diff.go", "internal/config/config.go", "internal/auth/auth.go", "internal/comment/types.go", "cmd/crit/cli_dispatch.go"];
let jobSeq = 0;
const newJob = () => `j_${String(++jobSeq).padStart(10, "0")}` as JobId;

/** A local clone of crit (its own .git: the user's repository of the bench) behind the production git safety layer. */
async function gitBench(ctx: BenchContext): Promise<GitBench> {
  if (!ctx.repo) throw new Error("crit is not resolved");
  const tmp = scratch("git");
  const root = join(tmp.dir, "crit");
  const run = (cwd: string, ...a: string[]) => {
    const r = Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
    if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
  };
  run(tmp.dir, "clone", "-q", "--local", "--no-hardlinks", ctx.repo, root);
  const userHome = realpathSync(mkdtempSync(join(tmpdir(), "mitori-bench-user-")));
  writeFileSync(join(userHome, ".gitconfig"), "[user]\n\tname = Bench\n\temail = bench@example.invalid\n[commit]\n\tgpgsign = false\n");
  const home = join(tmp.dir, "home");
  mkdirSync(home); // MITORI_HOME: the safety layer creates repos/<ws>/side.git below it
  const env = { PATH: process.env.PATH, HOME: userHome };
  const db = memDb(LOOP_MIGRATIONS);
  const git = createGitSafety({
    ws: { key: "ws_bench00000001" as WorkspaceInfo["key"], root: realpathSync(root), kind: "git" },
    home: realpathSync(home),
    spawner: createSpawner(),
    env,
    fs: createFsReader(),
    safeWrite: createSafeWriter(),
    hasher: createHasher(),
    random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
    clock: systemClock,
    trust: () => "pending",
    blobReader: (gitDir) => createGitReader({ workTree: null, gitDir, env }),
    log: createTestLogger(),
    db,
    write: serialQueue(),
    secrets: createSecretScanner(),
    deny: () => [...DEFAULT_DENY_GLOBS],
  });
  return {
    root,
    git,
    n: 0,
    async dispose() {
      await git.close();
      db.close();
      tmp.dispose();
      rmSync(userHome, { recursive: true, force: true });
    },
  };
}

/** A job whose head edits `files` (one line appended to each) on a fresh snapshot of the working tree. */
async function job(b: GitBench, files: readonly string[]): Promise<{ job: JobId; base: string }> {
  const s = await b.git.snapshot([...DEFAULT_DENY_GLOBS]);
  const id = newJob();
  const edits: Record<string, string> = {};
  for (const f of files) {
    const oid = (await b.git.ws.lsTree(s.commit, [f]))[0]?.oid;
    if (!oid) throw new Error(`crit changed: ${f} is gone`);
    edits[f] = `${await b.git.blobText(oid)}\n// bench ${id}\n`;
  }
  await b.git.buildTree(id, s.commit, edits);
  return { job: id, base: s.commit };
}

/** snapshot (dirty tree ⇒ a new snapshot commit) + a full worktree of it; the worktree is removed afterwards, untimed. */
export const snapshotWorktree = defineBench<GitBench>({
  id: "git.snapshotWorktree",
  suite: "loop",
  mode: "inproc",
  repo: "crit",
  runs: 10,
  warmup: 1,
  setup: gitBench,
  async run(b) {
    writeFileSync(join(b.root, "BENCH-NOTE.md"), `run ${++b.n}\n`); // the snapshot is not reusable: real work every run
    const id = newJob();
    const t0 = performance.now();
    const s = await b.git.snapshot([...DEFAULT_DENY_GLOBS]);
    await b.git.createWorktree(id, s.commit, { dependencyLinks: false });
    const ms = performance.now() - t0;
    await b.git.removeWorktree(id);
    return ms;
  },
  teardown: (b) => b.dispose(),
});

export const precheck = defineBench<GitBench & { job: JobId }>({
  id: "git.precheck",
  suite: "loop",
  mode: "inproc",
  repo: "crit",
  runs: 15,
  async setup(ctx) {
    const b = await gitBench(ctx);
    return { ...b, job: (await job(b, FILES.slice(0, 1))).job };
  },
  // awaited: `void precheck()` timed only the start of the call (0.75 ms in the first baseline) and left the git
  // calls running into the teardown, where they failed ("git not found on PATH" = the removed cwd)
  async run(b) {
    const r = await b.git.precheck(b.job, { accept: "all" });
    if (!r.clean) throw new Error(`the pre-check of a clean 1-file change reported conflicts: ${r.conflicts.join(", ")}`);
  },
  teardown: (b) => b.dispose(),
});

/** Accept of a 5-file change into the working tree (uncommitted); undone after every run so the next starts clean. */
export const accept = defineBench<GitBench>({
  id: "git.accept",
  suite: "loop",
  mode: "inproc",
  repo: "crit",
  runs: 10,
  warmup: 1,
  setup: gitBench,
  async run(b) {
    const j = await job(b, FILES);
    const t0 = performance.now();
    const r = await b.git.accept(j.job, { accept: "all" }, { autoCommit: null, writeScope: [...FILES] });
    const ms = performance.now() - t0;
    if (r.files.length !== FILES.length) throw new Error(`accept wrote ${r.files.length} of ${FILES.length} files`);
    await b.git.undo(r.checkpoint.id, false);
    return ms;
  },
  teardown: (b) => b.dispose(),
});

/* ---------------------------------------------------------------------------------------------------- mcp */

const BIN = join(REPO_ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const MAIN = join(REPO_ROOT, "apps/cli/src/main.ts");

/** The compiled binary when dist/ has one newer than the CLI sources' entry, else `bun apps/cli/src/main.ts` (slower). */
function mitoriArgv(): string[] {
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(MAIN).mtimeMs) return [BIN];
  return [process.execPath, MAIN];
}

export const mcpInit = defineBench<{ argv: string[]; cwd: { dir: string; dispose(): void } }>({
  id: "mcp.init",
  suite: "loop",
  mode: "process",
  runs: 10,
  setup: () => ({ argv: mitoriArgv(), cwd: scratch("mcp") }),
  async run(s, ctx) {
    const p = Bun.spawn([...s.argv, "mcp"], {
      cwd: s.cwd.dir,
      env: { ...process.env, MITORI_HOME: ctx.home },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    const t0 = performance.now();
    p.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", clientInfo: { name: "bench" } } })}\n`,
    );
    await p.stdin.flush();
    const reader = p.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const ms = performance.now() - t0;
    p.stdin.end();
    await p.exited;
    if (!out.includes('"serverInfo"')) throw new Error(`mcp did not answer initialize: ${out.slice(0, 200)}`);
    return ms;
  },
  teardown: (s) => s.cwd.dispose(),
});
