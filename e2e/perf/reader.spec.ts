/**
 * Reader interactions on the REAL daemon (testing spec §5.2 E2E-05/06, §6.4, §6.6), project `perf`, on a copy of crit:
 * Reader open (ui.fetch.readerOpen, ui.dom.typical, ui.listeners.reader), reader level `-` `=` `0` (ui.level, 0 requests:
 * ui.fetch.levelSwitch), ⌘K per-key results (ui.palette), j/k (ui.shortcut), TOC section transitions (ui.section) and
 * the INP-equivalent of a mixed scenario (ui.inp: p98 against the limit, p75 against the target).
 * The same measurements are bench cases (bench/ui.bench.ts).
 */
import { expect, expectWithinBudget, test } from "../harness/fixtures.ts";
import { corpusCopy, corpusDir } from "./lib/corpus.ts";
import {
  biggestSection,
  type ColdOpen,
  coldOpen,
  firstUse,
  inpScenario,
  levelSwitch,
  median,
  p95,
  paletteKeys,
  readerListeners,
  readerOpen,
  sectionNav,
  shortcutKeys,
} from "./lib/ui.ts";

test.describe.configure({ mode: "serial" });

test.describe("Reader interactions (perf)", () => {
  test.skip(corpusDir("crit") === null, "crit is not fetched: bun run corpus:fetch --only crit");
  let o: ColdOpen;
  let copy: { root: string; dispose(): void };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    copy = corpusCopy("crit");
    o = await coldOpen(browser, copy.root);
    await firstUse(o);
  });
  test.afterAll(async () => {
    await o?.close();
    copy?.dispose();
  });

  test("Reader open: requests, DOM and event listeners", async ({ browserName: _b }, info) => {
    const r = await readerOpen(o, await biggestSection(o));
    info.annotations.push({ type: "measure", description: JSON.stringify({ rendered: r.rendered, dom: r.dom, requests: r.requests }) });
    expectWithinBudget("ui.dom.typical", r.dom);
    // ui.fetch.readerOpen is a deterministic counter (max 6, provisional): recorded, see bench/ui.bench.ts for the gate
    info.annotations.push({ type: "counter", description: `ui.fetch.readerOpen = ${r.requests}: ${r.urls.map((u) => new URL(u).pathname).join(" ")}` });
    const l = await readerListeners(o.page);
    info.annotations.push({ type: "measure", description: `listeners ${JSON.stringify(l)}` });
    expectWithinBudget("ui.listeners.reader", l.total);
  });

  test("reader level switch: latency, no request", async ({ browserName: _b }, info) => {
    const r = await levelSwitch(o.page, 3);
    info.annotations.push({ type: "measure", description: JSON.stringify(r) });
    expect(r.requests, "ui.fetch.levelSwitch").toBe(0);
    expectWithinBudget("ui.level", median(r.ms));
  });

  test("⌘K: per-key results", async ({ browserName: _b }, info) => {
    const ms = await paletteKeys(o.page);
    info.annotations.push({ type: "measure", description: JSON.stringify(ms) });
    expectWithinBudget("ui.palette", p95(ms));
  });

  test("j / k shortcuts", async ({ browserName: _b }, info) => {
    const ms = await shortcutKeys(o.page);
    info.annotations.push({ type: "measure", description: JSON.stringify(ms) });
    expectWithinBudget("ui.shortcut", p95(ms));
  });

  test("section transitions through the TOC", async ({ browserName: _b }, info) => {
    // A focused run must measure Reader TOC links rather than the map's header link.
    if (!new URL(o.page.url()).pathname.includes("/doc/")) await readerOpen(o, await biggestSection(o));
    const ms = await sectionNav(o.page);
    info.annotations.push({ type: "measure", description: JSON.stringify(ms) });
    const actions = await o.page.evaluate(() => performance.getEntriesByName("mitori:bench:section-result", "mark").map((m) => (m as PerformanceMark).detail));
    info.annotations.push({ type: "measure", description: JSON.stringify({ sectionActions: actions }) });
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expectWithinBudget("ui.section", p95(ms));
  });

  test("INP-equivalent of the mixed scenario", async ({ browserName: _b }, info) => {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await inpScenario(o.page));
    info.annotations.push({ type: "measure", description: JSON.stringify(runs) });
    expect(runs.every((r) => r.count >= 30)).toBe(true); // 37 interactions (a static doc has no Composer / cite pins)
    expectWithinBudget("ui.inp", median(runs.map((r) => r.p98)));
  });
});
