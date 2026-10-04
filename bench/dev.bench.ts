// dev.check — the development loop gate (testing spec §1.6): wall time of `bun run check` (tsc -b · biome · boundaries ·
// CR ledger · budgets · contract index · svelte-check, in parallel). tsc's incremental build info stays warm between
// runs, as in a developer's loop; the first, discarded run brings it up to date.
import { REPO_ROOT } from "./lib/child.ts";
import { defineBench } from "./runner/define.ts";

export const check = defineBench({
  id: "dev.check",
  suite: "dev",
  mode: "process",
  runs: 3,
  async run() {
    const t0 = performance.now();
    const p = Bun.spawn([process.execPath, "run", "check"], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    // both streams are drained (an unread pipe that fills would stall the child) and both explain a failure
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    const ms = performance.now() - t0;
    if (code !== 0) throw new Error(`bun run check failed:\n${`${out}\n${err}`.trim().split("\n").slice(-12).join("\n")}`);
    return ms;
  },
});
