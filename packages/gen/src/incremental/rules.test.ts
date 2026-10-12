import { describe, expect, test } from "bun:test";
import type { BlockId, ModuleId, SectionId } from "@mitori/core";
import { evaluate, type RuleInput, staleRatio, type Unit, unitOf } from "./rules.ts";

const fp = { flows: "f1", schema: "s1", structure: "t1" };
const base = (over: Partial<RuleInput["base"]> = {}): RuleInput["base"] => ({ v: 1, iface: {}, estimates: [], ...fp, ...over });
const blk = (id: string, total: number, stale: number) => ({ id: `b_${id}` as BlockId, total, stale });
const unit = (section: string, blocks: Unit["blocks"], module?: Unit["module"]): Unit =>
  module ? { section: section as SectionId, blocks, module } : { section: section as SectionId, blocks };
const leaf = (id: string, iface = "i1"): Unit["module"] => ({ id: id as ModuleId, leaf: true, children: [], iface });
const run = (units: Unit[], b = base(), unlabeled: ModuleId[] = []) =>
  evaluate({ units, base: b, now: fp, unlabeled }).map((s) => `${s.rule} ${s.kind} ${s.section} ${s.prompt} [${s.blocks.join(",")}]`);

describe("GEN-S9-R early cutoff rules (§11.3)", () => {
  test("unit of a section", () => {
    expect(["s0", "s1", "s2", "s3", "s3/login", "s4", "s5", "s7", "s8", "s9", "s12", "s13", "appendix"].map((s) => unitOf(s as SectionId, false))).toEqual([
      "s0",
      "s0",
      "s0",
      "s3",
      "s3",
      null,
      null,
      "s7",
      null,
      "s9",
      "s12",
      "s13",
      null,
    ]);
    expect(unitOf("s6/session", true)).toBe("s6/session");
    expect(unitOf("s6/session", false)).toBeNull();
  });

  test("R2 strictly above 20 %: exactly 20 % is still a doc.sync patch", () => {
    const m = leaf("md_a0000001");
    expect(staleRatio({ blocks: [blk("aaaaaaa1", 5, 1)] })).toBe(0.2);
    expect(run([unit("s6/a", [blk("aaaaaaa1", 5, 1)], m)])).toEqual(["R3 sync s6/a doc.sync [b_aaaaaaa1]"]);
    expect(run([unit("s6/a", [blk("aaaaaaa1", 4, 1), blk("aaaaaaa2", 1, 0)], m)])).toEqual(["R3 sync s6/a doc.sync [b_aaaaaaa1]"]);
    expect(run([unit("s6/a", [blk("aaaaaaa1", 9, 2)], m)])).toEqual(["R2 regen s6/a gen.module []"]);
  });

  test("one suggestion per unit: R1 wins over R2 / R3; a page without stale claims and changes gets nothing", () => {
    const m = leaf("md_a0000001", "i2");
    const b = base({ iface: { md_a0000001: "i1" } as Record<ModuleId, string> });
    expect(run([unit("s6/a", [blk("aaaaaaa1", 2, 2)], m)], b)).toEqual(["R1 regen s6/a gen.module []"]);
    expect(run([unit("s6/a", [blk("aaaaaaa1", 2, 0)], leaf("md_a0000001", "i1"))], b)).toEqual([]);
  });

  test("an unknown baseline never fires (first sight is seeded, not suggested)", () => {
    expect(run([unit("s6/a", [blk("aaaaaaa1", 2, 0)], leaf("md_a0000001", "i9"))])).toEqual([]);
    const { flows: _, ...noFlows } = base();
    expect(run([unit("s3", [blk("aaaaaaa1", 2, 0)])], noFlows)).toEqual([]);
  });

  test("R4: the parent is regenerated only with a child R1 and its own digest changed", () => {
    const child = leaf("md_a0000001", "i2");
    const parent: Unit["module"] = { id: "md_p0000001" as ModuleId, leaf: false, children: ["md_a0000001" as ModuleId], iface: "p2" };
    const b = base({ iface: { md_a0000001: "i1", md_p0000001: "p1" } as Record<ModuleId, string> });
    expect(run([unit("s6/p", [blk("ppppppp1", 1, 0)], parent), unit("s6/a", [blk("aaaaaaa1", 1, 0)], child)], b)).toEqual([
      "R4 regen s6/p gen.parent []",
      "R1 regen s6/a gen.module []",
    ]);
    const same = base({ iface: { md_a0000001: "i1", md_p0000001: "p2" } as Record<ModuleId, string> });
    expect(run([unit("s6/p", [blk("ppppppp1", 1, 0)], parent), unit("s6/a", [blk("aaaaaaa1", 1, 0)], child)], same)).toEqual(["R1 regen s6/a gen.module []"]);
  });

  test("R5 / R6 / R7 compare the section baselines; R7 adds the labels of unnamed modules", () => {
    const b = base({ flows: "f0", schema: "s0", structure: "t0" });
    expect(
      run([unit("s0", [blk("ooooooo1", 1, 0)]), unit("s3", [blk("fffffff1", 1, 0)]), unit("s7", [blk("ddddddd1", 1, 0)])], b, ["md_a0000009" as ModuleId]),
    ).toEqual(["R7 regen s0 gen.overview []", "R7 regen s5 gen.labels []", "R5 regen s3 gen.flows []", "R6 regen s7 gen.datamodel []"]);
    // without the fact changes the same units only get their stale patches
    expect(run([unit("s3", [blk("fffffff1", 2, 1)]), unit("s7", [blk("ddddddd1", 3, 0)])])).toEqual(["R3 sync s3 doc.sync [b_fffffff1]"]);
  });

  test("R8: §9–§13 regenerate above 20 % stale claims, else patch", () => {
    expect(run([unit("s9", [blk("qqqqqqq1", 3, 1)]), unit("s11", [blk("rrrrrrr1", 10, 1)]), unit("s13", [blk("uuuuuuu1", 0, 0)])])).toEqual([
      "R8 regen s9 gen.quality []",
      "R8 sync s11 doc.sync [b_rrrrrrr1]",
    ]);
  });
});

describe("WP-19 prompt version bumps never regenerate by themselves (§11.3)", () => {
  test("a version bump alone suggests nothing: unchanged code and fresh claims ⇒ no suggestion on any unit", () => {
    // evaluate() takes no prompt version input: opening, showing or exporting an existing doc
    // after a gen.module / gen.parent bump must not mark its pages stale or queue a regen.
    const b = base({ iface: { md_a0000001: "i1", md_a0000002: "i2" } as Record<ModuleId, string> });
    expect(
      run(
        [
          unit("s6/a", [blk("aaaaaaa1", 4, 0)], leaf("md_a0000001", "i1")),
          unit("s6/b", [blk("bbbbbbb1", 4, 0)], leaf("md_a0000002", "i2")),
          unit("s3", [blk("fffffff1", 2, 0)]),
          unit("s9", [blk("qqqqqqq1", 5, 0)]),
        ],
        b,
      ),
    ).toEqual([]);
  });

  test("a code change regenerates only the changed module: untouched modules are not rebuilt for the version gap", () => {
    const b = base({ iface: { md_a0000001: "i1", md_a0000002: "i2" } as Record<ModuleId, string> });
    expect(
      run([unit("s6/a", [blk("aaaaaaa1", 4, 0)], leaf("md_a0000001", "i9")), unit("s6/b", [blk("bbbbbbb1", 4, 0)], leaf("md_a0000002", "i2"))], b),
    ).toEqual(["R1 regen s6/a gen.module []"]);
  });
});
