// Root-script dispatcher for runners owned by later WPs (CR m0-7).
// Usage: bun scripts/run-owned.ts <file>:<WP> [<file>:<WP> …] [args…]
// Runs `bun <file> [args…]` for every listed file that exists (in order, stopping at the first failure) and
// prints the owner of each missing one, so `ci:pr` stays green until the owners land their runners.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.ts";

const argv = process.argv.slice(2);
const targets: { file: string; wp: string }[] = [];
while (argv[0] && /\.ts:[\w-]+$/.test(argv[0])) {
  const [file, wp] = (argv.shift() as string).split(/:(?=[\w-]+$)/) as [string, string];
  targets.push({ file, wp });
}
for (const { file, wp } of targets) {
  if (!existsSync(join(ROOT, file))) {
    console.log(`${file}: not implemented yet — owner ${wp} (docs/design/briefs/${wp}.md); skipping`);
    continue;
  }
  const code = await Bun.spawn(["bun", file, ...argv], { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) process.exit(code);
}
