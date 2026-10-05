import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSpawner, testHasher } from "@mitori/agent/testing";
import type { AcceptRes, Job, JobDetail, JobEstimate, ThreadDetail, UndoRes } from "@mitori/core";
import { createFsReader, createSpawner } from "@mitori/platform";
import { gitWorld, userRepoState } from "../../packages/loop/src/git/test/world.ts";
import { startInt } from "./harness.ts";

test("Codex agent uses side worktree, reports missing gates, and preserves human per-hunk accept and Undo without writing user refs/objects", async () => {
  const w = await gitWorld("go-small"),
    source = mkdtempSync(join(tmpdir(), "mitori-codex-auth-test-"));
  mkdirSync(join(source, ".codex"));
  writeFileSync(join(source, ".codex/auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "local-test-only" } }));
  const native = "/opt/fake/codex",
    baseFs = createFsReader(),
    real = createSpawner();
  let thread = "";
  const fake = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["codex-cli 0.160.0"] })
    .script(
      (s) => s.argv[0] === "exec",
      (s) => ({
        lines: [
          { line: JSON.stringify({ type: "thread.started", thread_id: "local-fake" }) },
          { line: JSON.stringify({ type: "turn.started" }) },
          {
            line: JSON.stringify({
              type: "item.started",
              item: { id: "edit", type: "file_change", changes: [{ path: `${s.cwd}/README.md`, kind: "update" }], status: "in_progress" },
            }),
            run: () => writeFileSync(join(s.cwd, "README.md"), "Human-reviewed scoped Codex proposal.\n"),
          },
          {
            line: JSON.stringify({
              type: "item.completed",
              item: {
                id: "answer",
                type: "agent_message",
                text: JSON.stringify({
                  summary: "README clarification",
                  files_changed: ["README.md"],
                  doc_updates: [],
                  threads: [{ id: thread, status: "done", body: "Review this scoped proposal." }],
                }),
              },
            }),
          },
          {
            line: JSON.stringify({
              type: "turn.completed",
              usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0 },
            }),
          },
        ],
      }),
    );
  const int = await startInt({
    config: {
      defaultEngine: "codex-cli",
      engines: {
        "claude-cli": { enabled: false },
        "codex-cli": {
          enabled: true,
          binary: native,
          model: "test-model",
          pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 },
          maxEstimatedSpendUsd: 1,
        },
      },
      models: { agent: "codex:test-model", patch: "codex:test-model" },
      pins: { codex: { path: native, realpath: native, sha256: testHasher.sha256("native"), version: "codex-cli 0.160.0", pinnedAt: "2026-10-05T00:00:00Z" } },
    },
    spawner: { spawn: (s) => (s.command === native ? fake.spawn(s) : real.spawn(s)) },
    overrides: {
      env: { HOME: source, PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir() },
      fs: {
        ...baseFs,
        stat: (p) => (p === native ? { isFile: true, isDir: false, isSymlink: false, size: 6, mtimeNs: 0n, ino: 1n } : baseFs.stat(p)),
        realpath: (p) => (p === native ? native : baseFs.realpath(p)),
        read: (p) => (p === native ? Promise.resolve(new TextEncoder().encode("native")) : baseFs.read(p)),
      },
    },
  });
  try {
    const original = readFileSync(join(w.repo.root, "README.md"), "utf8"),
      before = userRepoState(w);
    const { ws } = await int.open(w.repo.root),
      web = await int.browser();
    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await web.req(method, `/ws/${ws}${path}`, body);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json() as Promise<T>;
    };
    const th = await api<ThreadDetail>("POST", "/threads", {
      anchor: { primary: "code", code: { path: "README.md", start: 1, end: 1 } },
      intent: "change",
      body: "Clarify this README line",
      draft: false,
    });
    thread = th.id;
    const req = { kind: "fix", mode: "agent", model: "codex:test-model", threads: [th.id] };
    const est = await api<JobEstimate>("POST", "/jobs/estimate", req);
    expect(est.route).toMatchObject({ mode: "agent", contract: "agent/1", tools: "read_edit" });
    const job = await api<Job>("POST", "/jobs", { ...req, estimateId: est.estimate.id, confirm: true });
    let detail: JobDetail;
    const deadline = Date.now() + 10000;
    for (;;) {
      detail = await api<JobDetail>("GET", `/jobs/${job.id}`);
      if (["ready", "failed"].includes(detail.state)) break;
      if (Date.now() > deadline) throw new Error("Codex fixture timed out");
      await Bun.sleep(10);
    }
    expect(detail.state).toBe("ready");
    expect(detail.gateVerdict).toBe("unverified");
    expect(detail.gates).toEqual([]);
    expect(readFileSync(join(w.repo.root, "README.md"), "utf8")).toBe(original);
    expect(userRepoState(w)).toEqual(before);
    expect((await web.req("POST", `/ws/${ws}/jobs/${job.id}/accept`, { accept: "all" })).status).toBe(412);
    const accepted = await api<AcceptRes>("POST", `/jobs/${job.id}/accept`, { accept: Object.keys(detail.hunkDecisions ?? {}) });
    expect(accepted.kind).toBe("applied");
    if (accepted.kind !== "applied") throw new Error("expected a human accept");
    expect(readFileSync(join(w.repo.root, "README.md"), "utf8")).toBe("Human-reviewed scoped Codex proposal.\n");
    expect(userRepoState(w)).toEqual(before);
    const undo = await api<UndoRes>("POST", `/checkpoints/${accepted.checkpoint.id}/undo`, { force: false });
    expect(undo.diverged).toEqual([]);
    expect(readFileSync(join(w.repo.root, "README.md"), "utf8")).toBe(original);
    expect(userRepoState(w)).toEqual(before);
  } finally {
    await int.close();
    await w.dispose();
    rmSync(source, { recursive: true, force: true });
  }
}, 15000);
