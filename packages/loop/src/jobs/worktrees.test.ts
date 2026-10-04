// GIT_LIMITS.maxWorktreesPerWs (cr-requests/agent.md #7): a new job worktree evicts the oldest idle ones first.
import { describe, expect, test } from "bun:test";
import type { Job, JobId, JobState } from "@mitori/core";
import { GIT_LIMITS } from "../contract.ts";
import type { RunnerCore } from "./core.ts";
import { makeWorktreeRoom } from "./worktrees.ts";

function fakeCore(jobs: { id: string; state: JobState; at: string; worktree?: string }[], onRemove?: (id: JobId, recs: { job: Job }[]) => void) {
  const recs = jobs.map((j) => ({
    job: { id: j.id as JobId, state: j.state, createdAt: j.at, ...(j.worktree ? { worktree: j.worktree } : {}) } as unknown as Job,
  }));
  // a worktree path ending in `_removed` names a directory that no longer exists
  const dirs = new Set(jobs.filter((j) => j.worktree && !j.worktree.endsWith("_removed")).map((j) => j.worktree as string));
  const removed: string[] = [];
  const core = {
    // copies, like the real store's rows: a state change after `inStates` is only seen through `get`
    store: {
      inStates: (states: readonly JobState[]) => recs.filter((r) => states.includes(r.job.state)).map((r) => ({ job: { ...r.job } })),
      get: (id: JobId) => recs.find((r) => r.job.id === id) ?? null,
    },
    deps: {
      fs: { stat: (p: string) => (dirs.has(p) ? { isDir: true } : null) },
      git: {
        removeWorktree: async (id: JobId) => {
          removed.push(id);
          dirs.delete(`/wt/${id}`);
          onRemove?.(id, recs);
        },
      },
      log: { info: () => undefined, warn: () => undefined },
    },
    update: async (id: JobId, _label: string, fn: (r: (typeof recs)[number]) => void) => {
      const r = recs.find((x) => x.job.id === id);
      if (r) fn(r);
      return r;
    },
  } as unknown as RunnerCore;
  return { core, recs, removed };
}

describe("#7 maxWorktreesPerWs", () => {
  test("at the limit: the oldest idle worktree goes; busy (running / accepting) ones never do", async () => {
    const jobs = [
      { id: "j_run", state: "running" as const, at: "2026-10-01T00:00:00Z", worktree: "/wt/j_run" },
      { id: "j_acc", state: "accepting" as const, at: "2026-10-01T00:00:01Z", worktree: "/wt/j_acc" },
      ...Array.from({ length: GIT_LIMITS.maxWorktreesPerWs - 2 }, (_, i) => ({
        id: `j_r${i}`,
        state: "ready" as const,
        at: `2026-10-02T00:00:0${i}Z`,
        worktree: `/wt/j_r${i}`,
      })),
      { id: "j_gone", state: "failed" as const, at: "2026-09-01T00:00:00Z", worktree: "/wt/j_gone_removed" },
    ];
    const { core, recs, removed } = fakeCore(jobs);
    // the failed job's worktree directory no longer exists: it does not count and is not touched
    expect(await makeWorktreeRoom(core, "j_new" as JobId)).toEqual(["j_r0" as JobId]);
    expect(removed).toEqual(["j_r0"]);
    expect(recs.find((r) => r.job.id === "j_r0")?.job.worktree).toBeUndefined();
    expect(recs.find((r) => r.job.id === "j_run")?.job.worktree).toBe("/wt/j_run");
  });

  test("below the limit nothing is removed; only busy worktrees ⇒ nothing is removed either", async () => {
    expect(await makeWorktreeRoom(fakeCore([{ id: "j_1", state: "ready", at: "2026-10-01T00:00:00Z", worktree: "/wt/j_1" }]).core, "j_new" as JobId)).toEqual(
      [],
    );
    const busy = Array.from({ length: GIT_LIMITS.maxWorktreesPerWs + 1 }, (_, i) => ({
      id: `j_b${i}`,
      state: "running" as const,
      at: "2026-10-01T00:00:00Z",
      worktree: `/wt/j_b${i}`,
    }));
    expect(await makeWorktreeRoom(fakeCore(busy).core, "j_new" as JobId)).toEqual([]);
  });

  test("a job that became busy while an earlier eviction ran is not evicted (its state is read again)", async () => {
    const jobs = Array.from({ length: GIT_LIMITS.maxWorktreesPerWs + 1 }, (_, i) => ({
      id: `j_${i}`,
      state: "ready" as const,
      at: `2026-10-02T00:00:0${i}Z`,
      worktree: `/wt/j_${i}`,
    }));
    // removing j_0 takes a while; meanwhile the human runs j_1's gates
    const { core, removed } = fakeCore(jobs, (id, recs) => {
      if (id === "j_0") (recs.find((r) => r.job.id === "j_1") as { job: Job }).job.state = "gating";
    });
    expect(await makeWorktreeRoom(core, "j_new" as JobId)).toEqual(["j_0", "j_2"] as JobId[]);
    expect(removed).not.toContain("j_1");
  });

  test("the job asking for room is not counted against itself (re-creating its own worktree)", async () => {
    const jobs = Array.from({ length: GIT_LIMITS.maxWorktreesPerWs }, (_, i) => ({
      id: `j_${i}`,
      state: "ready" as const,
      at: `2026-10-02T00:00:0${i}Z`,
      worktree: `/wt/j_${i}`,
    }));
    const { core } = fakeCore(jobs);
    // j_0 restores its own worktree: the other 7 stay
    expect(await makeWorktreeRoom(core, "j_0" as JobId)).toEqual([]);
  });
});
