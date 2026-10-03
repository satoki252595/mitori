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
