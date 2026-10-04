// `test` for every e2e spec (testing spec §5.1): `mitori` is a daemon with its own MITORI_HOME, started per test; set the
// fixture and replay options with `test.use({ daemonOptions: { fixture: "go-small", seedDoc: "generated" } })`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { startTestDaemon, type TestDaemon } from "@mitori/testkit";
import { test as base, expect } from "@playwright/test";
import { type BudgetCheck, checkBudget, envFactor } from "./metrics.ts";

type DaemonOptions = Parameters<typeof startTestDaemon>[0];

interface Fixtures {
  /** The daemon of this test (stopped and cleaned afterwards; its logs are attached when the test fails). */
  mitori: TestDaemon;
  /** Merged over `{ speed: 1, maxDtMs: 200 }` (replay timing, §3.4). */
  daemonOptions: Partial<DaemonOptions>;
}

export const test = base.extend<Fixtures>({
  daemonOptions: [{}, { option: true }],
  mitori: async ({ daemonOptions }, use, testInfo) => {
    const daemon = await startTestDaemon({
      speed: 1,
      maxDtMs: 200,
      binary: process.env.MITORI_E2E_BINARY === "compiled" ? "compiled" : "source",
      ...daemonOptions,
    });
    try {
      await use(daemon);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        // §5.1: a failing test keeps the daemon's logs next to the trace
        const logs = join(daemon.home.dir, "logs");
        if (existsSync(logs)) {
          for (const f of readdirSync(logs)) await testInfo.attach(`daemon-${f}`, { body: readFileSync(join(logs, f)), contentType: "text/plain" });
        }
      }
      await daemon.stop();
    }
  },
});

export { expect };

/**
 * Assert a measurement against its budget: over the limit fails the test, over the target is recorded as a warning. Time budgets
 * fail only in the `perf` project on the reference machine (`checkBudget`); elsewhere they are annotations.
 */
export function expectWithinBudget(id: string, value: number): BudgetCheck {
  const info = test.info();
  const check = checkBudget(id, value, { project: info.project.name, factor: envFactor(), loadavg: loadavg()[0] ?? null, cores: availableParallelism() });
  const unit = check.entry.unit;
  if (check.warned)
    info.annotations.push({
      type: "budget-warning",
      description: check.reportOnly
        ? `${id} = ${value} ${unit} is over its limit ${check.limit} — reported only: ${check.reportOnly}`
        : `${id} = ${value} ${unit} is over its target ${check.target} (limit ${check.limit})`,
    });
  expect(check.failed, `${id} = ${value} ${unit} exceeds its limit ${check.limit}`).toBe(false);
  return check;
}
