import { expect, test } from "@playwright/test";
import { BASE, configure, WS, waitMark } from "./support/helpers.ts";

test("@wp10a SSE freshness and claim verdict update the visible paragraph without a reload", async ({ page }) => {
  await configure({ generated: true });
  await page.goto(`/w/${WS}/doc/s1`);
  await waitMark(page, "mitori:section:rendered");
  const claim = page.locator(".mc[data-claim]").first();
  const id = await claim.getAttribute("data-claim");
  const block = await claim.evaluate((el) => el.closest(".blk")?.getAttribute("data-b"));
  expect(block).toBeTruthy();
  const emit = async (event: object) => {
    const r = await fetch(`${BASE}/__mock/emit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    expect(r.ok).toBe(true);
  };
  const mb = page.locator(`.blk[data-b="${block}"] > .mb`);
  await emit({ type: "doc.freshness", blocks: [block], freshness: "stale" });
  await expect(mb).toHaveAttribute("data-fresh", "stale");
  await emit({ type: "doc.claims", claims: [{ id, block, verdict: "stale", checks: {} }] });
  await expect(claim).toHaveAttribute("data-verdict", "stale");
  await expect(claim).toHaveAttribute("aria-describedby", "sr-verdict-stale");
  await emit({ type: "doc.freshness", blocks: [block], freshness: "fresh" });
  await emit({ type: "doc.claims", claims: [{ id, block, verdict: "human-verified", checks: {} }] });
  await expect(mb).toHaveAttribute("data-fresh", "fresh");
  await expect(claim).toHaveAttribute("data-verdict", "human-verified");
  await expect(claim).not.toHaveAttribute("aria-describedby");
});
