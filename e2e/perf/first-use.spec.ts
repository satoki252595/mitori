/**
 * E2E-01 (testing spec §5.2) on crit (100k LOC class), project `perf`: `mitori <copy of crit> --no-open` spawned with a
 * fresh MITORI_HOME (T0), its login URL in a warm Chromium. ui.shellPaint (T0 → `mitori:shell:painted`),
 * ui.firstUseful.100k (T0 → map and facts painted), ui.cls.boot, and the first screen's DOM / floor-plan nodes.
 * Time budgets gate in the perf project on the reference machine only (expectWithinBudget); structure gates everywhere.
 * The same measurement is the bench case set `ui.*` (bench/ui.bench.ts).
 */
import { expect, expectWithinBudget, test } from "../harness/fixtures.ts";
import { corpusCopy, corpusDir } from "./lib/corpus.ts";
import { coldOpen, firstUse } from "./lib/ui.ts";

test.describe("E2E-01 first use (perf)", () => {
  test.skip(corpusDir("crit") === null, "crit is not fetched: bun run corpus:fetch --only crit");

  test("cold open of crit: shell, first useful screen, boot CLS, DOM", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const copy = corpusCopy("crit");
    const o = await coldOpen(browser, copy.root);
    try {
      const r = await firstUse(o);
      info.annotations.push({ type: "measure", description: JSON.stringify(r) });
      expect(r.firstUseful).toBeGreaterThan(r.shellPaint - 1);
      expectWithinBudget("ui.shellPaint", r.shellPaint);
      expectWithinBudget("ui.firstUseful.100k", r.firstUseful);
      expectWithinBudget("ui.cls.boot", r.cls);
      expectWithinBudget("ui.floorplan.nodes", r.mapNodes);
    } finally {
      await o.close();
      copy.dispose();
    }
  });
});
