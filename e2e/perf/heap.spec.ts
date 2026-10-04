/**
 * ui.heap.10k (testing spec §6.4): the JS heap after a full GC (CDP) with react (7,252 files, the 10k-file class) open in
 * the Reader of its biggest section. Project `perf`, Chromium only. Same measurement: bench case `ui.heap.10k`.
 */
import { expectWithinBudget, test } from "../harness/fixtures.ts";
import { corpusCopy, corpusDir } from "./lib/corpus.ts";
import { biggestSection, coldOpen, heapMB, readerOpen } from "./lib/ui.ts";

test("ui.heap.10k: react open in the Reader", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "CDP heap usage is Chromium-only");
  test.skip(corpusDir("react") === null, "react is not fetched: bun run corpus:fetch --only react");
  test.setTimeout(240_000);
  const copy = corpusCopy("react");
  const o = await coldOpen(browser, copy.root, { timeoutMs: 120_000 });
  try {
    await o.waitMarks(["mitori:map:painted"], 120_000);
    await readerOpen(o, await biggestSection(o));
    const mb = await heapMB(o.page);
    info.annotations.push({ type: "measure", description: `heap ${mb.toFixed(1)} MB` });
    expectWithinBudget("ui.heap.10k", mb);
  } finally {
    await o.close();
    copy.dispose();
  }
});
