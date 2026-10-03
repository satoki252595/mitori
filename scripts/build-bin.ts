// `bun run build:bin` — compile the CLI to a single binary: dist/mitori-<os>-<arch>.
// Usage: bun scripts/build-bin.ts [--target <darwin-arm64|linux-x64|all>]   (default: the host)
// WP-11a extends this (embedded web dist, grammars, workers, assets.lock.json verification).
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.ts";

const TARGETS = ["darwin-arm64", "linux-x64"] as const;
type Target = (typeof TARGETS)[number];
const host = `${process.platform}-${process.arch}`;
const arg = process.argv[process.argv.indexOf("--target") + 1];
const wanted: Target[] =
  process.argv.includes("--target") && arg ? (arg === "all" ? [...TARGETS] : [arg as Target]) : TARGETS.includes(host as Target) ? [host as Target] : [];
if (wanted.length === 0 || wanted.some((t) => !TARGETS.includes(t))) {
  console.error(`build:bin: unsupported target ${arg ?? host}; this session builds ${TARGETS.join(", ")} only (MILESTONES §11)`);
  process.exit(2);
}
for (const t of wanted) {
  const out = `dist/mitori-${t}`;
  const r = spawnSync(
    "bun",
    ["build", "apps/cli/src/main.ts", "--compile", "--minify", `--target=bun-${t}`, `--outfile=${out}`, "--define", "globalThis.__MITORI_TEST__=false"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`build:bin: ${out}`);
}
