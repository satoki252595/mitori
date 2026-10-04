/**
 * ui.a11y.axe (testing spec §5.4): axe-core (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA tags) on the map (S1) and the Reader (S2) of the
 * real daemon with go-small, light and dark. Gate: 0 serious / critical violations (a structural budget — it gates in
 * every project). Run: `bun run e2e --grep @a11y`.
 */
import { ui } from "@mitori/testkit";
import { expectWithinBudget, test } from "../harness/fixtures.ts";
import { SCREENS } from "./screens.ts";

test.use({ daemonOptions: { fixture: "go-small" } });

for (const scheme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`@a11y axe: ${screen.name} (${scheme})`, async ({ page, mitori }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await screen.open(page, mitori);
      const found = await ui.axe(page);
      info.annotations.push({ type: "axe", description: JSON.stringify(found) });
      expectWithinBudget(
        "ui.a11y.axe",
        found.reduce((n, v) => n + v.nodes, 0),
      );
    });
  }
}
