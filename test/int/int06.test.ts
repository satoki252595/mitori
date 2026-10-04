// INT-06 (MILESTONES §5, M3; demo script §8.1 steps 1–4): open go-small → a thread anchored to the retry code → Explain
// (answer mode) → Fix "make the retry count configurable" (patch mode, a valid patch/1 from the scenario engine) →
// gofmt gate (trust, then run) → accept → the change is in the working tree UNCOMMITTED while the user's repository
// (refs, objects, index, config, worktrees) is untouched → Undo restores the exact original bytes. Then the Pull round of
// `mitori review`: Finish(pull) → wait → bundle → reply → complete.
// The engine is the REAL claude-cli engine, normalizer, scheduler and ledger behind a scripted `claude` (no tokens, no
// network); git, gofmt and the filesystem are real.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import {
  type AcceptRes,
  API_PREFIX,
  type Checkpoint,
  type CreateJobReq,
  type Job,
  type JobDetail,
  type JobEstimate,
  type JobId,
  type JobState,
  type ReviewWaitRes,
  type Round,
  type RoundChanges,
  type RoundUndoRes,
  type ThreadDetail,
  type ThreadSummary,
  type TrustRequest,
  type UndoRes,
  type UnixMs,
  type UsageSummary,
  type WorkspaceKey,
} from "@mitori/core";
import { REVIEW_EXIT } from "@mitori/loop";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { runCommand } from "../../apps/cli/src/commands/index.ts";
import { testIo } from "../../apps/cli/src/commands/test/fake-daemon.ts";
import type { SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";
import { RETRY_ANCHOR, RETRY_FILE, routeLoop } from "./router.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;
let sse: SseReader;
let web: Awaited<ReturnType<Int["browser"]>>;
/** Time warp (ms): trust decisions need a browser session older than 60 s [SEC-19]. */
let skew = 0;
const clock = { now: () => (Date.now() + skew) as UnixMs, iso: () => new Date(Date.now() + skew).toISOString() as never };

const CLI_VERSION = (JSON.parse(readFileSync(join(import.meta.dir, "../../apps/cli/package.json"), "utf8")) as { version: string }).version;

const spawner = fakeClaude({
  dtMs: 1,
  respond(prompt, spec) {
    const r = routeLoop(prompt);
    if (!r) return null;
    const model = spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5";
    return r.kind === "answer" ? synth.text(r.text, { model, dtMs: 1 }) : synth.text("", { model, dtMs: 1, structured: r.patch });
  },
});

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({ spawner, config: FAKE_CLAUDE_CONFIG, overrides: { clock } });
  ws = (await int.open(repo.root)).ws;
  web = await int.browser();
  sse = await int.sse(ws);
  await sse.until((e) => e.some((x) => x.type === "hello"));
}, 60_000);
afterAll(async () => {
  sse?.close();
  await int?.close();
  await repo?.dispose();
});

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "int",
  GIT_AUTHOR_EMAIL: "int@example.invalid",
  GIT_COMMITTER_NAME: "int",
  GIT_COMMITTER_EMAIL: "int@example.invalid",
};
const git = (...args: string[]): string => {
  const r = Bun.spawnSync(["git", "-C", repo.root, ...args], { env: gitEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};
/** Everything that identifies the user's repository besides the working tree (GIT-S-06). */
const userRepoState = () => ({
  refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
  head: git("rev-parse", "HEAD"),
  objects: git("cat-file", "--batch-all-objects", "--batch-check"),
  worktrees: git("worktree", "list", "--porcelain"),
  config: git("config", "--local", "--list"),
  index: git("ls-files", "-s"),
  stash: git("stash", "list"),
  branches: git("branch", "-a"),
});

const file = () => join(repo.root, RETRY_FILE);
const bytes = () => readFileSync(file());
const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
const webApi = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await web.req(method, `/ws/${ws}${path}`, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

async function jobUntil(id: JobId, states: JobState[], ms = 30_000): Promise<JobDetail> {
  const t0 = Date.now();
  for (;;) {
    const j = await api<JobDetail>("GET", `/jobs/${id}`);
    if (states.includes(j.state)) return j;
    if (j.state === "failed") throw new Error(`job ${id} failed: ${JSON.stringify(j.failure)}`);
    if (Date.now() - t0 > ms) throw new Error(`job ${id} stuck in ${j.state}`);
    await Bun.sleep(20);
  }
}

const anchor = { primary: "code" as const, code: { path: RETRY_FILE, start: RETRY_ANCHOR.start, end: RETRY_ANCHOR.end } };
const original = { bytes: null as Buffer | null, state: null as ReturnType<typeof userRepoState> | null };
let explainThread: ThreadDetail;
let fixThread: ThreadDetail;
let fixJob: JobDetail;
let accepted: Extract<AcceptRes, { kind: "applied" }>;

describe("INT-06 review → AI fix loop (side repo, accept, undo)", () => {
  test("a thread anchored to the retry code is stamped by the anchor engine and listed", async () => {
    original.bytes = bytes();
    original.state = userRepoState();
    explainThread = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "question", body: "この再試行はどう動く？", draft: false });
    expect(explainThread.id).toMatch(/^th_/);
    expect(explainThread.state).toBe("open");
    expect(explainThread.anchor.code).toMatchObject({ path: RETRY_FILE, start: RETRY_ANCHOR.start, end: RETRY_ANCHOR.end });
    expect(explainThread.anchor.code?.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(explainThread.anchor.code?.snippet).toBeTruthy();
    const page = await api<{ items: ThreadSummary[] }>("GET", "/threads?limit=50");
    expect(page.items.map((t) => t.id)).toContain(explainThread.id);
    await sse.until((e) => e.some((x) => x.type === "thread.upsert" && x.thread.id === explainThread.id));
  });

  test("Explain: estimate → create → the scripted engine answers with a cite; the thread is answered", async () => {
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [explainThread.id] });
    expect(est.route.mode).toBe("answer");
    expect(est.estimate.inTokens).toBeGreaterThan(100);
    expect(est.estimate.inTokens).toBeLessThan(3000);
    const created = await api<Job>("POST", "/jobs", {
      kind: "explain",
      threads: [explainThread.id],
      estimateId: est.estimate.id,
      confirm: est.estimate.requiresConfirm,
    } satisfies CreateJobReq);
    expect(["queued", "preparing", "running", "done"]).toContain(created.state);
    const done = await jobUntil(created.id, ["done"]);
    expect(done.usage?.out).toBeGreaterThan(0);
    const th = await api<ThreadDetail>("GET", `/threads/${explainThread.id}`);
    expect(th.state).toBe("answered");
    const answer = th.messages.find((m) => m.by.startsWith("agent:"));
    expect(answer?.body).toContain("maxRetries");
    expect(answer?.html).toContain("<");
    expect(th.jobViews.map((j) => j.id)).toContain(created.id);
    // answer mode never writes: nothing about the user's repo moved
    expect(bytes().equals(original.bytes as Buffer)).toBe(true);
  });

  test("Fix: patch mode produces a ready job with a diff, the gofmt gate waits for trust", async () => {
    fixThread = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: "再試行回数を設定可能にして", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [fixThread.id] });
    expect(est.route.mode).toBe("patch");
    expect(est.estimate.inTokens).toBeLessThanOrEqual(3000);
    const created = await api<Job>("POST", "/jobs", {
      kind: "fix",
      threads: [fixThread.id],
      estimateId: est.estimate.id,
      confirm: est.estimate.requiresConfirm,
    } satisfies CreateJobReq);
    fixJob = await jobUntil(created.id, ["ready"]);
    expect(fixJob.writeScope).toEqual([RETRY_FILE]);
    expect(fixJob.usage?.out ?? 0).toBeLessThanOrEqual(1500);
    expect(fixJob.diff.map((d) => d.path)).toEqual([RETRY_FILE]);
    expect(fixJob.diff[0]?.hunks.length).toBeGreaterThan(0);
    const gofmt = fixJob.gates.find((g) => g.gate === "fmt:gofmt");
    expect(gofmt?.status).toBe("untrusted");
    // nothing reached the user's tree yet
    expect(bytes().equals(original.bytes as Buffer)).toBe(true);
    expect(userRepoState()).toEqual(original.state as never);
    const th = await api<ThreadDetail>("GET", `/threads/${fixThread.id}`);
    expect(th.state).toBe("proposed");
  });

  test("trust the gofmt gate (session older than 60 s), run it: autofix puts the badly formatted line right", async () => {
    const trusts = await api<TrustRequest[]>("GET", "/trust");
    const req = trusts.find((t) => t.item === "gates");
    expect(req?.status).toBe("pending");
    skew = 120_000; // the browser session is now "older than 60 s"
    await webApi("POST", `/trust/${req?.id}`, { decision: "trusted" });
    await webApi("POST", `/jobs/${fixJob.id}/gates/run`, {});
    fixJob = await jobUntil(fixJob.id, ["ready"]);
    expect(fixJob.gates.find((g) => g.gate === "fmt:gofmt")?.status).toBe("pass");
    expect(fixJob.gateVerdict).toBe("passed");
    const added = fixJob.diff.flatMap((d) => d.hunks.flatMap((h) => h.lines)).map((l) => JSON.stringify(l));
    expect(added.join("\n")).toContain("var MaxRetries = 1");
    expect(added.join("\n")).not.toContain("MaxRetries  =  1");
  });

  test("accept: the change lands in the working tree UNCOMMITTED; refs, objects, index, config and worktrees of the user's repo are untouched", async () => {
    const before = userRepoState();
    const res = await webApi<AcceptRes>("POST", `/jobs/${fixJob.id}/accept`, { accept: "all" });
    expect(res.kind).toBe("applied");
    accepted = res as Extract<AcceptRes, { kind: "applied" }>;
    expect(accepted.files).toEqual([RETRY_FILE]);
    const text = readFileSync(file(), "utf8");
    expect(text).toContain("var MaxRetries = 1");
    expect(text).toContain("attempt <= MaxRetries;");
    expect(text).not.toContain("const maxRetries");
    expect(git("status", "--porcelain", "--", RETRY_FILE)).toBe(` M ${RETRY_FILE}\n`);
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(git("log", "-1", "--format=%H")).toBe(`${before.head}`);
    expect(userRepoState()).toEqual(before as never);
    // gofmt / go vet agree on the result when a toolchain is around
    if (Bun.which("gofmt")) expect(Bun.spawnSync(["gofmt", "-l", file()]).stdout.toString()).toBe("");
    if (Bun.which("go")) {
      const vet = Bun.spawnSync(["go", "vet", "./internal/meta/"], {
        cwd: repo.root,
        env: { ...process.env, GOTOOLCHAIN: "local", GOCACHE: join(int.home, "gocache") },
      });
      expect({ code: vet.exitCode, err: vet.stderr.toString() }).toMatchObject({ code: 0 });
    }
    const cks = await api<Checkpoint[]>("GET", "/checkpoints");
    expect(cks.map((c) => c.id)).toContain(accepted.checkpoint.id);
    const th = await api<ThreadDetail>("GET", `/threads/${fixThread.id}`);
    expect(["applied", "resolved"]).toContain(th.state);
    await sse.until((e) => e.some((x) => x.type === "checkpoint.upsert" && x.checkpoint.id === accepted.checkpoint.id));
  });

  test("the watcher re-indexes the accepted file: the thread's anchor follows the code (index.delta chain)", async () => {
    const t0 = Date.now();
    for (;;) {
      const th = await api<ThreadDetail>("GET", `/threads/${explainThread.id}`);
      const blob = th.anchor.code?.blob;
      if (blob !== explainThread.anchor.code?.blob) {
        expect(th.anchor.code?.path).toBe(RETRY_FILE);
        // a thread of ANOTHER job over the changed lines is stale; the accepted job's own thread is not
        expect(th.stale).toBe(true);
        expect((await api<ThreadDetail>("GET", `/threads/${fixThread.id}`)).stale).toBe(false);
        break;
      }
      if (Date.now() - t0 > 10_000) throw new Error("the explain thread was not re-anchored after the accept");
      await Bun.sleep(25);
    }
  });

  test("undo restores the exact original bytes; the thread reopens", async () => {
    const res = await api<UndoRes>("POST", `/checkpoints/${accepted.checkpoint.id}/undo`, { force: false });
    expect(res.diverged).toEqual([]);
    expect(res.restored).toEqual([RETRY_FILE]);
    expect(bytes().equals(original.bytes as Buffer)).toBe(true);
    expect(git("status", "--porcelain", "--", RETRY_FILE)).toBe("");
    expect(userRepoState()).toEqual(original.state as never);
    const job = await api<JobDetail>("GET", `/jobs/${fixJob.id}`);
    expect(job.state).toBe("reverted");
    // the index follows the restored file through the same chain; the undone job's own thread must not turn stale by it
    for (const t0 = Date.now(); ; await Bun.sleep(25)) {
      const e = await api<ThreadDetail>("GET", `/threads/${explainThread.id}`);
      if (e.anchor.code?.blob === explainThread.anchor.code?.blob) break;
      if (Date.now() - t0 > 10_000) throw new Error("the index did not follow the undo");
    }
    const th = await api<ThreadDetail>("GET", `/threads/${fixThread.id}`);
    expect(th.state).toBe("open");
    expect(th.stale).toBe(false);
  });

  test("the whole loop cost zero real tokens: every engine turn is a ledger row of the scripted claude", async () => {
    const usage = await api<UsageSummary>("GET", "/usage/summary?range=today").catch(() => int.json<UsageSummary>("GET", "/usage/summary?range=today"));
    expect(spawner.turns.length).toBe(2);
    expect(usage.totals.calls).toBe(spawner.turns.length);
    // lean flags, the private cwd, no repo settings: the engine never ran inside the user's repository
    for (const t of spawner.turns) {
      expect(t.cwd).not.toBe(repo.root);
      expect(t.argv).toContain("--no-session-persistence");
    }
  });

  test("Pull round (mitori review): Finish(pull) → wait → bundle → reply → complete", async () => {
    const t = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: "ログを足して", draft: false });
    const fin = await webApi<{ round: Round }>("POST", "/review/finish", { mode: "pull" });
    expect(fin.round.n).toBe(1);
    // the CLI identifies itself with a stable waiter id and agent label
    const poll = await fetch(`${int.origin}${API_PREFIX}/ws/${ws}/review/wait?round=1&timeoutMs=2000`, {
      headers: {
        authorization: `Bearer ${int.d.token}`,
        "x-mitori-client": "cli/int",
        "x-mitori-waiter": "w_0123456789abcdef",
        "x-mitori-agent": "claude-code",
      },
    });
    const res = (await poll.json()) as ReviewWaitRes;
    expect(res.status).toBe("ready");
    // the undone Fix thread is open again, so the round carries both
    expect(res.stdout?.split("\n")[0]).toBe("mitori.review/1 round=1 threads=2 approved=false");
    expect(res.stdout).toContain(`## ${fixThread.id} change R1 ${RETRY_FILE}:${RETRY_ANCHOR.start}-${RETRY_ANCHOR.end}`);
    expect(res.stdout).toContain(`## ${t.id} change R1 ${RETRY_FILE}:${RETRY_ANCHOR.start}-${RETRY_ANCHOR.end}`);
    expect(res.stdout).toContain("> ログを足して");
    expect(res.stdout?.trimEnd().endsWith("NEXT: mitori review --round 2")).toBe(true);
    const bundle = await int.cli("GET", `/ws/${ws}/threads/${t.id}/bundle`);
    const text = await bundle.text();
    expect(text).toContain("MBF/1 mode=pull");
    expect(text).toContain(`WRITE ${RETRY_FILE}`);
    await int.json("POST", `/ws/${ws}/threads/${t.id}/reply`, { kind: "answer", body: "既に対応済みです" });
    const done = await int.json<Round>("POST", `/ws/${ws}/review/rounds/1/complete`);
    expect(done.state).toBe("complete");
    const after = await api<ThreadDetail>("GET", `/threads/${t.id}`);
    expect(after.messages.at(-1)?.body).toBe("既に対応済みです");
  });

  test("Pull round through the real CLI commands: review → bundle → touch → reply → review --round 2", async () => {
    const t = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: "エラーメッセージに ISBN を入れて", draft: false });
    await webApi("POST", "/review/finish", { mode: "pull" });
    const run = async (name: string, argv: string[], stdin?: string) => {
      const io = testIo({ argv, home: int.home, cwd: repo.root, env: { CLAUDECODE: "1" }, ...(stdin !== undefined ? { stdin } : {}) });
      io.version = CLI_VERSION; // the daemon of this process: same version ⇒ `use`, never a restart
      const code = await runCommand(name, io);
      return { code, stdout: io.stdout, stderr: io.stderr };
    };
    // the blocking command prints the daemon's mitori.review/1 text once; the last stderr line is the approval
    const review = await run("review", ["--no-open", "--round", "2"]);
    expect({ code: review.code, err: review.stderr.trimEnd().split("\n").at(-1) }).toEqual({ code: REVIEW_EXIT.ready, err: "approved: false" });
    expect(review.stdout.split("\n")[0]).toBe("mitori.review/1 round=2 threads=2 approved=false");
    expect(review.stdout).toContain(`## ${t.id} change R2 ${RETRY_FILE}:${RETRY_ANCHOR.start}-${RETRY_ANCHOR.end}`);
    expect(review.stdout).toContain(`## ${fixThread.id} change R2 carried=R1 ${RETRY_FILE}`); // sent in round 1, never answered
    expect(review.stdout.trimEnd().endsWith("NEXT: mitori review --round 3")).toBe(true);

    const bundle = await run("bundle", [t.id, "--lines"]);
    expect(bundle.code).toBe(0);
    expect(bundle.stdout).toContain("MBF/1 mode=pull");
    expect(bundle.stdout).toMatch(/^49\|.*var lastErr error$/m);

    // the PostToolUse hook: blocks citing the touched file go stale (no output at all)
    const hook = await run("touch", ["--stdin", "--source", "claude-hook"], JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file() } }));
    expect(hook).toEqual({ code: 0, stdout: "", stderr: "" });

    // the agent edits the working tree and reports; the thread is `applied` (a human resolves it)
    const edited = original.bytes?.toString("utf8").replace("attempt <= maxRetries;", "attempt <= maxRetries+0;") as string;
    await Bun.write(file(), edited);
    const reply = await run("reply", [t.id, "--done", "retry 条件を整理した", "--files", RETRY_FILE]);
    expect({ code: reply.code, err: reply.stderr }).toEqual({ code: 0, err: "" });
    const after = await api<ThreadDetail>("GET", `/threads/${t.id}`);
    expect(after.messages.at(-1)).toMatchObject({ by: expect.stringMatching(/^agent:/), body: "retry 条件を整理した" });
    expect(after.state).toBe("applied");

    // completing round 2 sends the not-yet-answered thread back to open; nothing is pending ⇒ exit 11 after --wait-sec
    const next = await run("review", ["--no-open", "--round", "3", "--wait-sec", "1"]);
    expect({ code: next.code, out: next.stdout, err: next.stderr }).toMatchObject({ code: REVIEW_EXIT.pending });
    expect((await api<ThreadDetail>("GET", `/threads/${fixThread.id}`)).state).toBe("open");
    await Bun.write(file(), original.bytes as Buffer);
  });

  test("F8: a pull round's changes outside its write scope are said on its threads; the round can be undone and re-applied", async () => {
    const readme = join(repo.root, "README.md");
    const readmeBefore = readFileSync(readme);
    const t = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: "ログの文言を直して（F8）", draft: false });
    const fin = await webApi<{ round: Round }>("POST", "/review/finish", { mode: "pull" });
    const n = fin.round.n;
    expect(fin.round.state).toBe("dispatched");
    const before = userRepoState();
    // the user's own agent writes the working tree directly: the anchored file, and two files no thread asked for
    const edited = (original.bytes as Buffer).toString("utf8").replace("attempt <= maxRetries;", "attempt <= maxRetries /* f8 */;");
    await Bun.write(file(), edited);
    await Bun.write(readme, `${readmeBefore.toString("utf8")}\nedited by the session\n`);
    await Bun.write(join(repo.root, "notes-f8.md"), "new file\n");
    const done = await int.json<Round>("POST", `/ws/${ws}/review/rounds/${n}/complete`);
    expect(done.state).toBe("complete");
    const changes = await api<RoundChanges>("GET", `/review/rounds/${n}/changes`);
    expect(changes.files).toEqual(["README.md", RETRY_FILE, "notes-f8.md"].sort());
    expect(changes.writeScope).toContain(RETRY_FILE);
    expect(changes.outside).toEqual(["README.md", "notes-f8.md"]);
    const said = (await api<ThreadDetail>("GET", `/threads/${t.id}`)).messages.filter((m) => m.by === "system" && m.body.includes("書き込み範囲の外"));
    expect(said).toHaveLength(1);
    expect(said[0]?.body).toContain("README.md");
    // a second completion call says nothing new
    await int.json<Round>("POST", `/ws/${ws}/review/rounds/${n}/complete`);
    expect((await api<ThreadDetail>("GET", `/threads/${t.id}`)).messages.filter((m) => m.body.includes("書き込み範囲の外"))).toHaveLength(1);

    // Undo the round: every changed file back to its pre-round bytes, uncommitted (refs, index, HEAD untouched)
    const undone = await webApi<RoundUndoRes>("POST", `/review/rounds/${n}/undo`);
    expect(undone.files.sort()).toEqual(["README.md", RETRY_FILE, "notes-f8.md"].sort());
    expect(bytes().equals(original.bytes as Buffer)).toBe(true);
    expect(readFileSync(readme).equals(readmeBefore)).toBe(true);
    expect(existsSync(join(repo.root, "notes-f8.md"))).toBe(false);
    expect(userRepoState()).toEqual(before as never);
    // …and the Undo is itself undoable from the checkpoint list: the session's edits come back
    expect((await api<Checkpoint[]>("GET", "/checkpoints")).map((c) => c.id)).toContain(undone.checkpoint.id);
    await webApi("POST", `/checkpoints/${undone.checkpoint.id}/undo`, {});
    expect(readFileSync(file(), "utf8")).toBe(edited);
    expect(readFileSync(join(repo.root, "notes-f8.md"), "utf8")).toBe("new file\n");
    // a push round has no working-tree base
    const res = await web.req("POST", `/ws/${ws}/review/rounds/999/undo`);
    expect(res.status).toBe(404);
    await Bun.write(file(), original.bytes as Buffer);
    await Bun.write(readme, readmeBefore);
    rmSync(join(repo.root, "notes-f8.md"), { force: true });
  });

  test("an edit outside the thread's WRITE scope fails the job (E_SCOPE_VIOLATION); nothing reaches the working tree", async () => {
    const before = userRepoState();
    const t = await api<ThreadDetail>("POST", "/threads", { anchor, intent: "change", body: "READMEも書き換えて", draft: false });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [t.id] });
    const created = await api<Job>("POST", "/jobs", { kind: "fix", threads: [t.id], estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
    const t0 = Date.now();
    let job: JobDetail;
    for (;;) {
      job = await api<JobDetail>("GET", `/jobs/${created.id}`);
      if (job.state === "failed" || job.state === "ready") break;
      if (Date.now() - t0 > 20_000) throw new Error(`job stuck in ${job.state}`);
      await Bun.sleep(20);
    }
    expect(job.state).toBe("failed");
    expect(job.failure?.code).toBe("E_SCOPE_VIOLATION");
    expect(readFileSync(join(repo.root, "README.md"), "utf8")).not.toContain("(edited)");
    expect(bytes().equals(original.bytes as Buffer)).toBe(true);
    expect(userRepoState()).toEqual(before as never);
    expect((await api<ThreadDetail>("GET", `/threads/${t.id}`)).state).toBe("failed");
  });

  test("read routes: job list (filters, paging), events replay, diff, copy-as-prompt", async () => {
    const all = await api<{ items: Job[]; next: string | null }>("GET", "/jobs?limit=2");
    expect(all.items).toHaveLength(2);
    expect(all.next).not.toBeNull();
    const rest = await api<{ items: Job[]; next: string | null }>("GET", `/jobs?limit=50&cursor=${all.next}`);
    expect(rest.items.length).toBeGreaterThan(0);
    const byThread = await api<{ items: Job[] }>("GET", `/jobs?thread=${fixThread.id}`);
    expect(byThread.items.map((j) => j.id)).toEqual([fixJob.id]);
    expect((await api<{ items: Job[] }>("GET", "/jobs?state=failed")).items.every((j) => j.state === "failed")).toBe(true);
    const events = await api<{ t: string }[]>("GET", `/jobs/${fixJob.id}/events`);
    expect(events.some((e) => e.t === "phase")).toBe(true);
    const diff = await api<{ path: string }[]>("GET", `/jobs/${fixJob.id}/diff`);
    expect(diff.map((d) => d.path)).toEqual([RETRY_FILE]);
    const prompt = await int.cli("GET", `/ws/${ws}/jobs/${fixJob.id}/prompt?target=claude-code`);
    expect(await prompt.text()).toContain("MBF/1 mode=copy");
    const copied = await api<{ text: string }>("POST", "/prompt", {
      anchor: fixThread.anchor,
      ask: "再試行回数を設定可能に",
      intent: "change",
      target: "generic",
    });
    expect(copied.text).toContain(`WRITE ${RETRY_FILE}`);
    expect(copied.text).not.toContain("mitori reply");
  });

  test("CR safe-6: a thread's chosen code reaches the pull bundle (⤴), the copy prompt (⧉) and the job; a cited file can leave WRITE", async () => {
    const CONFIG = "internal/config/config.go";
    const pick = { path: CONFIG, start: 1, end: 5 };
    const t = await api<ThreadDetail>("POST", "/threads", {
      anchor,
      intent: "change",
      body: "設定から読むようにして（safe-6）",
      draft: false,
      context: { add: [pick] },
    });
    expect(t.context).toEqual({ add: [pick] });
    const writeLine = (text: string) => text.split("\n").find((l) => l.startsWith("WRITE ")) ?? "";
    // ⤴: the pull bundle writes and shows the picked file (before: `WRITE` had only the anchor's file)
    const pull = await (await int.cli("GET", `/ws/${ws}/threads/${t.id}/bundle`)).text();
    expect(writeLine(pull).split(" ").slice(1).sort()).toEqual([CONFIG, RETRY_FILE].sort());
    expect(pull).toContain(`CODE ${CONFIG}:`);
    // ⧉: the copy prompt with the Composer's context
    const copied = await api<{ text: string }>("POST", "/prompt", {
      anchor: t.anchor,
      ask: "設定から読む",
      intent: "change",
      target: "generic",
      context: { add: [pick] },
    });
    expect(writeLine(copied.text).split(" ").slice(1).sort()).toEqual([CONFIG, RETRY_FILE].sort());
    // ⚡: the job's estimate without any chip in the request carries the stored context
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [t.id] });
    expect(est.estimate.items.map((i) => i.key)).toContain(`code:${CONFIG}:1-5`);
    // the anchor's own file taken out of WRITE: still read, no longer written
    const p = await webApi<ThreadDetail>("PATCH", `/threads/${t.id}`, { version: t.version, context: { add: [pick], remove: [`write:${RETRY_FILE}`] } });
    expect(p.context?.remove).toEqual([`write:${RETRY_FILE}`]);
    const narrowed = await (await int.cli("GET", `/ws/${ws}/threads/${t.id}/bundle`)).text();
    expect(writeLine(narrowed)).toBe(`WRITE ${CONFIG}`);
    expect(narrowed).toContain(`CODE ${RETRY_FILE}:`);
    // a malformed context is refused
    const bad = await web.req("POST", `/ws/${ws}/threads`, {
      anchor,
      intent: "change",
      body: "x",
      draft: false,
      context: { add: [{ path: "../etc/passwd", start: 1, end: 2 }] },
    });
    expect(bad.status).toBe(400);
    // ⧉ on the job card (GET /jobs/:job/prompt) builds from the thread: it carries the stored context too
    const est2 = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "fix", threads: [t.id] });
    const job = await api<Job>("POST", "/jobs", { kind: "fix", threads: [t.id], estimateId: est2.estimate.id, confirm: est2.estimate.requiresConfirm });
    const jobPrompt = await (await int.cli("GET", `/ws/${ws}/jobs/${job.id}/prompt?target=generic`)).text();
    expect(writeLine(jobPrompt)).toBe(`WRITE ${CONFIG}`);
    expect(jobPrompt).toContain(`CODE ${RETRY_FILE}:`);
    // the scripted engine has no answer for this ask: let the job end before the next test
    const t0 = Date.now();
    while (!["failed", "ready", "done", "cancelled"].includes((await api<JobDetail>("GET", `/jobs/${job.id}`)).state)) {
      if (Date.now() - t0 > 20_000) throw new Error("safe-6 job did not end");
      await Bun.sleep(20);
    }
  });
});
