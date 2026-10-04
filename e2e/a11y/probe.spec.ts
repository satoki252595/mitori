/**
 * ui.a11y.contrast / ui.a11y.textSize / ui.a11y.target (testing spec §5.4, ux §13.2) on the map (S1) and the Reader (S2) of
 * the real daemon with go-small, light and dark:
 * - contrast: elements failing AA contrast (axe's `color-contrast` rule, every impact level),
 * - text size: visible text under 11 px, control labels under 12 px,
 * - target: pointer targets under 24×24 px with another target within 24 px (WCAG 2.5.8; inline text links exempt).
 * All three are structural budgets (max 0). Run: `bun run e2e --grep @a11y`.
 */
import { ui } from "@mitori/testkit";
import { expectWithinBudget, test } from "../harness/fixtures.ts";
import { probe, SCREENS } from "./screens.ts";

test.use({ daemonOptions: { fixture: "go-small" } });

for (const scheme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`@a11y probes: ${screen.name} (${scheme})`, async ({ page, mitori }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await screen.open(page, mitori);
      await ui.axe(page); // injects axe-core into the page (window.axe) for the contrast rule below
      const contrast = await page.evaluate(async () => {
        const axe = (window as unknown as { axe?: { run(ctx: unknown, o: unknown): Promise<{ violations: { nodes: unknown[] }[] }> } }).axe;
        if (!axe) return null;
        const r = await axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
        return r.violations.reduce((n, v) => n + v.nodes.length, 0);
      });
      const p = await probe(page);
      info.annotations.push({ type: "probe", description: JSON.stringify({ contrast, ...p }) });
      if (contrast !== null) expectWithinBudget("ui.a11y.contrast", contrast);
      expectWithinBudget("ui.a11y.textSize", p.smallText.length);
      expectWithinBudget("ui.a11y.target", p.smallTargets.length);
    });
  }
}
