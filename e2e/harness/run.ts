// `bun run e2e [playwright args]` (MILESTONES WP-12): the Playwright runner with the harness config.
//   bun run e2e --grep @wp10a            feature specs live in e2e/<area>/*.spec.ts
//   bun run e2e --project webkit          chromium is the default project; `perf` runs with one worker
//   MITORI_E2E_CHANNEL=chrome             use the installed Google Chrome instead of the bundled Chromium
//   MITORI_E2E_BINARY=compiled            start daemons from dist/mitori-<os>-<arch> instead of from source
//   MITORI_MACHINE_FACTOR=<n>             skip the calibration of a perf run (time budgets gate only at a factor within 10 % of 1)
// Without any spec file it succeeds with a note, like the other owned runners.

import { resolve } from "node:path";
import { machineFactor } from "@mitori/testkit";
import { Glob } from "bun";

const ROOT = resolve(import.meta.dir, "../..");
const CONFIG = "e2e/harness/playwright.config.ts";

/** Spec files below e2e/ (`*.spec.ts`, plus the harness' own `*.e2e.ts` self-test; node_modules does not count). */
export function findSpecs(root = ROOT): string[] {
  return [...new Glob("**/*.{spec,e2e}.ts").scanSync({ cwd: `${root}/e2e` })].filter((f) => !f.includes("node_modules/")).sort();
}

/** Every `--project x` / `--project=x` of the arguments. */
export function namedProjects(argv: readonly string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a.startsWith("--project=")) out.push(a.slice("--project=".length));
    else if (argv[i - 1] === "--project") out.push(a);
  });
  return out;
}

/** Arguments for `playwright test`: chromium unless a project is named, and one worker for `perf` (§5.1). */
export function playwrightArgs(argv: readonly string[]): string[] {
  const args = [...argv];
  const projects = namedProjects(args);
  if (projects.length === 0) args.push("--project=chromium");
  if (projects.includes("perf") && !args.some((a) => a.startsWith("--workers"))) args.push("--workers=1");
  return args;
}

if (import.meta.main) {
  if (findSpecs().length === 0) {
    console.log("e2e: no specs yet (e2e/**/*.spec.ts)");
    process.exit(0);
  }
  const argv = process.argv.slice(2);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  // time budgets gate in the perf project on the reference machine only: the workers need the factor (Bun calibrates, Node cannot)
  if (namedProjects(argv).includes("perf") && !env.MITORI_MACHINE_FACTOR) {
    env.MITORI_MACHINE_FACTOR = String(await machineFactor());
    console.log(`e2e: machine factor ${Number(env.MITORI_MACHINE_FACTOR).toFixed(2)}`);
  }
  const proc = Bun.spawn(["node", `${ROOT}/node_modules/@playwright/test/cli.js`, "test", "-c", CONFIG, ...playwrightArgs(argv)], {
    cwd: ROOT,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await proc.exited);
}
