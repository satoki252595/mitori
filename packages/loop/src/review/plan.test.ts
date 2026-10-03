import { describe, expect, test } from "bun:test";
import type { RepoPath, ThreadDetail, ThreadId, ThreadIntent } from "@mitori/core";
import { planBatch } from "./index.ts";

let seq = 0;
function th(intent: ThreadIntent, path: string, start: number, end: number, scope?: RepoPath[]): ThreadDetail & { scope: RepoPath[] } {
  const id = `th_${String(seq++).padStart(8, "0")}` as ThreadId;
  return {
    id,
    anchor: { primary: "code", code: { path, start, end, blob: "b", snippet: "s" } },
    anchorHealth: "ok",
    stale: false,
    intent,
    state: "open",
    round: 1,
    version: 1,
    title: id,
    jobs: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    messages: [],
    jobViews: [],
    scope: scope ?? [path],
  };
}

const ctx = {
  moduleOf: (p: RepoPath) => p.split("/").slice(0, -1).join("/"),
  writeScopeOf: (t: ThreadDetail) => (t as ThreadDetail & { scope: RepoPath[] }).scope,
  anchoredLinesOf: (t: ThreadDetail) => (t.anchor.code ? t.anchor.code.end - t.anchor.code.start + 1 : 0),
};

describe("AC-L12 Finish(push) partition (§2.4.3)", () => {
  test("question/review/note one job each; change/doc_edit per module; deterministic for any input order", () => {
    const ts = [
      th("question", "a/x.ts", 1, 2),
      th("change", "a/x.ts", 10, 20),
      th("change", "a/y.ts", 3, 9),
      th("doc_edit", "b/z.ts", 1, 5),
      th("review", "b/z.ts", 7, 8),
      th("note", "a/x.ts", 30, 31),
    ];
    const plan = planBatch(ts, ctx);
    expect(plan.map((p) => [p.kind, p.threads.length, p.writeScope])).toEqual([
      ["explain", 1, []],
      ["explain", 1, []],
      ["review", 1, []],
      ["fix", 2, ["a/x.ts", "a/y.ts"]],
      ["fix", 1, ["b/z.ts"]],
    ]);
    for (let k = 0; k < 20; k++) {
      const shuffled = [...ts].sort(() => (Math.sin(k * 97 + ts.length) > 0 ? 1 : -1));
      expect(planBatch(shuffled, ctx)).toEqual(plan);
    }
  });

  test("intersecting write scopes across modules join one component", () => {
    const a = th("change", "a/x.ts", 1, 2, ["a/x.ts", "shared/util.ts"]);
    const b = th("change", "b/y.ts", 1, 2, ["b/y.ts", "shared/util.ts"]);
    const c = th("change", "c/z.ts", 1, 2);
    const plan = planBatch([a, b, c], ctx);
    expect(plan.map((p) => p.threads)).toEqual([[a.id, b.id], [c.id]]);
  });

  test("limits (≤ 6 threads, ≤ 400 lines, ≤ 8 files) cut greedily; later cuts lock after earlier ones sharing files", () => {
    const many = Array.from({ length: 8 }, (_, i) => th("change", "m/a.ts", i * 10 + 1, i * 10 + 5));
    const plan = planBatch(many, ctx);
    expect(plan.map((p) => p.threads.length)).toEqual([6, 2]);
    expect(plan[1]?.after).toEqual([0]);
    const big = [th("change", "m/b.ts", 1, 300), th("change", "m/b.ts", 301, 450)];
    expect(planBatch(big, ctx).map((p) => [p.threads.length, p.after])).toEqual([
      [1, []],
      [1, [0]],
    ]);
    const files = Array.from({ length: 9 }, (_, i) => th("change", `f/${i}.ts`, 1, 1));
    const fp = planBatch(files, ctx);
    expect(fp.map((p) => p.writeScope.length)).toEqual([6, 3]);
    expect(fp[1]?.after).toEqual([]);
  });
});
