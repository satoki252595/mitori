// `bun run build:bin` — the single binary dist/mitori-<os>-<arch> (owner: WP-11a; notes in apps/cli/BUILD-NOTES.md).
// Usage: bun scripts/build-bin.ts [--target <darwin-arm64|linux-arm64|linux-x64|windows-x64|all>] [--lock <assets.lock.json>] [--runtime <official bun>]   (default: the host)
// Host builds under Nix compile against a fetched official runtime (WP37c; `--runtime` / MITORI_OFFICIAL_BUN overrides it).
// gen-assets first (asset-lock verification — a mismatch fails here —, web dist, precompression, the embed table),
// then `bun build --compile` of the generated entry plus every Worker entrypoint.
import { spawnSync } from "node:child_process";
import { genAssets } from "./gen-assets.ts";
import { sourceBuildId } from "./lib/build-id.ts";
import { currentBunIsNixTainted, ensureOfficialRuntime, hostTarget } from "./lib/bun-runtime.ts";
import { ROOT } from "./lib/repo.ts";
import { verifyBuiltBinary } from "./lib/standalone-check.ts";

export const TARGETS = ["darwin-arm64", "linux-arm64", "linux-x64", "windows-x64"] as const;
export type Target = (typeof TARGETS)[number];

/** `bun build` argv for one target. `buildId` bakes the source build id (`<cli version>+<build>`) into the binary. */
export function compileArgs(
  entry: string,
  workers: readonly string[],
  target: Target,
  outfile: string,
  opts: { buildId?: string; executablePath?: string } = {},
): string[] {
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
    // the same sources embed the same id, so a rebuilt binary counts as another version in the handshake
    ...(opts.buildId === undefined ? [] : ["--define", `globalThis.__MITORI_BUILD__=${JSON.stringify(opts.buildId)}`]),
    // a compiled Bun binary otherwise loads .env and bunfig.toml (incl. `preload` scripts!) from the cwd — and
    // mitori runs inside untrusted repositories (BUILD-NOTES §4)
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    // host builds under Nix reuse the Nix-patched bun (a `/nix/store` interpreter baked in, WP37c):
    // compile against the official runtime instead (cross targets already download it)
    ...(opts.executablePath === undefined ? [] : [`--compile-executable-path=${opts.executablePath}`]),
  ];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const host = hostTarget();
  const arg = flag("--target");
  const wanted: string[] = arg ? (arg === "all" ? [...TARGETS] : [arg]) : [host];
  const bad = wanted.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (bad.length > 0) {
    console.error(`build:bin: unsupported target ${bad.join(", ")}; supported targets: ${TARGETS.join(", ")}`);
    process.exit(2);
  }
  const lock = flag("--lock");
  const runtimeOverride = flag("--runtime") ?? process.env.MITORI_OFFICIAL_BUN;
  let gen: Awaited<ReturnType<typeof genAssets>>;
  try {
    gen = await genAssets({ ...(lock ? { lock } : {}), windowsJobLauncher: wanted.includes("windows-x64") });
  } catch (err) {
    console.error(`build:bin: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (!gen) process.exit(1);
  const buildId = sourceBuildId(Bun.version);
  console.log(`build:bin: source build id ${buildId}`);
  for (const t of wanted as Target[]) {
    // the running bun is the compile base when host == target: under Nix it is patched, so
    // fetch the official runtime instead (WP37c). Cross targets keep bun's own download path.
    let executablePath: string | undefined;
    if (t === host) {
      if (runtimeOverride) executablePath = runtimeOverride;
      else if (currentBunIsNixTainted(t)) {
        try {
          executablePath = await ensureOfficialRuntime(t);
        } catch (err) {
          console.error(`build:bin: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      }
    }
    const out = `dist/mitori-${t}${t.startsWith("windows-") ? ".exe" : ""}`;
    const args = compileArgs(gen.entry, gen.workers, t, out, {
      buildId,
      ...(executablePath === undefined ? {} : { executablePath }),
    });
    const r = spawnSync("bun", args, { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
    try {
      verifyBuiltBinary(out, t);
    } catch (err) {
      console.error(`build:bin: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    console.log(`build:bin: ${out}`);
  }
}
