// Fixture access for doc tests. `buildFixture` lives in @mitori/testkit, which this package's tsc project cannot
// reference (testkit references doc), so the fixture is materialized by a child `bun` process.
import { rmSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "../../../..");

/** Build a fixture repo into a temp dir; returns its root and a disposer. */
export function buildFixtureRepo(name: string): { root: string; dispose(): void } {
  const code = `const { buildFixture } = await import("@mitori/testkit"); const r = await buildFixture(${JSON.stringify(name)}); console.log(r.root);`;
  const p = Bun.spawnSync(["bun", "-e", code], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`buildFixture(${name}) failed: ${p.stderr.toString()}`);
  const root = p.stdout.toString().trim().split("\n").pop() as string;
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
