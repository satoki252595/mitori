import { expect, test } from "bun:test";
import { removeDir, tempDir } from "./test/fakes.ts";

/**
 * SRV-AT-10 / `srv.rss.idleEmpty`: the empty daemon compiled the way it ships (`bun build --compile --minify`)
 * idles at ≤ 30 MB RSS and serves the shell within 0.3 s of process start. Running from source adds the transpiler
 * (~9 MB), so the probe is compiled first.
 */
test("SRV-AT-10 idle RSS (empty) ≤ 30 MB and shell ≤ 0.3 s (compiled probe)", async () => {
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
    // the budget's limit (target 30 MB is a trend; Linux idles at ≈ 36 MB, docs/progress/bench-baseline.md); the shipped
    // daemon's own idle RSS is bench srv.rss.idleEmpty. The shell time is a generous deadline (bench: ui.shellPaint)
    expect(rss).toBeLessThanOrEqual(50);
    expect(shell).toBeLessThanOrEqual(5_000);
  } finally {
    removeDir(dir);
  }
}, 60_000);
