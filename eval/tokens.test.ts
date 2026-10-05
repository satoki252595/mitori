import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INCLUDED_CLASSES } from "@mitori/core";
import { createFakeEvalEngine } from "./engine.ts";
import { runEval } from "./run.ts";
import { offlineTokens, tokenEfficiency } from "./tokens.ts";

const sourceSha = "a".repeat(40);
const indexDigest = "1234567890abcdef";
const startedAt = "2026-10-05T10:00:00.000Z";
const finishedAt = "2026-10-05T10:01:00.000Z";
function report() {
  return {
    v: "mitori.gen-real/1",
    effort: "standard",
    run: {
      effort: "standard",
      trigger: "user",
      state: "done",
      scope: [],
      pinned: { snapshot: indexDigest },
      progress: { total: 2, failed: 0 },
      startedAt,
      finishedAt,
    },
    sourceSnapshot: { sha: sourceSha, indexDigest },
    tokenBaseline: {
      v: "mitori.token-baseline/1",
      sha: sourceSha,
      indexDigest,
      tokenizer: "claude-v5",
      estimated: true,
      includedClasses: [...INCLUDED_CLASSES],
      filteredTokens: 2500,
    },
    tasks: [
      { id: "gt_a", state: "done" },
      { id: "gt_b", state: "skipped" },
    ],
    records: [
      { id: "u_first", scope: { kind: "gen_task", id: "gt_a" }, usage: { in: 600, cacheWrite: 100, cacheRead: 400 }, usageEstimated: false },
      { id: "u_retry", scope: { kind: "gen_task", id: "gt_a" }, usage: { in: 100, cacheWrite: 0, cacheRead: 0 }, usageEstimated: false },
      { id: "u_foreign", scope: { kind: "gen_task", id: "gt_other" }, usage: { in: 9000, cacheWrite: 0, cacheRead: 0 }, usageEstimated: false },
      { id: "u_job", scope: { kind: "job", id: "gt_a" }, usage: { in: 9000, cacheWrite: 0, cacheRead: 0 }, usageEstimated: false },
    ].map((r) => ({ ...r, at: "2026-10-05T10:00:10.000Z" })),
  };
}

describe("offline inputFiltered", () => {
  test("sums every task ledger attempt and cache input, and marks the denominator estimate", () => {
    const value = report();
    const before = JSON.stringify(value);
    const m = tokenEfficiency(value, "corpus");
    expect(m).toMatchObject({
      status: "measured",
      pass1In: 1200,
      filteredTokens: 2500,
      inputFiltered: 0.48,
      numerator: "provider",
      denominator: "estimated",
      estimatedCalls: 0,
    });
    expect(JSON.stringify(value)).toBe(before);
    const o = offlineTokens([{ label: "corpus", value }]);
    expect(o.result.status).toBe("ok");
    expect(o.slo).toEqual([
      expect.objectContaining({ id: "gen.ratio.inputFiltered", value: 0.48, target: 0.5, limit: 0.6, status: "green", estimated: true, context: "corpus" }),
    ]);
  });

  test("estimated native usage remains estimated, and the original limit still rejects excess", () => {
    const value = report();
    value.records[0]!.usageEstimated = true;
    value.tokenBaseline.filteredTokens = 1000;
    const o = offlineTokens([{ label: "generic", value }]);
    expect(o.measurements[0]).toMatchObject({ numerator: "estimated", denominator: "estimated", estimatedCalls: 1, inputFiltered: 1.2 });
    expect(o.result.status).toBe("failed");
    expect(o.slo[0]).toMatchObject({ status: "red", limit: 0.6, estimated: true });
  });

  test("old, mismatched, scoped, cached and incomplete reports stay unmeasured", () => {
    const mutations: ((r: ReturnType<typeof report>) => unknown)[] = [
      (r) => ({ ...r, tokenBaseline: undefined }),
      (r) => ({ ...r, sourceSnapshot: { ...r.sourceSnapshot, sha: "b".repeat(40) } }),
      (r) => ({ ...r, sourceSnapshot: { ...r.sourceSnapshot, sha: null } }),
      (r) => ({ ...r, run: { ...r.run, pinned: { snapshot: "f".repeat(16) } } }),
      (r) => ({ ...r, run: { ...r.run, scope: ["s3"] } }),
      (r) => ({ ...r, effort: "light", run: { ...r.run, effort: "light" } }),
      (r) => ({ ...r, run: { ...r.run, trigger: "incremental" } }),
      (r) => ({ ...r, run: { ...r.run, state: "cancelled" } }),
      (r) => ({ ...r, run: { ...r.run, startedAt: undefined } }),
      (r) => ({ ...r, tasks: [{ ...r.tasks[0], state: "cached" }, r.tasks[1]] }),
      (r) => ({ ...r, tasks: [r.tasks[0]] }),
      (r) => ({ ...r, tokenBaseline: { ...r.tokenBaseline, includedClasses: ["source"] } }),
      (r) => ({ ...r, records: [] }),
      (r) => ({ ...r, records: [{ ...r.records[0], at: undefined }] }),
      (r) => ({ ...r, records: [{ ...r.records[0], usageEstimated: undefined }] }),
      (r) => ({ ...r, records: [{ ...r.records[0], usage: { in: 0, cacheWrite: 0, cacheRead: 0 } }] }),
      (r) => ({ ...r, tasks: [r.tasks[0], { ...r.tasks[1], state: "done" }] }),
      (r) => ({
        ...r,
        tasks: [r.tasks[0], { ...r.tasks[1], state: "done" }],
        records: [...r.records, { ...r.records[0], id: "u_zero", scope: { kind: "gen_task", id: "gt_b" }, usage: { in: 0, cacheWrite: 0, cacheRead: 0 } }],
      }),
      (r) => ({ ...r, tasks: [{ ...r.tasks[0], state: "failed" }, r.tasks[1]] }),
      (r) => ({ ...r, run: { ...r.run, progress: { total: 2, failed: 1 } } }),
      (r) => ({ ...r, records: [r.records[0], r.records[0]] }),
      (r) => ({ ...r, records: [{ ...r.records[0], usage: { in: -1, cacheWrite: 0, cacheRead: 0 } }] }),
    ];
    for (const mutate of mutations) {
      const o = offlineTokens([{ label: "unknown", value: mutate(report()) }]);
      expect(o.measurements[0]?.status).toBe("unmeasured");
      expect(o.measurements[0]?.reason).toBeTruthy();
      expect(o.result.status).toBe("partial");
      expect(o.slo).toEqual([]);
    }
  });

  test("stable task ids do not import usage from a previous or later run", () => {
    const value = report();
    value.records.push({ ...value.records[0]!, id: "u_previous", at: "2026-10-05T09:59:59.000Z", usage: { in: 9000, cacheWrite: 0, cacheRead: 0 } });
    value.records.push({ ...value.records[0]!, id: "u_later", at: "2026-10-05T10:01:01.000Z", usage: { in: 9000, cacheWrite: 0, cacheRead: 0 } });
    expect(tokenEfficiency(value, "same-target")).toMatchObject({ status: "measured", pass1In: 1200, inputFiltered: 0.48 });
  });
});

