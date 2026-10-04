import { expect, test } from "bun:test";
import { removeDir, tempDir } from "./test/fakes.ts";

/**
 * SRV-AT-10 / `srv.rss.idleEmpty`: the empty daemon compiled the way it ships (`bun build --compile --minify`)
 * idles within the budget's limit (50 MB; the 30 MB target is reported, not failed — the bench gate's rule too: only a
 * value beyond the limit is red) and serves the shell. Running from source adds the transpiler (~9 MB), so the probe
 * is compiled first. The time half (shell ≤ 0.3 s) is the bench cases ui.shellPaint / srv.ttfb.shell.
 */
test("SRV-AT-10 idle RSS (empty) within the 50 MB limit (target 30 MB) and the shell served (compiled probe)", async () => {
  const dir = tempDir("mitori-rss-bin-");
  try {
    const out = `${dir}/probe`;
    const build = Bun.spawnSync(
      [process.execPath, "build", "--compile", "--minify", new URL("./test/rss-probe.ts", import.meta.url).pathname, "--outfile", out],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(build.exitCode).toBe(0);
    const runs: { rssMb: number; shellMs: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const run = Bun.spawnSync([out], { env: { ...process.env, MITORI_RSS_IDLE_MS: "500" }, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      runs.push(JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "{}"));
    }
    const rss = Math.min(...runs.map((r) => r.rssMb));
    const shell = Math.min(...runs.map((r) => r.shellMs));
    console.log(`srv.rss.idleEmpty ${rss} MB, shell ${shell} ms`);
    if (rss > 30) console.warn(`SRV-AT-10: idle RSS ${rss} MB is over the 30 MB target (limit 50 MB)`);
    // the budget's limit (target 30 MB is a trend; Linux idles at ≈ 36 MB, docs/progress/bench-baseline.md); the shipped
    // daemon's own idle RSS is bench srv.rss.idleEmpty. The shell time is a generous deadline (bench: ui.shellPaint)
    expect(rss).toBeLessThanOrEqual(50);
    expect(shell).toBeLessThanOrEqual(5_000);
  } finally {
    removeDir(dir);
  }
}, 60_000);
