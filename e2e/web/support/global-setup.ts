/** Build apps/web once before the suite (skipped with MITORI_E2E_SKIP_BUILD=1 when dist is fresh). */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function globalSetup(): void {
  if (process.env.MITORI_E2E_SKIP_BUILD === "1") return;
  const web = resolve(import.meta.dirname, "../../../apps/web");
  execFileSync("bunx", ["--bun", "vite", "build", "--logLevel", "warn"], { cwd: web, stdio: "inherit" });
}
