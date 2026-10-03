// `bun run e2e [playwright args]` (MILESTONES WP-12): the Playwright runner with the harness config.
//   bun run e2e --grep @wp10a            feature specs live in e2e/<area>/*.spec.ts
//   bun run e2e --project webkit          chromium is the default project; `perf` runs with one worker
//   MITORI_E2E_CHANNEL=chrome             use the installed Google Chrome instead of the bundled Chromium
//   MITORI_E2E_BINARY=compiled            start daemons from dist/mitori-<os>-<arch> instead of from source
// Without any spec file it succeeds with a note, like the other owned runners.

import { resolve } from "node:path";
import { Glob } from "bun";

const ROOT = resolve(import.meta.dir, "../..");
const CONFIG = "e2e/harness/playwright.config.ts";

/** Spec files below e2e/ (`*.spec.ts`, plus the harness' own `*.e2e.ts` self-test; node_modules does not count). */
export function findSpecs(root = ROOT): string[] {
  return [...new Glob("**/*.{spec,e2e}.ts").scanSync({ cwd: `${root}/e2e` })].filter((f) => !f.includes("node_modules/")).sort();
}

/** Arguments for `playwright test`: chromium unless a project is named, and one worker for `perf` (§5.1). */
export function playwrightArgs(argv: readonly string[]): string[] {
  const args = [...argv];
  const project = args.find((a, i) => a.startsWith("--project=") || args[i - 1] === "--project");
  const projects = project ? [project.replace(/^--project=/, "")] : [];
  if (projects.length === 0) args.push("--project=chromium");
  if (projects.includes("perf") && !args.some((a) => a.startsWith("--workers"))) args.push("--workers=1");
  return args;
}

if (import.meta.main) {
  if (findSpecs().length === 0) {
    console.log("e2e: no specs yet (e2e/**/*.spec.ts)");
    process.exit(0);
  }
  const proc = Bun.spawn(["node", `${ROOT}/node_modules/@playwright/test/cli.js`, "test", "-c", CONFIG, ...playwrightArgs(process.argv.slice(2))], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await proc.exited);
}
