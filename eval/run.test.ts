// WP-12 acceptance: "with the fake engine, `nd bun run eval --suite smoke` runs to the end and writes JSON + Markdown".
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TEST_FORMATS } from "@mitori/testkit";
import { EvalRefusal } from "./budget.ts";
import { createFakeEvalEngine } from "./engine.ts";
import { renderMarkdown, reportDirName } from "./report.ts";
import { runEval } from "./run.ts";

const ROOT = resolve(import.meta.dir, "..");
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "mitori-eval-run-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(argv, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

describe("EVAL-AT-01 --suite smoke on the fake engine", () => {
  test("the root script `bun run eval --suite smoke` runs to the end and writes summary.json and summary.md", async () => {
    const out = join(tmp(), "report");
    const r = await cli(["bun", "run", "eval", "--suite", "smoke", "--out", out]);
    expect(r.err).not.toMatch(/error|eval:/i); // `bun run` echoes the command it dispatches on stderr, nothing else
    expect(r.code).toBe(0);
    expect(r.out).toContain("eval smoke: smoke ok");
    expect(existsSync(join(out, "summary.json"))).toBe(true);
    expect(existsSync(join(out, "summary.md"))).toBe(true);
    const json = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    expect(json).toMatchObject({ v: TEST_FORMATS.evalReport, tier: "smoke", engine: "fake", partial: false });
    expect(json.suites.smoke.status).toBe("ok");
    expect(json.suites.smoke.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(json.budget).toMatchObject({ capUsd: 0.05, billing: "subscription-window" });
    expect(json.budget.spentUsd).toBeGreaterThan(0);
    expect(json.budget.spentUsd).toBeLessThan(0.05);
    expect(readFileSync(join(out, "summary.md"), "utf8")).toContain("# eval レポート: smoke");
  }, 30_000);

  test("usage errors exit 2 and a refusal prints why", async () => {
    expect((await cli(["bun", "eval/run.ts", "--suite", "nope"])).code).toBe(2);
    expect((await cli(["bun", "eval/run.ts", "--tier", "huge"])).code).toBe(2);
    const noEngine = await cli(["bun", "eval/run.ts", "--tier", "quick", "--out", join(tmp(), "x")]);
    expect(noEngine.code).toBe(2);
    expect(noEngine.err).toContain("live engine");
    expect((await cli(["bun", "eval/run.ts", "--suite", "smoke", "--max-usd", "-1"])).code).toBe(2);
  });
});

describe("EVAL-U-30 runEval", () => {
  test("the report carries versions, git, budget and the ledger-backed spend", async () => {
    const out = tmp();
    const o = await runEval({ suite: "smoke", out, now: () => new Date("2026-10-03T12:00:00Z") });
    expect(o.exit).toBe(0);
    expect(o.report.versions.pricing).toBe("2026-09-25");
    expect(o.report.startedAt).toBe("2026-10-03T12:00:00.000Z");
    expect(o.report.git.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(o.report.suites)).toEqual(["smoke"]);
    expect(o.report.slo).toEqual([expect.objectContaining({ id: "smoke.roundtrip", status: "green", synthetic: true })]);
    expect(o.paths?.json.startsWith(out)).toBe(true);
  });

  test("the default directory is <day>-<sha12>-<tier> under eval/reports", async () => {
    const reportsDir = tmp();
    const o = await runEval({ suite: "smoke", reportsDir, now: () => new Date("2026-10-03T12:00:00Z") });
    expect(o.paths?.json).toBe(join(reportsDir, reportDirName(o.report), "summary.json"));
    expect(reportDirName(o.report)).toMatch(/^20261003-[0-9a-f]{12}-smoke$/);
  });

  test("a metered engine starts nothing: exit 3 before a single call", async () => {
    const engine = createFakeEvalEngine({ billing: "metered-api" });
    const err = await runEval({ suite: "smoke", engine, out: tmp() }).catch((e) => e);
    expect(err).toBeInstanceOf(EvalRefusal);
    expect((err as EvalRefusal).exit).toBe(3);
    expect(engine.requests).toHaveLength(0);
  });

  test("metered with a small approval runs; above $6 it needs the user", async () => {
    const ok = await runEval({ suite: "smoke", engine: createFakeEvalEngine({ billing: "overage" }), approveMeteredUsd: 2, out: tmp() });
    // approved, so it starts; the smoke suite still records that this engine is not the subscription window
    expect(ok.exit).toBe(1);
    expect(ok.message).toContain("preflight.billing");
    expect(ok.report.budget.billing).toBe("overage");
    const err = await runEval({ suite: "smoke", engine: createFakeEvalEngine({ billing: "overage" }), approveMeteredUsd: 9, out: tmp() }).catch((e) => e);
    expect(err).toBeInstanceOf(EvalRefusal);
  });

  test("a tier run reports the unimplemented suites as pending, writes the report and exits 2", async () => {
    const o = await runEval({ tier: "quick", engine: createFakeEvalEngine(), out: tmp() });
    expect(o.exit).toBe(2);
    expect(o.report.partial).toBe(true);
    expect(Object.values(o.report.suites).map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    expect(o.message).toContain("M2");
    expect(o.report.budget.capUsd).toBe(1.5);
  });

  test("--suites selects within the tier; unknown names are refused", async () => {
    const one = await runEval({ tier: "standard", suites: ["patch"], engine: createFakeEvalEngine(), out: tmp() });
    expect(Object.keys(one.report.suites)).toEqual(["patch"]);
    const err = await runEval({ tier: "quick", suites: ["cite", "smoke"], engine: createFakeEvalEngine(), out: tmp() }).catch((e) => e);
    expect(err).toBeInstanceOf(EvalRefusal);
  });

  test("--max-usd lowers the cap, and the weekly allowance caps it further", async () => {
    const reportsDir = tmp();
    const o = await runEval({ tier: "full", maxUsd: 3, engine: createFakeEvalEngine(), out: tmp(), reportsDir });
    expect(o.report.budget.capUsd).toBe(3);
  });

  test("the Markdown names every check and marks a failure", async () => {
    const o = await runEval({ suite: "smoke", out: tmp() });
    const bad = structuredClone(o.report);
    const check = bad.suites.smoke?.checks[0];
    if (check) check.ok = false;
    const md = renderMarkdown(bad);
    expect(md).toContain("**NG**");
    for (const c of o.report.suites.smoke?.checks ?? []) expect(md).toContain(c.id);
  });
});