const dirs: string[] = [];
function temp() {
  const path = mkdtempSync(join(tmpdir(), "mitori-token-eval-"));
  dirs.push(path);
  return path;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("offline runEval bypasses engine detect and invocation, writes provenance and explicit estimates", async () => {
  const input = join(temp(), "report.json");
  writeFileSync(input, JSON.stringify(report()));
  const engine = createFakeEvalEngine({ billing: "metered-api" });
  let detected = false;
  engine.detect = async () => {
    detected = true;
    throw new Error("offline must not detect");
  };
  const o = await runEval({ genReports: [input], engine, out: temp() });
  expect(detected).toBe(false);
  expect(engine.requests).toEqual([]);
  expect(o.exit).toBe(0);
  expect(o.report).toMatchObject({
    engine: "offline",
    partial: false,
    budget: { capUsd: 0, spentUsd: 0, billing: "unknown" },
    tokenEfficiency: [expect.objectContaining({ sha: sourceSha, indexDigest, denominator: "estimated" })],
  });
  expect(readFileSync(o.paths!.md, "utf8")).toContain("推計（分母を含む）");
  expect(JSON.parse(readFileSync(o.paths!.json, "utf8")).engine).toBe("offline");
});

test("offline CLI accepts multiple reports and exits 2 for missing baseline without fabricating a ratio", async () => {
  const input = join(temp(), "report.json");
  const old = join(temp(), "old.json");
  writeFileSync(input, JSON.stringify(report()));
  writeFileSync(old, JSON.stringify({ ...report(), tokenBaseline: undefined }));
  const out = temp();
  const proc = Bun.spawn(["bun", "eval/run.ts", "--suites", "tokens", "--gen-report", input, "--gen-report", old, "--out", out], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(code).toBe(2);
  expect(stderr).toBe("");
  expect(stdout).toContain("offline; estimated ratios");
  const result = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
  expect(result.partial).toBe(true);
  expect(result.tokenEfficiency.map((m: { status: string }) => m.status)).toEqual(["measured", "unmeasured"]);
  expect(result.slo).toHaveLength(1);
  expect(readFileSync(join(out, "summary.md"), "utf8")).toContain("未測定の項目あり");
});
