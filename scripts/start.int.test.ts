import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

test("an absolute Bun run start preserves its runtime in setup launch commands when PATH shadows bun", () => {
  const dir = mkdtempSync(join(tmpdir(), "mitori-start-path-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const shadow = join(bin, "bun");
    writeFileSync(shadow, "#!/bin/sh\necho 'wrong PATH-selected Bun' >&2\nexit 91\n");
    chmodSync(shadow, 0o755);
    const p = Bun.spawnSync([process.execPath, "run", "start", "--", "setup", "codex", "--repo", ROOT, "--print"], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, MITORI_HOME: join(dir, "home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(p.stderr)).not.toContain("wrong PATH-selected Bun");
    expect(p.exitCode).toBe(0);
    const out = new TextDecoder().decode(p.stdout);
    expect(out).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(out).toContain(JSON.stringify(join(ROOT, "scripts/start.ts")));
    expect(out).not.toContain(JSON.stringify(shadow));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000); // A clean checkout also builds production UI assets; the default 5s is too short on Linux CI.

// Runs only with an explicit old Bun, e.g. MITORI_TEST_OLD_BUN=/etc/profiles/per-user/$USER/bin/bun.
test.if(!!process.env.MITORI_TEST_OLD_BUN)(
  "an old Bun re-execs start under a newer Bun with a single notice line",
  () => {
    const p = Bun.spawnSync([process.env.MITORI_TEST_OLD_BUN as string, "run", "start", "--", "--version"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(0);
    expect(new TextDecoder().decode(p.stdout)).toBe("mitori 0.0.0 (api 1)\n");
    const err = new TextDecoder().decode(p.stderr);
    const notices = err.split("\n").filter((line) => line.includes("is too old; using"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^mitori: Bun \S+ is too old; using \S+ \d+\.\d+\.\d+$/);
    expect(err).not.toContain("or newer is required");
  },
  60_000,
);
