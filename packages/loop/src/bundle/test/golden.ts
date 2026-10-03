import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Byte-exact golden files under `fixtures/golden/` for WP-08a (the shared `expectGolden` is still an M0 stub).
// `MITORI_UPDATE_GOLDEN=1` rewrites them; a golden change needs a `golden:` commit and, for MBF/1, a FORMAT.bundle bump.

export const GOLDEN_ROOT = join(import.meta.dir, "../../../../../fixtures/golden");

export function expectGoldenText(rel: string, actual: string): void {
  const file = join(GOLDEN_ROOT, rel);
  if (process.env.MITORI_UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`missing golden ${rel} — run with MITORI_UPDATE_GOLDEN=1 and review the file`);
  const want = readFileSync(file, "utf8");
  if (want !== actual) {
    throw new Error(
      `golden ${rel} differs (MITORI_UPDATE_GOLDEN=1 rewrites it — MBF/1 is frozen, so a byte change needs a FORMAT.bundle bump)\n--- want\n${want}\n--- got\n${actual}`,
    );
  }
}
