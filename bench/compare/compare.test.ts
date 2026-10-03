import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_FORMATS } from "@mitori/testkit";
import type { BenchResultFile } from "../runner/result.ts";
import { toSamples } from "../runner/stats.ts";
import type { CaseRunner, ChildRun, ListedCase, Side } from "./child.ts";
import { type CompareOptions, compare } from "./compare.ts";
import { renderMarkdown } from "./report.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A tree with only a bench/budgets.json. */
function tree(budgets: object = {}): string {
  const root = mkdtempSync(join(tmpdir(), "mitori-cmp-"));
  dirs.push(root);
  mkdirSync(join(root, "bench"));
  writeFileSync(join(root, "bench/budgets.json"), JSON.stringify({ v: "mitori.budgets/1", budgets: [], counters: [], ...budgets }));
  return root;
}

const side = (name: "base" | "head", root: string): Side => ({ name, root, env: {}, sha: name === "base" ? "b".repeat(40) : "h".repeat(40) });
const MACHINE = { cpu: "test", cores: 1, ramGb: 1, os: "test", bun: "1", node: "1", chrome: null, loadavg: 0, noisy: false };

interface Script {
  cases?: Partial<Record<"base" | "head", ListedCase[]>>;
  /** Values of run number `call` (0-based, per side and id; the re-measure continues the numbering). */
  values: (side: "base" | "head", id: string, call: number) => number[];
  counters?: (side: "base" | "head", id: string) => Record<string, number>;
  error?: (side: "base" | "head", id: string) => string | undefined;
}

function fakeRunner(script: Script, defaultCases: ListedCase[]): CaseRunner & { calls: string[] } {
  const calls: string[] = [];
  const n = new Map<string, number>();
  return {
    calls,
    async list(s) {
      return script.cases?.[s.name] ?? defaultCases;
    },
    async run(s, id) {
      const key = `${s.name}:${id}`;
      const call = n.get(key) ?? 0;
      n.set(key, call + 1);
      calls.push(key);
      const error = script.error?.(s.name, id);
      const entry = {
        ...toSamples(id, "ms", error ? [] : script.values(s.name, id, call)),
        suite: "synthetic" as const,
        mode: "inproc" as const,
        budgetStat: "median" as const,
        ...(error ? { error } : {}),
      };
      const counters = Object.entries(script.counters?.(s.name, id) ?? {}).map(([cid, value]) => ({ id: cid, value }));
      const file: BenchResultFile = {
        v: TEST_FORMATS.benchResult,
        sha: s.sha,
        machine: MACHINE,
        factor: 1,
        factorSource: "assumed",
        startedAt: "",
        results: [entry],
        counters,
      };
      return { entry, counters, file } satisfies ChildRun;
    },
  };
}

const CASE: ListedCase = { id: "t.case", suite: "synthetic", mode: "inproc", unit: "ms" };
const flat = (v: number): number[] => [v, v, v];

function opts(runner: CaseRunner, extra: Partial<CompareOptions> = {}): CompareOptions {
  return { head: side("head", tree()), base: side("base", tree()), runner, pairs: { inproc: 2, process: 2 }, ...extra };
}

describe("BENCH-U-02 compare orchestration (testing spec §6.7)", () => {
  test("base and head alternate: base, head, base, head", async () => {
    const runner = fakeRunner({ values: () => flat(20) }, [CASE]);
    await compare(opts(runner));
    expect(runner.calls).toEqual(["base:t.case", "head:t.case", "base:t.case", "head:t.case"]);
  });

  test("a 25 % slowdown is re-measured with 2P pairs and FAILS when it persists", async () => {
    const runner = fakeRunner({ values: (s) => flat(s === "base" ? 20 : 25) }, [CASE]);
    const r = await compare(opts(runner));
    expect(r.fail).toBe(true);
    expect(r.rows[0]).toMatchObject({ id: "t.case", status: "regressed", reran: true });
    expect(runner.calls).toHaveLength(2 * 2 + 4 * 2); // P pairs, then 2P pairs
    expect(renderMarkdown(r)).toContain("**REGRESSED**");
    expect(renderMarkdown(r)).toContain("FAIL");
  });

  test("a regression that disappears on the re-measure passes", async () => {
    const runner = fakeRunner({ values: (s, _id, call) => flat(s === "base" ? 20 : call < 2 ? 25 : 20) }, [CASE]);
    const r = await compare(opts(runner));
    expect(r.fail).toBe(false);
    expect(r.rows[0]).toMatchObject({ status: "ok", reran: true });
  });

  test("an 18 % slowdown passes without a re-measure", async () => {
    const runner = fakeRunner({ values: (s) => flat(s === "base" ? 100 : 118) }, [CASE]);
    const r = await compare(opts(runner));
    expect(r.fail).toBe(false);
    expect(r.rows[0]).toMatchObject({ status: "ok", reran: false });
    expect(runner.calls).toHaveLength(4);
  });

  test("a noisy metric only warns, after one re-measure", async () => {
    const runner = fakeRunner({ values: (s, _i, c) => (s === "base" ? flat(20) : [5, 60, 5, 60, 5 + c]) }, [CASE]);
    const r = await compare(opts(runner));
    expect(r.fail).toBe(false);
    expect(r.rows[0]).toMatchObject({ status: "noisy", reran: true });
  });

  test("a faster head is reported as improved", async () => {
    const r = await compare(opts(fakeRunner({ values: (s) => flat(s === "base" ? 100 : 60) }, [CASE])));
    expect(r.rows[0]?.status).toBe("improved");
    expect(r.fail).toBe(false);
    expect(renderMarkdown(r)).toContain("consider tightening");
  });

  test("a case that does not exist in base is new: no relative verdict, no failure", async () => {
    const runner = fakeRunner({ cases: { base: [] }, values: () => flat(20) }, [CASE]);
    const r = await compare(opts(runner));
    expect(r.rows[0]?.status).toBe("new");
    expect(r.fail).toBe(false);
    expect(runner.calls.every((c) => c.startsWith("head:"))).toBe(true);
  });

  test("a case that threw in head fails the run", async () => {
    const r = await compare(opts(fakeRunner({ values: () => flat(1), error: (s) => (s === "head" ? "boom" : undefined) }, [CASE])));
    expect(r.rows[0]).toMatchObject({ status: "error" });
    expect(r.fail).toBe(true);
  });

  test("an unreadable base tree is a warning, not a crash", async () => {
    const runner = fakeRunner({ values: () => flat(20) }, [CASE]);
    runner.list = async (s, _sel, warn) => {
      if (s.name === "base") {
        warn("base: could not list bench cases: boom");
        return [];
      }
      return [CASE];
    };
    const r = await compare(opts(runner));
    expect(r.warnings.join("\n")).toContain("could not list");
    expect(r.rows[0]?.status).toBe("new");
  });

  test("cases only in base are called out", async () => {
    const r = await compare(opts(fakeRunner({ cases: { base: [CASE, { ...CASE, id: "t.gone" }], head: [CASE] }, values: () => flat(20) }, [CASE])));
    expect(r.warnings.join("\n")).toContain("t.gone");
  });
});

