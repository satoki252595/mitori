// UX-UI (finishing pass, track ux): the ux scenarios through the REAL web UI in the installed Google Chrome — a Fix on
// a static facts row without `@` (the row's code offered, ⌥1 picks it, no estimate before that), the AI's doc edit as an
// in-prose suggestion, the decluttered Review header, a Fix with nothing to point at (the hint, no 412), co-editing (a
// human writes a cited sentence, the Fix on it has its 対象コード by itself, the sentence's rewrite accepted in prose),
// and a promoted answer's INSERT proposal rejected. `test/int/shots/ux.ts` holds the checks (exit 77 = no Chrome here
// → the test passes without running); it also fails on any page error (an effect loop) and any 412 / 5xx.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

test("UX-UI: Fix without @, suggestions in prose, Review header, hint, co-editing, insert proposals — real web UI", async () => {
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
  const out = mkdtempSync(join(tmpdir(), "mitori-ux-ui-"));
  try {
    const proc = Bun.spawn([process.execPath, "test/int/shots/ux.ts", "--out", out], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code === 77) {
      console.log("UX-UI: Google Chrome is not installed — skipped");
      return;
    }
    expect(
      code,
      `${stderr
        .split("\n")
        .filter((l) => !l.includes("] shot "))
        .join("\n")}\n${stdout.slice(-1500)}`,
    ).toBe(0);
    const result = JSON.parse(stdout) as { failure?: string; consoleErrors: string[]; badResponses: string[] };
    expect(result.failure).toBeUndefined();
    expect(result.consoleErrors).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 240_000);
