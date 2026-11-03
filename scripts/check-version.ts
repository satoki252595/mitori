// Version gate (owner: WP37): `apps/cli/package.json` is the single source of truth.
// Usage: bun scripts/check-version.ts   (exit 1 when the root manifest drifts)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

/** Compare the two manifests; empty means they agree. */
export function checkVersions(versions: { root: string; cli: string }): string[] {
  if (versions.root !== versions.cli) return [`package.json is ${versions.root} but apps/cli/package.json is ${versions.cli}`];
  return [];
}

if (import.meta.main) {
  const root = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  const cli = (JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as { version: string }).version;
  const problems = checkVersions({ root, cli });
  for (const p of problems) console.error(`check-version: ${p}`);
  console.log(problems.length ? `check-version: ${problems.length} problem(s)` : `check-version: ok (${cli})`);
  process.exit(problems.length ? 1 : 0);
}
