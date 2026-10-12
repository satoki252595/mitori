// End-user startup: existing Bun + Git, production assets built once and refreshed after source changes.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import pkg from "../package.json";
import { listFiles, ROOT } from "./lib/repo.ts";

const STAMP = "dist/.build/start.sha256";
const MANIFEST = "dist/.build/web.json";
export const MIN_BUN_VERSION = pkg.packageManager.slice("bun@".length);

/** Reject an old PATH-selected runtime before it builds assets or starts a daemon. */
export function supportedBun(version: string): boolean {
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) return false;
  const actual = version.split(/[.+-]/).slice(0, 3).map(Number);
  const minimum = MIN_BUN_VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const part = actual[i] ?? 0;
    const bound = minimum[i] ?? 0;
    if (part !== bound) return part > bound;
  }
  return true;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Set in a rolled-over child so an outdated replacement cannot re-exec forever. */
export const BUN_ROLLOVER_GUARD = "MITORI_BUN_REEXEC";
/** `--version` probes fail fast: a missing binary errors at once, a live one answers in milliseconds. */
const BUN_PROBE_TIMEOUT_MS = 5000;

export interface BunCandidateInputs {
  bunInstall?: string | undefined;
  home?: string | undefined;
  pathValue?: string | undefined;
  execPath: string;
}

/** Ordered Bun replacements: `$BUN_INSTALL`, then `~/.bun`, then every PATH entry. Pure: probes run later. */
export function listBunCandidates({ bunInstall, home, pathValue, execPath }: BunCandidateInputs): string[] {
  const raw: string[] = [];
  if (bunInstall) raw.push(join(bunInstall, "bin", "bun"));
  if (home) raw.push(join(home, ".bun", "bin", "bun"));
  for (const dir of (pathValue ?? "").split(delimiter)) if (dir) raw.push(join(dir, "bun"));
  return [...new Set(raw)].filter((candidate) => candidate !== execPath);
}

/** The single stderr line marking a handoff to a newer Bun. Pure. */
export function rolloverNotice(current: string, bunPath: string, version: string): string {
  return `mitori: Bun ${current} is too old; using ${bunPath} ${version}\n`;
}

export interface BunRolloverHooks {
  version?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  startScript?: string;
  ndScript?: string;
  nixFound?: boolean;
  probe?: (command: string, args: readonly string[]) => string | undefined;
  runChild?: (command: string, args: readonly string[], env: Record<string, string>) => number;
  onNotice?: (line: string) => void;
}

/** Trimmed `--version` output, or undefined when the command is missing, slow, failing, or silent. */
function probeVersion(command: string, args: readonly string[]): string | undefined {
  try {
    const probed = spawnSync(command, [...args], { encoding: "utf8", timeout: BUN_PROBE_TIMEOUT_MS });
    if (probed.error || probed.status !== 0) return undefined;
    const version = String(probed.stdout ?? "").trim();
    return version ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Same stdio (TTY intact) and the exit code flows back to `start`. Throws when the spawn itself fails. */
function runChild(command: string, args: readonly string[], env: Record<string, string>): number {
  const child = spawnSync(command, [...args], { env, stdio: "inherit" });
  if (child.error) throw child.error;
  return child.status ?? 1;
}

/**
 * Re-executes `scripts/start.ts` with the same arguments under a newer Bun when the running one is
 * too old. Returns the replacement's exit code, or undefined when nothing usable was found (the
 * caller then keeps the historical error). A present `npm_execpath` is repointed at the replacement
 * Bun; the Nix fallback leaves it alone since `nd` resolves its own Bun.
 */
export function attemptBunRollover(argv: readonly string[], hooks: BunRolloverHooks = {}): number | undefined {
  const version = hooks.version ?? Bun.version;
  const execPath = hooks.execPath ?? process.execPath;
  const env = hooks.env ?? process.env;
  if (env[BUN_ROLLOVER_GUARD]) return undefined;
  const probe = hooks.probe ?? probeVersion;
  const run = hooks.runChild ?? runChild;
  const notify = hooks.onNotice ?? ((line) => process.stderr.write(line));
  const startScript = hooks.startScript ?? join(ROOT, "scripts/start.ts");
  const childEnv = (): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) if (value !== undefined) next[key] = value;
    next[BUN_ROLLOVER_GUARD] = "1";
    return next;
  };
  const home = hooks.homeDir ?? env.HOME ?? homedir();
  for (const candidate of listBunCandidates({ bunInstall: env.BUN_INSTALL, home, pathValue: env.PATH, execPath })) {
    const candidateVersion = probe(candidate, ["--version"]);
    if (!candidateVersion || !supportedBun(candidateVersion)) continue;
    const next = childEnv();
    if (env.npm_execpath) next.npm_execpath = candidate;
    notify(rolloverNotice(version, candidate, candidateVersion));
    try {
      return run(candidate, [startScript, ...argv], next);
    } catch {
      // The spawn itself failed after a good probe: fall through to the next candidate.
    }
  }
  const ndScript = hooks.ndScript ?? join(ROOT, "scripts/nd");
  if ((hooks.nixFound ?? !!Bun.which("nix")) && existsSync(ndScript)) {
    const nixVersion = probe(ndScript, ["bun", "--version"]);
    if (nixVersion && supportedBun(nixVersion)) {
      notify(rolloverNotice(version, `${ndScript} bun`, nixVersion));
      try {
        return run(ndScript, ["bun", startScript, ...argv], childEnv());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

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
    throw new Error(`Dependencies are missing. Run \`${shellQuote(process.execPath)} install --frozen-lockfile\` in the mitori folder first.`);
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

export async function start(argv: readonly string[], hooks: BunRolloverHooks = {}): Promise<number> {
  if (!supportedBun(hooks.version ?? Bun.version)) {
    const rolled = attemptBunRollover(argv, hooks);
    if (rolled !== undefined) return rolled;
    process.stderr.write(
      `mitori: Bun ${MIN_BUN_VERSION} or newer is required; selected ${Bun.version} at ${process.execPath}.\n` +
        "Run `scripts/nd bun run start -- ...` with the project Nix environment, or invoke an existing newer Bun by its absolute path.\n",
    );
    return 1;
  }
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
