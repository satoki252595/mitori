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
  const gen = Bun.spawnSync([process.execPath, "scripts/gen-assets.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  expect(gen.exitCode, gen.stderr.toString()).toBe(0);
  const out = mkdtempSync(join(tmpdir(), "mitori-live-ui-"));
  try {
    const proc = Bun.spawn([process.execPath, "test/int/shots/live.ts", "--engine", "fake", "--out", out], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code === 77) {
      console.log("INT-07 UI: Google Chrome is not installed — skipped");
      return;
    }
    expect(code, `${stderr.split("\n").filter((l) => !l.includes("] shot ")).join("\n")}\n${stdout.slice(-1500)}`).toBe(0);
    const result = JSON.parse(stdout) as { spentUsd: number; failure?: string };
    expect(result.failure).toBeUndefined();
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
