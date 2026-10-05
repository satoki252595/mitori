// CR m1-116: use logical cores in the OS's highest-performance tier; retain the existing fallback when unknown.
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import type { HardwareInfo } from "@mitori/core";

/** A failed / absent / malformed sysctl must not prevent daemon startup. */
export function parsePerfCores(stdout: string, cores: number): number | null {
  if (!/^\d+$/.test(stdout.trim())) return null;
  const n = Number(stdout.trim());
  return Number.isSafeInteger(n) && n > 0 && n <= cores ? n : null;
}

export function hardwareInfo(): HardwareInfo {
  const cores = availableParallelism();
  let perfCores: number | null = null;
  if (process.platform === "darwin") {
    try {
      const r = spawnSync("/usr/sbin/sysctl", ["-n", "hw.perflevel0.logicalcpu"], { encoding: "utf8", timeout: 1000 });
      if (r.status === 0) perfCores = parsePerfCores(r.stdout, cores);
    } catch {
      // Intel Macs and unsupported OS releases retain the existing unknown-hardware fallback.
    }
  }
  return { cores, perfCores };
}
