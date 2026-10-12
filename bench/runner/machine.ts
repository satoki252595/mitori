// The measuring machine: description for result files, the load check before a run (§6.2), the calibration factor and the
// recorded reference (§6.8).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export interface MachineInfo {
  cpu: string;
  cores: number;
  ramGb: number;
  os: string;
  bun: string;
  node: string;
  /** Chrome for Testing version Playwright launches (its browsers.json), when playwright-core is installed. */
  chrome: string | null;
  /** 1-minute load average when the run started. */
  loadavg: number;
  /** The load stayed above cores × 0.5 after the retries — treat the numbers with suspicion. */
  noisy: boolean;
  /** macOS power source (§6.2: measure on AC power); null where it cannot be read. */
  power: "ac" | "battery" | null;
}

export function machineInfo(root: string, load: { loadavg: number; noisy: boolean }): MachineInfo {
  return {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()}`,
    bun: Bun.version,
    node: nodeVersion(),
    chrome: chromeVersion(root),
    ...load,
    power: powerSource(),
  };
}

/** `pmset -g batt`'s first line: "Now drawing from 'AC Power'" / "'Battery Power'". */
export function parsePower(pmset: string): "ac" | "battery" | null {
  if (/'AC Power'/.test(pmset)) return "ac";
  if (/'Battery Power'/.test(pmset)) return "battery";
  return null;
}

/**
 * Whether this process runs at macOS background priority (darwinbg): `ps -o pri=` reports 4 instead of the usual
 * 31, and on Apple Silicon the process is confined to the efficiency cores (a calibration then measures ≈2×).
 * Null off darwin and when `ps` is unavailable. The result-file shape (`MachineInfo`, `mitori.bench-result/1`)
 * is unchanged on purpose: this is a pre-run gate, not a recorded dimension.
 */
export function parseBackgroundPriority(psOut: string): boolean {
  return psOut.trim() === "4";
}

export interface BackgroundPriorityOptions {
  /** Test seam. */
  platform?: NodeJS.Platform;
  pid?: number;
  run?: (args: string[]) => { status: number | null; stdout: unknown };
}

export function backgroundPriority(opts: BackgroundPriorityOptions = {}): boolean | null {
  if ((opts.platform ?? process.platform) !== "darwin") return null;
  try {
    const args = ["-o", "pri=", "-p", String(opts.pid ?? process.pid)];
    const r = opts.run ? opts.run(args) : spawnSync("ps", args, { encoding: "utf8" });
    if (r.status !== 0) return null;
    return parseBackgroundPriority(String(r.stdout ?? ""));
  } catch {
    return null;
  }
}

function powerSource(): MachineInfo["power"] {
  if (process.platform !== "darwin") return null;
  const r = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" });
  return r.status === 0 ? parsePower(r.stdout) : null;
}

/**
 * macOS: `caffeinate -i -w <this pid>` for the rest of the run (§6.2: idle sleep must not interrupt a measurement). It exits
 * with this process; a missing caffeinate is ignored. No-op elsewhere.
 */
export function keepAwake(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") return;
  try {
    const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no caffeinate: measure anyway */
  }
}

/** The `node` on PATH (the devShell's; Playwright runs under it). `process.versions.node` is Bun's compat value. */
function nodeVersion(): string {
  const r = spawnSync("node", ["--version"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().replace(/^v/, "") : "none";
}

function chromeVersion(root: string): string | null {
  const file = join(root, "node_modules/playwright-core/browsers.json");
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { browsers?: { name: string; browserVersion?: string }[] };
    return doc.browsers?.find((b) => b.name === "chromium")?.browserVersion ?? null;
  } catch {
    return null;
  }
}

/** `git rev-parse HEAD` of `root`, or "" outside a repository. */
export function gitSha(root: string): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

/** Load above cores × this is a loaded machine (§6.2): time budgets are reported, not gated. */
export const NOISY_RATIO = 0.5;

/** Default wait between two load checks. */
export const QUIET_WAIT_MS = 30_000;

export interface QuietOptions {
  /** Test seam. */
  loadavg?: () => number;
  cores?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first check (default 2). */
  retries?: number;
  /** Wait before each retry (default 30 s: the 1-minute load average needs that long to move at all). */
  waitMs?: number;
  /** Fraction of the cores the load may use (default 0.5). */
  ratio?: number;
}

/**
 * Wait for the 1-minute load average to drop below cores × 0.5, at most `retries` times (default 2); a run that still
 * starts under load is flagged `noisy` rather than skipped (§6.2).
 */
export async function waitForQuiet(opts: QuietOptions = {}): Promise<{ loadavg: number; noisy: boolean; waited: number }> {
  const load = opts.loadavg ?? (() => os.loadavg()[0] ?? 0);
  const limit = (opts.cores ?? os.cpus().length) * (opts.ratio ?? NOISY_RATIO);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 2;
  let waited = 0;
  let now = load();
  while (now > limit && waited < retries) {
    await sleep(opts.waitMs ?? QUIET_WAIT_MS);
    waited++;
    now = load();
  }
  return { loadavg: now, noisy: now > limit, waited };
}

export interface Reference {
  v: 1;
  machine: Pick<MachineInfo, "cpu" | "cores" | "ramGb" | "os" | "bun" | "node" | "chrome">;
  recordedAt: string;
  calib: { parts: Record<string, number>; totalMs: number };
}

export const referencePath = (root: string): string => join(root, "bench/runner/reference.json");

export function readReference(root: string): Reference | null {
  try {
    return JSON.parse(readFileSync(referencePath(root), "utf8")) as Reference;
  } catch {
    return null;
  }
}

/** Run the calibration workload in a child process (testkit's `perf/calib.ts`, ≈2 s). */
export function runCalibration(root: string): { parts: Record<string, number>; totalMs: number } {
  const r = spawnSync("bun", [join(root, "packages/testkit/src/perf/calib.ts")], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`calibration failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split("\n").pop() as string) as { parts: Record<string, number>; totalMs: number };
}

