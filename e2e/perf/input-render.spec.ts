import { expect, expectWithinBudget, test } from "../harness/fixtures.ts";
import { inputRender1000, openMax } from "./lib/max.ts";

test("ui-input-render-1000: real Reader focus paints with 4× CPU throttle", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const o = await openMax(browser);
  try {
    const r = await inputRender1000(o);
    info.annotations.push({ type: "measure", description: JSON.stringify(r) });
    expect(r.blocks).toBe(1000);
    expect(r.ms).toHaveLength(30);
    expect(r.ms.every((ms) => ms > 0)).toBe(true);
    expectWithinBudget("ui.inputRender.1000", r.p95);
  } finally {
    await o.close();
  }
});
