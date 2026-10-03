// Isolated MITORI_HOME and the environment every spawned mitori / git process gets in tests (testing spec §1.5).
import { chmodSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestHome } from "../contract.ts";

/** Directory with `claude` / `codex` shims that exit 97 (§1.5-6). */
export const BIN_GUARD_DIR = fileURLToPath(new URL("../bin-guard", import.meta.url));

/** The fixed identity and clock git sees in tests (§1.5-4). */
export const GIT_TEST_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "mitori-test",
  GIT_AUTHOR_EMAIL: "test@mitori.invalid",
  GIT_COMMITTER_NAME: "mitori-test",
  GIT_COMMITTER_EMAIL: "test@mitori.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export const DEFAULT_SEED = "20261003";

/** `PATH` with the guard directory first, unless live suites are running (`MITORI_LIVE=1`). */
export function guardedPath(path: string | undefined = process.env.PATH, live = process.env.MITORI_LIVE === "1"): string {
  const rest = (path ?? "").split(delimiter).filter((p) => p !== BIN_GUARD_DIR && p !== "");
  return (live ? rest : [BIN_GUARD_DIR, ...rest]).join(delimiter);
}

/** Environment for child processes started by tests: merge it over `process.env`. */
export function testEnv(home: string): Record<string, string> {
  return {
    MITORI_HOME: home,
    MITORI_TEST: "1",
    MITORI_TEST_SEED: process.env.MITORI_TEST_SEED ?? DEFAULT_SEED,
    ...GIT_TEST_ENV,
    TZ: "UTC",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: guardedPath(),
  };
}

export async function createHome(opts?: { keep?: boolean }): Promise<TestHome> {
  // realpath: on macOS os.tmpdir() is behind /var → /private/var, and cassette keys replace real paths
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "mitori-home-"));
  chmodSync(dir, 0o700);
  return {
    dir,
    env: testEnv(dir),
    async cleanup() {
      if (opts?.keep || process.env.MITORI_TEST_KEEP === "1") return;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
