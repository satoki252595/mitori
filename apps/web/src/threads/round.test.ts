import { beforeAll, describe, expect, test } from "bun:test";
import { type Checkpoint, MitoriError, type RoundChanges } from "@mitori/core";
import { installRunes } from "../stores/__tests__/runes.ts";
import type { Stores } from "../stores/app.svelte.ts";

installRunes();
let Loop: typeof import("./loop.svelte.ts").Loop;
beforeAll(async () => {
  ({ Loop } = await import("./loop.svelte.ts"));
});

function fixture() {
  const original: RoundChanges = { round: 7, base: "base", files: ["a.ts", "human.txt"], writeScope: ["a.ts"], outside: ["human.txt"] };
  let changes = original;
  let failUndo = false;
  const checkpoint: Checkpoint = {
    id: "ck_round7",
    job: "j_round7",
    ref: "refs/mitori/ck/ck_round7",
    before: "before",
    after: "after",
    files: original.files,
    createdAt: "2026-10-04T00:00:00Z",
  };
  const calls: { route: string; body?: unknown }[] = [];
  const api = {
    async call(route: string, args: { body?: unknown }) {
      calls.push({ route, ...("body" in args ? { body: args.body } : {}) });
      if (route === "GET /ws/:ws/review") return { round: { n: 7, mode: "pull", state: "complete" }, waitingClients: 0, waitingAgents: [] };
      if (route === "GET /ws/:ws/review/rounds/:n/changes") return changes;
      if (route === "POST /ws/:ws/review/rounds/:n/undo") {
        if (failUndo) throw new MitoriError("E_GIT_MERGE_CONFLICT", "working tree diverged");
        changes = { ...original, files: [], outside: [] };
        return { checkpoint, files: original.files };
      }
      if (route === "POST /ws/:ws/checkpoints/:ck/undo") {
        changes = original;
        return { checkpoint: checkpoint.id, restored: original.files, diverged: [] };
      }
      throw new Error(`unexpected ${route}`);
    },
  };
  const s = {
    api,
    workspace: { key: "ws_cccccccccccc" },
    review: { round: null },
    bottom: {
      toast() {},
      dismiss() {},
      has() {
        return false;
      },
    },
  } as unknown as Stores;
  const loop = new Loop(s);
  return {
    loop,
    calls,
    original,
    checkpoint,
    setChanges: (v: RoundChanges) => {
      changes = v;
    },
    fail: () => {
      failUndo = true;
    },
  };
}

describe("CR safe-5 completed pull-round review and Undo", () => {
  test("reads all files without mutating; changed lists require another click; the restore uses an ordinary Undo checkpoint", async () => {
    const { loop, calls, original, checkpoint, setChanges } = fixture();
    await loop.refreshReview();
    await loop.refreshRoundChanges();
    expect(loop.roundChanges).toEqual(original);
    expect(calls.every((c) => c.route.startsWith("GET "))).toBe(true);
    const later = { ...original, files: [...original.files, "later.txt"], outside: [...original.outside, "later.txt"] };
    setChanges(later);
    expect(await loop.undoRound()).toBe(false);
    expect(loop.roundChanges).toEqual(later);
    expect(loop.roundChangesError).not.toBeNull();
    expect(calls.some((c) => c.route.endsWith("/rounds/:n/undo"))).toBe(false);
    expect(await loop.undoRound()).toBe(true);
    expect(calls.filter((c) => c.route.endsWith("/rounds/:n/undo"))).toEqual([{ route: "POST /ws/:ws/review/rounds/:n/undo" }]);
    expect(loop.checkpoints.get(checkpoint.id)).toEqual(checkpoint);
    expect(loop.undo.last).toEqual({ kind: "checkpoint", ck: checkpoint.id, job: checkpoint.job });
    expect(loop.roundChanges?.files).toEqual([]);
    await loop.undo.undo();
    await loop.refreshRoundChanges();
    expect(calls.filter((c) => c.route.endsWith("/checkpoints/:ck/undo"))).toEqual([{ route: "POST /ws/:ws/checkpoints/:ck/undo", body: {} }]);
    expect(loop.roundChanges).toEqual(original);
  });

  test("a backend divergence refusal stays visible and does not bypass the guard or create a checkpoint", async () => {
    const { loop, calls, fail } = fixture();
    loop.completedPull = 7;
    await loop.refreshRoundChanges();
    fail();
    expect(await loop.undoRound()).toBe(false);
    expect(loop.roundChangesError).not.toBeNull();
    expect(loop.roundChanges?.files).toEqual(["a.ts", "human.txt"]);
    expect(loop.checkpoints.size).toBe(0);
    expect(loop.undo.last).toBeNull();
    expect(calls.filter((c) => c.route.endsWith("/rounds/:n/undo"))).toHaveLength(1);
  });
});
