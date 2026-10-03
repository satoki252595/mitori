import { describe, expect, test } from "bun:test";
import type { GenTaskId } from "@mitori/core";
import type { PrepTaskEntry } from "../contract.ts";
import { batchesOf } from "./packet.ts";

const entry = (i: number, tail: number, prefix: number): PrepTaskEntry => ({
  id: `gt_${String(i).padStart(10, "0")}` as GenTaskId,
  prompt: "gen.module@1",
  phase: 1,
  after: [],
  input: `inputs/${i}.md`,
  out: `out/${i}.ndjson`,
  sections: ["s6/x"],
  maxOutTokens: 6000,
  estimate: { in: prefix + tail, out: 1000 },
});

describe("batches.json (§8.4 R1 PT-10)", () => {
  test("system.md is read once per batch: the 100k input cap counts the prefix once, not per task", () => {
    // 6 tasks of 10k own input + an 11.5k prefix = 71.5k per batch ⇒ one batch (the estimator's batch count)
    const tasks = Array.from({ length: 6 }, (_, i) => entry(i, 10_000, 11_500));
    expect(batchesOf(tasks, 6, 11_500).map((b) => b.tasks.length)).toEqual([6]);
    // at most `batchSize` tasks, and the cap still splits large inputs
    expect(batchesOf(tasks, 4, 11_500).map((b) => b.tasks.length)).toEqual([4, 2]);
    const big = Array.from({ length: 3 }, (_, i) => entry(i, 40_000, 11_500));
    expect(batchesOf(big, 6, 11_500).map((b) => b.tasks.length)).toEqual([2, 1]);
  });

  test("a non-positive batch size is treated as 1", () => {
    const tasks = Array.from({ length: 2 }, (_, i) => entry(i, 100, 0));
    expect(batchesOf(tasks, 0).map((b) => b.batch)).toEqual([1, 2]);
  });
});
