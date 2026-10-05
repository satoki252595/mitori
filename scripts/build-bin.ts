// `bun run build:bin` — the single binary dist/mitori-<os>-<arch> (owner: WP-11a; notes in apps/cli/BUILD-NOTES.md).
// Usage: bun scripts/build-bin.ts [--target <darwin-arm64|linux-x64|windows-x64|all>] [--lock <assets.lock.json>]   (default: the host)
// gen-assets first (asset-lock verification — a mismatch fails here —, web dist, precompression, the embed table),
// then `bun build --compile` of the generated entry plus every Worker entrypoint.
import { spawnSync } from "node:child_process";
import { genAssets } from "./gen-assets.ts";
import { ROOT } from "./lib/repo.ts";

export const TARGETS = ["darwin-arm64", "linux-x64", "windows-x64"] as const;
export type Target = (typeof TARGETS)[number];

/** `bun build` argv for one target. */
export function compileArgs(entry: string, workers: readonly string[], target: Target, outfile: string): string[] {
  return [
    "build",
    entry,
    ...workers,
    "--compile",
    "--minify",
    `--target=bun-${target}`,
    `--outfile=${outfile}`,
    // workers are embedded at /$bunfs/root/<repo path>.js (gen-assets' table relies on it)
    `--root=${ROOT}`,
    "--define",
    "globalThis.__MITORI_TEST__=false",
    // a compiled Bun binary otherwise loads .env and bunfig.toml (incl. `preload` scripts!) from the cwd — and
    // mitori runs inside untrusted repositories (BUILD-NOTES §4)
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
  ];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const arg = flag("--target");
  const wanted: string[] = arg ? (arg === "all" ? [...TARGETS] : [arg]) : [host];
  const bad = wanted.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (bad.length > 0) {
    console.error(`build:bin: unsupported target ${bad.join(", ")}; supported targets: ${TARGETS.join(", ")}`);
    process.exit(2);
  }
  const lock = flag("--lock");
  let gen: Awaited<ReturnType<typeof genAssets>>;
  try {
    gen = await genAssets({ ...(lock ? { lock } : {}), windowsJobLauncher: wanted.includes("windows-x64") });
  } catch (err) {
    console.error(`build:bin: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (!gen) process.exit(1);
  for (const t of wanted as Target[]) {
    const out = `dist/mitori-${t}${t.startsWith("windows-") ? ".exe" : ""}`;
    const r = spawnSync("bun", compileArgs(gen.entry, gen.workers, t, out), { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
    console.log(`build:bin: ${out}`);
  }
}
