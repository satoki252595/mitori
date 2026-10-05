/** Source daemons read the shipping web manifest and initial renderer, rather than the mock suite's separate dist. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function globalSetup(): void {
  if (process.env.MITORI_E2E_BINARY === "compiled") return;
  execFileSync("bun", ["scripts/gen-assets.ts"], { cwd: resolve(import.meta.dirname, "../.."), stdio: "inherit" });
}