/** runner time / reference time, clamped to [0.5, 5]; 1 (assumed) when no reference has been recorded. */
export function measureFactor(root: string): { factor: number; source: "measured" | "assumed" } {
  const ref = readReference(root);
  if (!ref) return { factor: 1, source: "assumed" };
  const here = runCalibration(root);
  return { factor: Math.min(5, Math.max(0.5, here.totalMs / ref.calib.totalMs)), source: "measured" };
}

/**
 * Record this machine as the reference: the best of `n` calibrations (an idle machine is the one we want to describe).
 * Refuses on macOS background priority: recording a slow reference would skew every later calibration.
 */
export function recordReference(root: string, n = 5, hooks: { background?: () => boolean | null } = {}): Reference {
  if ((hooks.background ?? backgroundPriority)() === true)
    throw new Error(
      "record-reference refused: this process runs at macOS background priority (efficiency cores only); re-register the runner service before recording a reference",
    );
  const threshold = os.cpus().length * NOISY_RATIO;
  if ((os.loadavg()[0] ?? 0) > threshold || powerSource() === "battery") throw new Error("record-reference requires a quiet machine on AC power");
  let best: { parts: Record<string, number>; totalMs: number } | null = null;
  for (let i = 0; i < n; i++) {
    const c = runCalibration(root);
    if (!best || c.totalMs < best.totalMs) best = c;
  }
  if ((os.loadavg()[0] ?? 0) > threshold || powerSource() === "battery") throw new Error("machine became busy during calibration; reference was not changed");
  const { loadavg: _l, noisy: _n, power: _p, ...machine } = machineInfo(root, { loadavg: 0, noisy: false });
  const ref: Reference = { v: 1, machine, recordedAt: new Date().toISOString(), calib: best as NonNullable<typeof best> };
  writeFileSync(referencePath(root), `${JSON.stringify(ref, null, 2)}\n`);
  return ref;
}
