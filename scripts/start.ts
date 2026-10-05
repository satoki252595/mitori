// End-user startup: existing Bun + Git, production assets built once and refreshed after source changes.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, ROOT } from "./lib/repo.ts";

const STAMP = "dist/.build/start.sha256";
const MANIFEST = "dist/.build/web.json";

/** Content-based invalidation also catches deleted files and edits with preserved timestamps. */
export function sourceFingerprint(root: string, files: readonly string[], runtime = Bun.version): string {
  const hash = createHash("sha256").update(runtime);
  for (const file of [...files].sort()) hash.update(`\0${file}\0`).update(readFileSync(join(root, file)));
  return hash.digest("hex");
}

/** A successful stamp alone is insufficient: an interrupted cleanup can remove an output. */
export function assetsReady(root: string, fingerprint: string): boolean {
  try {
    if (readFileSync(join(root, STAMP), "utf8") !== fingerprint || !existsSync(join(root, "dist/.build/initial/initial.js"))) return false;
    const web = JSON.parse(readFileSync(join(root, MANIFEST), "utf8")) as Record<string, { raw: string; br?: string; gz?: string }>;
    return !!web["/index.html"] && Object.values(web).every((a) => [a.raw, a.br, a.gz].every((p) => p === undefined || existsSync(join(root, p))));
  } catch {
    return false;
  }
}

async function prepareAssets(): Promise<void> {
  if (!Bun.which("git")) throw new Error("Git was not found on PATH. Use your existing Git installation, then run this command again.");
  if (!existsSync(join(ROOT, "node_modules/vite/package.json")))
    throw new Error("Dependencies are missing. Run `bun install --frozen-lockfile` in the mitori folder first.");
  // Reuse the release supply-chain check even when the web bundle is cached.
  const { genAssets } = await import("./gen-assets.ts");
  await genAssets({ verifyOnly: true, log: () => {} });
  const files = listFiles("apps", "packages", "scripts/gen-assets.ts", "scripts/start.ts", "package.json", "bun.lock", "bunfig.toml", "tsconfig*.json").filter(
    (p) => !/\.(test|spec)\.[^.]+$|\/(test|tests|__tests__)\//.test(p),
  );
  const fingerprint = sourceFingerprint(ROOT, files);
  if (assetsReady(ROOT, fingerprint)) return;
  process.stderr.write("mitori: preparing the browser UI (first run or updated source)…\n");
  const built = spawnSync(process.execPath, [join(ROOT, "scripts/gen-assets.ts")], { cwd: ROOT, stdio: ["inherit", 2, 2] });
  if (built.status !== 0) throw new Error(`Browser UI build failed (${built.status ?? built.error?.message ?? "signal"}). Fix the error above and retry.`);
  writeFileSync(join(ROOT, STAMP), fingerprint);
}

export async function start(argv: readonly string[]): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (!["--version", "-v", "version", "--help", "-h", "help"].includes(args[0] ?? "")) {
    try {
      await prepareAssets();
    } catch (error) {
      process.stderr.write(`mitori: ${error instanceof Error ? error.message : error}\n`);
      return 1;
    }
  }
  // Source startup uses the same production behavior as the compiled release, including disabled test seams.
  Object.assign(globalThis, { __MITORI_TEST__: false });
  const { main } = await import("../apps/cli/src/main.ts");
  return main(args);
}

if (import.meta.main) process.exitCode = await start(process.argv.slice(2));
