// INT-07 UI (integrate/live): the review → AI fix loop driven through the REAL web UI in the installed Google Chrome —
// select text → Explain (answer card flips to 回答済) → Fix → ready → Review → trust the gofmt gate (the approval runs
// it) → accept (⌘⏎) → working tree changed UNCOMMITTED, nothing else of the user's repository → Undo → original bytes →
// code view. The daemon is in-process with the scripted claude of INT-06; `test/int/shots/live.ts` holds the checks
// (exit 77 = no Chrome here → the test passes without running). The same script with `--engine real` is the live run.
// The web assets come from `dist/.build/web` (gen-assets is run first: ≈ 2 s).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

test("INT-07: Explain → Fix → Review → gates → accept → Undo through the real web UI", async () => {
  // the shipped (production) bundle: `bun test` sets NODE_ENV=test, which builds another bundle with other chunk hashes —
  // the asset table every earlier test file of this process cached (apps/cli/src/build/assets.ts) would then point at
  // files that no longer exist (ENOENT in int02..int07 / ux-install of a full run)
  const gen = Bun.spawnSync([process.execPath, "scripts/gen-assets.ts"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  });
  expect(gen.exitCode, gen.stderr.toString()).toBe(0);
  const out = mkdtempSync(join(tmpdir(), "mitori-live-ui-"));
  try {
    const proc = Bun.spawn([process.execPath, "test/int/shots/live.ts", "--engine", "fake", "--out", out], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code === 77) {
      console.log("INT-07 UI: Google Chrome is not installed — skipped");
      return;
    }
    expect(
      code,
      `${stderr
        .split("\n")
        .filter((l) => !l.includes("] shot "))
        .join("\n")}\n${stdout.slice(-1500)}`,
    ).toBe(0);
    const result = JSON.parse(stdout) as { spentUsd: number; failure?: string };
    expect(result.failure).toBeUndefined();
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
