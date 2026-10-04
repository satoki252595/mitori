/**
 * F2 / CR m1-119: which gate sandbox this machine has. The shipped CLI passed `"none"`, so every gate that runs repo
 * code (typecheck / test / lint) waited for a click, and "checked by the gates" meant the formatter only. macOS:
 * `/usr/bin/sandbox-exec` accepting a trivial profile; Linux: `bwrap` able to make a user namespace (unprivileged
 * user namespaces can be disabled). One probe per process, cached; ≈ 5–15 ms.
 */
export type GateSandboxKind = "sandbox-exec" | "bwrap" | "none";

export interface SandboxProbe {
  platform: string;
  /** Exit code of argv (null when it could not start). */
  run(argv: readonly string[]): number | null;
  /** Absolute path of a command on the daemon's SAFE_PATH, or null. */
  which(cmd: string): string | null;
  exists(path: string): boolean;
}

const SEATBELT = "/usr/bin/sandbox-exec";

/** Pure decision over a probe (unit-tested with a fake). */
export function probeGateSandbox(p: SandboxProbe): GateSandboxKind {
  if (p.platform === "darwin") {
    if (!p.exists(SEATBELT)) return "none";
    return p.run([SEATBELT, "-p", "(version 1)(allow default)", "/usr/bin/true"]) === 0 ? "sandbox-exec" : "none";
  }
  if (p.platform === "linux") {
    const bwrap = p.which("bwrap");
    if (!bwrap) return "none";
    const t = p.which("true") ?? "/bin/true";
    return p.run([bwrap, "--unshare-user", "--ro-bind", "/", "/", "--dev", "/dev", t]) === 0 ? "bwrap" : "none";
  }
  return "none";
}

let cached: GateSandboxKind | null = null;

/** The gate sandbox of this machine (cached for the process). `path` = the daemon's SAFE_PATH. */
export function detectGateSandbox(path: string = process.env.PATH ?? ""): GateSandboxKind {
  if (cached !== null) return cached;
  cached = probeGateSandbox({
    platform: process.platform,
    exists: (f) => {
      try {
        return Bun.file(f).size > 0;
      } catch {
        return false;
      }
    },
    which: (cmd) => Bun.which(cmd, { PATH: path }),
    run: (argv) => {
      try {
        const r = Bun.spawnSync([...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { PATH: path } });
        return r.exitCode;
      } catch {
        return null;
      }
    },
  });
  return cached;
}
