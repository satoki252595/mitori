import { expectWithinBudget, test } from "../harness/fixtures.ts";
import { corpusCopy, corpusDir } from "./lib/corpus.ts";
import { coldOpen } from "./lib/ui.ts";

test.describe("E2E-01 scanSummary (perf)", () => {
  test.skip(corpusDir("crit") === null, "crit is not fetched: bun run corpus:fetch --only crit");
  test("CLI spawn to painted scan summary on crit", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const copy = corpusCopy("crit");
    const o = await coldOpen(browser, copy.root);
    try {
      const [at] = await o.waitMarks(["mitori:scan:summary"]);
      const ms = (at as number) - o.t0;
      info.annotations.push({ type: "measure", description: JSON.stringify({ scanSummary: ms }) });
      expectWithinBudget("ui.scanSummary", ms);
    } finally {
      await o.close();
      copy.dispose();
    }
  });
});
