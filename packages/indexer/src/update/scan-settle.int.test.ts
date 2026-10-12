// WP6 案1: the scan shrinks the parse pool to one warm Worker right after S1 (before S2–S4), and a later
// update still parses on the pool (delayed regrow via `ensure()`).
import { afterEach, describe, expect, test } from "bun:test";
import type { WorkerPool } from "@mitori/core";
import type { Indexer, ParseBatchRequest, ParseBatchResponse } from "../contract.ts";
import { env, workerInit } from "../parse/test/env.ts";
import { createWorkerHandler } from "../parse/worker.ts";
import { createIndexerWith } from "./facade.ts";
import { defaultStagesFactory, type LaterStagesFactory } from "./stages.ts";
import { inlinePool, type TestDeps, testDeps } from "./test/deps.ts";
import { type TempRepo, tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

/** Pool factory recording every size change, so the test can order the S1 shrink against S2–S4. */
function trackingFactory() {
  const innerFactory = inlinePool(createWorkerHandler(env, workerInit()));
  const log: string[] = [];
  let size = 0;
  const factory = (n: number): WorkerPool<ParseBatchRequest, ParseBatchResponse> => {
    const inner = innerFactory(n);
    size = n;
    log.push(`factory(${n})`);
    return {
      ...inner,
      size: () => size,
      // Log first, delegate second: settle() is fire-and-forget, so the test orders by invocation — the entry must
      // land synchronously inside the shrink()/resize() call, before any `await`.
      async resize(k: number) {
        size = k;
        log.push(`resize(${k})`);
        await inner.resize(k);
      },
      async shrink(keep = 0) {
        size = Math.min(size, keep);
        log.push(`shrink(${keep})->${size}`);
        await inner.shrink(keep);
      },
      async close() {
        size = 0;
        log.push("close");
        await inner.close();
      },
    };
  };
  return { factory, log, size: () => size };
}

function setup(files: Record<string, string>): {
  repo: TempRepo;
  deps: TestDeps;
  idx: Indexer;
  poolLog: string[];
  /** Pool-log length at each S2–S4 entry: entries before it ran while S0/S1 was still in flight. */
  stagesMarks: number[];
  size: () => number;
} {
  const repo = tempRepo(files);
  const tracking = trackingFactory();
  const stagesMarks: number[] = [];
  const stages: LaterStagesFactory = (view) => {
    const inner = defaultStagesFactory(view);
    return {
      ...inner,
      async scan(opts) {
        stagesMarks.push(tracking.log.length);
        return inner.scan(opts);
      },
    };
  };
  const deps = testDeps(repo.root, { pool: tracking.factory });
  const idx = createIndexerWith(deps, stages);
  cleanup.push(
    () => idx.close(),
    () => repo.dispose(),
  );
  return { repo, deps, idx, poolLog: tracking.log, stagesMarks, size: tracking.size };
}

/** shrink()/resize() entries that leave ≤1 Worker. */
function isWarm(entry: string): boolean {
  const m = /^(?:shrink\(\d+\)->|resize\()(\d+)$/.exec(entry);
  return m !== null && Number(m[1]) <= 1;
}

// ~0.9 MB of parse bytes → poolSize wants 2 Workers, so the shrink from N to 1 is observable.
const big = (n: number): string => Array.from({ length: n }, (_, i) => `export function f${i}(): number {\n  return ${i};\n}\n`).join("");

describe("WP6 scan settles the pool right after S1", () => {
  test("pool is warm-1 before S2–S4 run, and a later update still parses", async () => {
    const { repo, poolLog, stagesMarks, size, idx } = setup({ "src/big.ts": big(19_000) });
    await idx.scan();

    // S2–S4 ran exactly once; the shrink to ≤1 was already *invoked* when it started (settle() is fire-and-forget,
    // so order by invocation, not completion: the shrink() call itself runs synchronously inside settle(), right
    // after the S1 run). Pre-fix the only settle() ran after `core.stages.scan()` resolved, so this fails there.
    expect(stagesMarks).toHaveLength(1);
    expect(poolLog.slice(0, stagesMarks[0] as number).some(isWarm)).toBe(true);

    // settle() is async: wait for the size to land, then it must stay at warm-1 (or 0 after recycle).
    for (let i = 0; i < 400 && size() > 1; i++) await Bun.sleep(5);
    expect(size()).toBeLessThanOrEqual(1);

    // The warm Worker still parses: a saved file gets fresh symbols through update().
    repo.write("src/big.ts", `${big(19_000)}\nexport function addedFresh(): number {\n  return 1;\n}\n`);
    const d = await idx.update([{ kind: "change", path: "src/big.ts" }]);
    expect(d.changed.map((c) => c.path)).toEqual(["src/big.ts"]);
    expect(idx.symbols("src/big.ts").some((s) => s.name === "addedFresh")).toBe(true);
  });
});
