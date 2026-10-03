import { describe, expect, test } from "bun:test";
import { checkBudgets, mergeBudgets, REFERENCE, renderJson, renderMerged, type SourceFile } from "./budgets-merge.ts";

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  metric: "m",
  target: 1,
  limit: 2,
  unit: "ms",
  dir: "max",
  gates: ["relative"],
  owner: "indexer",
  measure: "bench/x.bench.ts#case",
  scale: "machine",
  provisional: false,
  ...extra,
});
const file = (path: string, budgets: unknown[], counters?: unknown[]): SourceFile => ({
  path,
  json: { v: "mitori.budgets/1", budgets, ...(counters ? { counters } : {}) },
});

describe("budgets-merge", () => {
  const a = file("bench/budgets/b.json", [entry("b.one")], [{ id: "b.count", max: 0, owner: "b", measure: "bench/x.bench.ts#c" }]);
  const b = file("bench/budgets/a.json", [entry("a.one"), entry("a.two")]);

  test("merges per-package files in path order and keeps source order inside a file", () => {
    const m = mergeBudgets([a, b]);
    expect(m.v).toBe("mitori.budgets/1");
    expect(m.reference).toEqual(REFERENCE);
    expect((m.budgets as { id: string }[]).map((x) => x.id)).toEqual(["a.one", "a.two", "b.one"]);
    expect(m.counters).toHaveLength(1);
  });

  test("--check passes only when bench/budgets.json equals a fresh merge", () => {
    const fresh = renderMerged(mergeBudgets([a, b]));
    expect(checkBudgets([a, b], fresh)).toEqual([]);
    expect(checkBudgets([a, b], `${fresh} `)[0]).toMatch(/out of date/);
    expect(checkBudgets([a, b], undefined)[0]).toMatch(/missing/);
  });

  test("duplicate ids across files and a missing unit are reported", () => {
    const dup = file("bench/budgets/c.json", [entry("a.one"), entry("c.nounit", { unit: undefined })]);
    const msgs = checkBudgets([a, b, dup], undefined).join("\n");
    expect(msgs).toMatch(/duplicate id/);
    expect(msgs).toMatch(/c\.nounit: unit is missing/);
  });

  test("renderJson matches biome's layout: objects expanded, short flat arrays inline", () => {
    expect(renderJson({ a: [1, "x"], b: [], c: { d: [{ e: 1 }] } })).toBe(
      ["{", '  "a": [1, "x"],', '  "b": [],', '  "c": {', '    "d": [', "      {", '        "e": 1', "      }", "    ]", "  }", "}"].join("\n"),
    );
  });
});