describe("BENCH-U-03 counters: head may not exceed base", () => {
  const run = (head: number, base: number, extra: Partial<CompareOptions> = {}, budgets?: { head?: object; base?: object }) =>
    compare({
      ...opts(fakeRunner({ values: () => flat(20), counters: (s) => ({ "t.calls": s === "head" ? head : base }) }, [CASE]), extra),
      head: side("head", tree(budgets?.head)),
      base: side("base", tree(budgets?.base)),
    });

  test("an increase fails", async () => {
    const r = await run(1, 0);
    expect(r.counters[0]).toMatchObject({ id: "t.calls", base: 0, head: 1, fail: true });
    expect(r.fail).toBe(true);
  });

  test("equal or lower passes", async () => {
    expect((await run(0, 0)).fail).toBe(false);
    expect((await run(1, 2)).fail).toBe(false);
  });

  test("an increase is allowed only with budget-change AND a raised max in head's budgets", async () => {
    const raised = { counters: [{ id: "t.calls", max: 5, owner: "x", measure: "a#b" }] };
    const old = { counters: [{ id: "t.calls", max: 0, owner: "x", measure: "a#b" }] };
    expect((await run(1, 0, { budgetChange: true }, { head: raised, base: old })).fail).toBe(false);
    const denied = await run(1, 0, { budgetChange: true }, { head: old, base: old });
    expect(denied.fail).toBe(true);
    expect(denied.counters[0]?.note).toContain("raised");
    expect((await run(1, 0, { budgetChange: false }, { head: raised, base: old })).fail).toBe(true);
  });

  test("a counter new in head is held to its own max", async () => {
    const r = await compare({
      ...opts(fakeRunner({ cases: { base: [] }, values: () => flat(20), counters: () => ({ "t.calls": 3 }) }, [CASE])),
      head: side("head", tree({ counters: [{ id: "t.calls", max: 2, owner: "x", measure: "a#b" }] })),
    });
    expect(r.counters[0]).toMatchObject({ base: null, fail: true });
  });
});

describe("BENCH-U-04 absolute and structural gates on head", () => {
  const budget = {
    id: "t.case",
    metric: "m",
    target: 10,
    limit: 30,
    unit: "ms",
    dir: "max",
    gates: ["relative", "absolute"],
    owner: "x",
    measure: "a#b",
    scale: "machine",
    provisional: false,
  };

  test("a time budget over its limit fails on the reference machine", async () => {
    const r = await compare({
      ...opts(fakeRunner({ values: () => flat(40) }, [CASE]), { factor: { factor: 1, source: "measured" } }),
      head: side("head", tree({ budgets: [budget] })),
    });
    expect(r.gate?.verdicts[0]).toMatchObject({ id: "t.case", level: "red", gating: true });
    expect(r.fail).toBe(true);
  });

  test("on another machine the same overshoot is only a warning", async () => {
    const r = await compare({
      ...opts(fakeRunner({ values: () => flat(40) }, [CASE]), { factor: { factor: 1.5, source: "measured" } }),
      head: side("head", tree({ budgets: [{ ...budget, limit: 20 }] })),
    });
    expect(r.gate?.verdicts[0]).toMatchObject({ level: "red", gating: false, scaled: true });
    expect(r.fail).toBe(false);
    expect(r.warnings.join("\n")).toContain("reference machine");
  });

  test("a structural budget gates everywhere", async () => {
    const structural = { ...budget, gates: ["structural"], scale: "none", unit: "ms" };
    const r = await compare({
      ...opts(fakeRunner({ values: () => flat(40) }, [CASE]), { factor: { factor: 3, source: "measured" } }),
      head: side("head", tree({ budgets: [structural] })),
    });
    expect(r.fail).toBe(true);
  });

  test("--no-absolute skips the budget gate", async () => {
    const r = await compare({
      ...opts(fakeRunner({ values: () => flat(40) }, [CASE]), { absolute: false }),
      head: side("head", tree({ budgets: [budget] })),
    });
    expect(r.gate).toBeNull();
    expect(r.fail).toBe(false);
  });
});
