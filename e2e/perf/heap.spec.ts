/**
 * ui.heap.10k (testing spec §6.4): the JS heap after a full GC (CDP) with react (7,252 files, the 10k-file class) open in
 * the Reader of its biggest section and the palette's workspace index loaded (⌘K + a query) — the main thread plus the
 * page's Workers (the index lives in the palette Worker). The spec's state names a file tree; the web shell has none,
 * the palette index is its workspace-wide structure. Project `perf`, Chromium only. Same measurement: bench case
 * `ui.heap.10k`.
 */
import { expectWithinBudget, test } from "../harness/fixtures.ts";
import { corpusCopy, corpusDir } from "./lib/corpus.ts";
import { biggestSection, coldOpen, heapMB, paletteKeys, readerOpen } from "./lib/ui.ts";

test("ui.heap.10k: react open in the Reader, palette index loaded", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "CDP heap usage is Chromium-only");
  test.skip(corpusDir("react") === null, "react is not fetched: bun run corpus:fetch --only react");
  test.setTimeout(240_000);
  const copy = corpusCopy("react");
  const o = await coldOpen(browser, copy.root, { timeoutMs: 120_000 });
  try {
    await o.waitMarks(["mitori:map:painted"], 120_000);
    await readerOpen(o, await biggestSection(o));
    await paletteKeys(o.page, "use");
    const h = await heapMB(o.page);
    const workers = h.workers.map((w) => w.toFixed(1)).join(" + ") || "none";
    info.annotations.push({ type: "measure", description: `heap ${h.total.toFixed(1)} MB (main ${h.main.toFixed(1)}, workers ${workers})` });
    expectWithinBudget("ui.heap.10k", h.total);
  } finally {
    await o.close();
    copy.dispose();
  }
});
