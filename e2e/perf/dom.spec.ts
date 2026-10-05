import { expect, expectWithinBudget, test } from "../harness/fixtures.ts";
import { maxDom, mountedCodeLines, openMax, reviewDom5000 } from "./lib/max.ts";

test("ui-dom-max: 20 sections, open Deep Dive, Inbox 500, ready Review 5,000", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const o = await openMax(browser);
  try {
    const r = await maxDom(o);
    info.annotations.push({ type: "measure", description: JSON.stringify(r) });
    expect(r.sections).toBe(20);
    expect(r.inboxThreads).toBeGreaterThanOrEqual(500);
    expect(r.diffLines).toBeGreaterThanOrEqual(5000);
    expectWithinBudget("ui.dom.max", r.max);
  } finally {
    await o.close();
  }
});

test("ui-code-lines-mounted: scroll windows in a real 20,000-line file", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const o = await openMax(browser, true);
  try {
    const r = await mountedCodeLines(o);
    info.annotations.push({ type: "measure", description: JSON.stringify(r) });
    expect(r.totalLines).toBe(20_000);
    expect(r.max).toBeGreaterThan(0);
    expectWithinBudget("ui.codeLines.mounted", r.max);
  } finally {
    await o.close();
  }
});

test("ui-review-diff-5000: ready diff before human accept", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const o = await openMax(browser);
  try {
    const r = await reviewDom5000(o);
    info.annotations.push({ type: "measure", description: JSON.stringify(r) });
    expect(r.diffLines).toBeGreaterThanOrEqual(5000);
    expect(r.max).toBeGreaterThan(0);
    expectWithinBudget("ui.reviewDiff5000.dom", r.max);
  } finally {
    await o.close();
  }
});
