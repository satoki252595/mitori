// Reads this project's repo; side objects live only in a temporary private MITORI_HOME.
// Default: gh auth/API are read-only and push/PR are recorded. --publish is an explicitly authorized
// own-repository probe of the product's real side-repo export; it never forks or changes the user's Git metadata.
import { strict as assert } from "node:assert";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakeSpawner } from "@mitori/agent/testing";
import { createSecretScanner, DEFAULT_DENY_GLOBS, type JobId, MitoriError, type WorkspaceInfo } from "@mitori/core";
import { createFsReader, createGitReader, createHasher, createSafeWriter, createSpawner, cryptoRandom, resolveSafePath, systemClock } from "@mitori/platform";
import { createTestLogger, memDb } from "@mitori/platform/testing";
import { createGitSafety } from "../../packages/loop/src/git/safety.ts";
import { LOOP_MIGRATIONS } from "../../packages/loop/src/review/index.ts";

const root = realpathSync(resolve(import.meta.dir, "../..")),
  home = realpathSync(mkdtempSync(join(tmpdir(), "mitori-local-pr-")));
const publish = process.argv.includes("--publish");
if (publish && process.env.MITORI_GITHUB_LIVE !== "1") throw new Error("real publication requires MITORI_GITHUB_LIVE=1");
const safePath = resolveSafePath(process.env.PATH ?? "", { workspaceRoots: [root], startCwd: root });
const gh = Bun.which("gh", { PATH: safePath });
if (!gh) throw new Error("read-only reachability probe requires gh on SAFE_PATH");
const binary = realpathSync(gh),
  real = createSpawner({ safePath }),
  fake = createFakeSpawner(),
  hashes = createHasher();
const recorded: { kind: string; gitDir?: string; argv: string[] }[] = [];
fake.script(
  () => true,
  (s) => {
    if (s.command === "git" && s.argv.includes("push")) {
      recorded.push({ kind: "push-blocked-and-recorded", gitDir: s.env.GIT_DIR, argv: s.argv });
      return { stdout: [] };
    }
    if (s.command === binary && s.argv[0] === "pr") {
      recorded.push({ kind: "pr-blocked-and-recorded", argv: s.argv });
      return { stdout: ["https://github.com/satoki252595/mitori/pull/0"] };
    }
    throw new MitoriError("E_PRECONDITION", "local probe blocks every other remote mutation, including fork");
  },
);
const db = memDb(LOOP_MIGRATIONS),
  env = { PATH: safePath, HOME: homedir() };
const git = createGitSafety({
  ws: { root, kind: "git", key: "ws_prprobe20261005" as WorkspaceInfo["key"] },
  home,
  gh: binary,
  env,
  spawner: {
    spawn(s) {
      if (s.command === binary) {
        const allowedRead = s.argv[0] === "auth" || (s.argv[0] === "api" && /^repos\/satoki252595\/mitori(?:\/git\/ref\/heads\/.*)?$/u.test(s.argv[1] ?? ""));
        if (publish && s.argv[0] === "pr" && s.argv[1] === "create" && s.argv.includes("satoki252595/mitori")) {
          recorded.push({ kind: "pr-published", argv: s.argv });
          return real.spawn(s);
        }
        return allowedRead ? real.spawn(s) : fake.spawn(s);
      }
      if (publish && s.command === "git" && s.argv.includes("push") && s.argv.includes("https://github.com/satoki252595/mitori.git")) {
        recorded.push({ kind: "push-published", gitDir: s.env.GIT_DIR, argv: s.argv });
        return real.spawn(s);
      }
      if (s.command !== "git" || ["push", "fetch", "clone"].some((a) => s.argv.includes(a))) return fake.spawn(s);
      return real.spawn(s);
    },
  },
  fs: createFsReader(),
  safeWrite: createSafeWriter(),
  hasher: hashes,
  random: cryptoRandom,
  clock: systemClock,
  trust: () => "pending",
  blobReader: (gitDir) => createGitReader({ workTree: null, gitDir, env }),
  log: createTestLogger(),
  db,
  write: async (_label, fn) => fn(),
  secrets: createSecretScanner(),
  deny: () => [...DEFAULT_DENY_GLOBS],
});
try {
  await git.ws.ready();
  const state = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          ["refs", ["for-each-ref", "--format=%(refname) %(objectname)"]],
          ["head", ["rev-parse", "HEAD"]],
          ["objects", ["count-objects", "-v"]],
          ["index", ["ls-files", "-s", "--debug"]],
          ["config", ["config", "--local", "--list"]],
          ["worktrees", ["worktree", "list", "--porcelain"]],
          ["stash", ["stash", "list"]],
        ].map(async ([name, args]) => [name, hashes.sha256((await git.ws.user(args as string[])).out)]),
      ),
    );
  const before = await state(),
    base = (await git.ws.user(["rev-parse", "origin/main"])).out.trim();
  const path = "docs/progress/pr-publication-probe.md";
  assert.equal((await git.ws.lsTree(base as never, [path as never])).length, 0, "probe path must be new at the reviewed GitHub base");
  const job = "j_prprobe0001" as JobId;
  await git.buildTree(job, base as never, {
    [path]: "# Side-repository PR export verification\n\nThis temporary draft verifies that mitori publishes an explicitly selected documentation delta from its private side repository. It changes no user Git refs, objects, index, configuration, worktrees or stash. The draft will be closed and its branch deleted after verifying the remote delta.\n",
  });
  const result = await git.createPullRequest(job, {
    title: "test: verify side-repository PR export",
    body: "Temporary own-repository verification of the product's real GitHub export. Only docs/progress/pr-publication-probe.md is published; no code or user Git metadata is changed. The draft will be closed and its branch deleted after remote verification.",
    draft: true,
    slug: "local-probe",
    threadIds: [],
    trailers: { "Co-Authored-By": "Codex <noreply@openai.com>" },
    accept: "all",
  });
  assert.equal(recorded.length, 2);
  const push = recorded.find((r) => r.kind === (publish ? "push-published" : "push-blocked-and-recorded"));
  assert.equal(push?.gitDir, git.ws.sideDir);
  const commit = push?.argv.at(-1)?.split(":")[0];
  assert.ok(commit);
  assert.deepEqual(
    (await git.ws.rawDiff(base, commit)).map((c) => c.path),
    [path],
  );
  assert.deepEqual(await state(), before, "user refs/objects/index/config/worktrees/stash must be unchanged");
  console.log(
    JSON.stringify(
      {
        repo: "satoki252595/mitori",
        readOnlyGitHubAuthAndBase: true,
        localOriginBase: base,
        sideRepoOnly: true,
        reviewedDelta: [path],
        userMetadataUnchanged: true,
        recordedPushAndPr: recorded.length,
        externalPublication: publish,
        ...(publish ? { url: result.url, branch: result.branch } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  await git.close();
  db.close();
  rmSync(home, { recursive: true, force: true });
}
