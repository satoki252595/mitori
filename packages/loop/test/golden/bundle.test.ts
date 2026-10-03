import { describe, expect, test } from "bun:test";
import { createBundleBuilder } from "../../src/bundle/index.ts";
import { codeAnchor, msg, thread } from "../../src/bundle/test/builders.ts";
import { CASES, FETCH, goSmallWorld } from "../../src/bundle/test/cases.ts";
import { expectGoldenText } from "../../src/bundle/test/golden.ts";
import { checkGrammar } from "../../src/bundle/test/grammar.ts";
import { bundleInput } from "../../src/bundle/test/world.ts";
import { BUNDLE_TIERS } from "../../src/contract.ts";

// AC-L21 / AC-L23: MBF/1 bundles over the go-small fixture are byte-for-byte golden, and their token estimates fall
// in the windows of the budget tiers (XS 0.4–0.7k, S ≈ 1.1k, M 3.5–5k, L 9–12k). MBF/1 is frozen: a byte change here
// needs a FORMAT.bundle bump and `MITORI_UPDATE_GOLDEN=1` in a `golden:` commit.

describe("loop.bundle golden (go-small)", () => {
  const w = goSmallWorld();
  const builder = createBundleBuilder(w.deps);

  for (const c of CASES) {
    test(`LOOP-U-013 ${c.name}.${c.tier}: bytes and tokens`, async () => {
      const r = await c.run(builder, w);
      checkGrammar(r.text);
      expectGoldenText(`go-small/bundles/${c.name}.${c.tier}.txt`, r.text);
      expectGoldenText(`go-small/bundles/${c.name}.${c.tier}.tokens`, `${r.tokens}\n`);
      if (c.window) {
        const [lo, hi] = BUNDLE_TIERS[c.tier].expect;
        expect([c.name, c.tier, r.tokens >= lo && r.tokens <= hi]).toEqual([c.name, c.tier, true]);
      }
    });
  }

  // The measure hooks of bench/budgets/loop.json (`…/bundle.test.ts#tokens:<tier>`): every push golden of the tier is in its window.
  for (const tier of ["XS", "S", "M", "L"] as const) {
    test(`tokens:${tier}`, async () => {
      const cases = CASES.filter((c) => c.window && c.tier === tier);
      expect(cases.length).toBeGreaterThan(0);
      const [lo, hi] = BUNDLE_TIERS[tier].expect;
      for (const c of cases) {
        const { tokens } = await c.run(builder, w);
        expect([c.name, tokens >= lo && tokens <= hi]).toEqual([c.name, true]);
      }
    });
  }

  test("tier windows: S sits at ≈ 1.1k ± 15% (the 1.2k line-numbered figure of spec §4.4 is inside the band)", async () => {
    const change = CASES.find((c) => c.name === "change");
    const r = await (change as NonNullable<typeof change>).run(builder, w);
    expect(r.tokens).toBeGreaterThanOrEqual(935);
    expect(r.tokens).toBeLessThanOrEqual(1265);
  });

  test("the same bundle twice is identical, whatever order the cases ran in", async () => {
    for (const c of [...CASES].reverse()) {
      const a = await c.run(builder, w);
      const b = await c.run(builder, w);
      expect(b.text).toBe(a.text);
    }
  });

  test("an M-tier bundle with the optional parts left out (RULES / REL / THREAD / context) is still well under half its size", async () => {
    const m = CASES.find((c) => c.name === "batch3") as NonNullable<(typeof CASES)[number]>;
    const full = await m.run(builder, w);
    expect(full.tokens).toBeGreaterThan(3500);
    const t = thread({ id: "th_a0000001", anchor: codeAnchor(FETCH, 41, 49), messages: [msg("human", "x", 1)] });
    const small = await builder.build(bundleInput({ threads: [t], write: [FETCH] }), 1);
    expect(small.tokens).toBeLessThan(full.tokens / 2);
  });
});
