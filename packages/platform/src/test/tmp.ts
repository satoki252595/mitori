// Test helpers: realpath'd temp directories removed after the test file (MITORI_TEST_KEEP=1 keeps them).
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** A fresh empty directory (its realpath, so it can serve as a SafeWriter `rootReal`). */
export function tempDir(prefix = "mitori-plat-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** Remove every directory made by {@link tempDir} (call from `afterAll`). */
export function cleanupTempDirs(): void {
  if (process.env.MITORI_TEST_KEEP === "1") return;
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}
