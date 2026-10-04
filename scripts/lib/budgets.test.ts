import { describe, expect, test } from "bun:test";
import { lintBudgets } from "./budgets.ts";

const ok = {
  id: "idx.s01.cold.100kloc",
  metric: "S0–S1 cold",
  target: 300,
  limit: 500,
  unit: "ms",
  dir: "max",
  gates: ["relative", "absolute"],
  owner: "indexer",
  measure: "bench/idx.bench.ts#s01-cold:crit",
  scale: "machine",
  provisional: false,
  minN: 5,
};

describe("budgets lint", () => {
  test("a valid file passes", () => {
    expect(
      lintBudgets([
        {
          path: "a.json",
          json: {
            v: "mitori.budgets/1",
            budgets: [ok],
            counters: [{ id: "idx.warm.parseCalls", max: 0, owner: "indexer", measure: "bench/idx.bench.ts#warm" }],
          },
        },
      ]),
    ).toEqual([]);
  });

  test("duplicate ids across files, inverted target/limit, bad unit/gates/measure fail", () => {
    const bad = { ...ok, target: 600, unit: "ms/s", gates: ["fast"], measure: "nope", minN: 0 };
    const msgs = lintBudgets([
      { path: "a.json", json: { v: "mitori.budgets/1", budgets: [ok] } },
      { path: "b.json", json: { v: "mitori.budgets/1", budgets: [bad, { ...ok, id: "x.min", dir: "min", target: 0.8, limit: 0.9 }] } },
    ]).map((p) => p.message);
    expect(msgs).toContain("duplicate id (also in a.json)");
    expect(msgs.some((m) => m.startsWith("target 600 is beyond limit 500"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("target 0.8 is beyond limit 0.9"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("unit must be"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("gates must be"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("measure must be"))).toBe(true);
    expect(msgs).toContain("minN must be a positive integer");
  });

  test("format tag is required", () => {
    expect(lintBudgets([{ path: "a.json", json: { budgets: [] } }]).map((p) => p.message)).toEqual(['"v" must be "mitori.budgets/1"']);
  });
});

describe("F4 (nonfunc audit) a budget's measure file must exist, or the entry says why not", () => {
  const doc = (b: Record<string, unknown>) => [{ path: "a.json", json: { v: "mitori.budgets/1", budgets: [{ ...ok, ...b }] } }];
  const exists = (p: string) => p === "bench/idx.bench.ts";
  test("missing file without `unmeasured` ⇒ a problem; with a reason ⇒ fine", () => {
    expect(lintBudgets(doc({ measure: "bench/none.bench.ts#x" }), exists).map((p) => p.message)).toEqual([
      'measure file bench/none.bench.ts does not exist (add it, or say why with "unmeasured")',
    ]);
    expect(lintBudgets(doc({ measure: "bench/none.bench.ts#x", unmeasured: "no harness yet" }), exists)).toEqual([]);
  });
  test("a bench case file or a Playwright spec must name the id it measures (a written budget is not a measured one)", () => {
    const files: Record<string, string> = {
      "bench/idx.bench.ts": `export const c = defineBench({ id: "idx.s01.cold.100kloc", suite: "idx", mode: "process", run: () => 1 });`,
      "bench/other.bench.ts": `export const c = defineBench({ id: "idx.something.else", suite: "idx", mode: "process", run: () => 1 });`,
      "e2e/perf/a.spec.ts": `expectWithinBudget("ui.shellPaint", r.shellPaint);`,
      "e2e/perf/b.spec.ts": `// mentions ui.shellPaint only in prose`,
      "eval/run.ts": "const id = `gen.${name}`;",
    };
    const has = (p: string) => p in files;
    const read = (p: string) => files[p];
    expect(lintBudgets(doc({}), has, read)).toEqual([]);
    expect(lintBudgets(doc({ measure: "bench/other.bench.ts#x" }), has, read).map((p) => p.message)).toEqual([
      'measure file bench/other.bench.ts never names "idx.s01.cold.100kloc" (no case or check measures it there)',
    ]);
    expect(lintBudgets(doc({ id: "ui.shellPaint", measure: "e2e/perf/a.spec.ts#x" }), has, read)).toEqual([]);
    expect(lintBudgets(doc({ id: "ui.shellPaint", measure: "e2e/perf/b.spec.ts#x" }), has, read)).toHaveLength(1);
    // a counter is named by its key in a case's counters()
    const counter = [
      {
        path: "a.json",
        json: { v: "mitori.budgets/1", counters: [{ id: "idx.warm.parseCalls", max: 0, owner: "indexer", measure: "bench/idx.bench.ts#warm" }] },
      },
    ];
    expect(lintBudgets(counter, has, read)).toHaveLength(1);
    files["bench/idx.bench.ts"] += `\ncounters: () => ({ "idx.warm.parseCalls": 0 }),`;
    expect(lintBudgets(counter, has, read)).toEqual([]);
    // files that build their ids (eval, size tables, golden tests) are not read; without `read` nothing is read
    expect(lintBudgets(doc({ id: "gen.cite.l0", measure: "eval/run.ts#cite:l0" }), has, read)).toEqual([]);
    expect(lintBudgets(doc({ measure: "bench/other.bench.ts#x" }), has)).toEqual([]);
  });

  test("an existing file with `unmeasured` ⇒ drop it; an empty reason is refused", () => {
    expect(lintBudgets(doc({ unmeasured: "stale note" }), exists).map((p) => p.message)).toEqual(['measure file bench/idx.bench.ts exists: drop "unmeasured"']);
    expect(lintBudgets(doc({ measure: "bench/none.bench.ts#x", unmeasured: " " }), exists).map((p) => p.message)).toEqual([
      "unmeasured must be a non-empty reason",
    ]);
  });
});
