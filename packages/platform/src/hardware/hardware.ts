// CR perf-tier-1: count Super and Performance tiers, excluding Efficiency; retain the level0 fallback when unknown.
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import type { HardwareInfo } from "@mitori/core";

/** A failed / absent / malformed sysctl must not prevent daemon startup. */
export function parsePerfCores(stdout: string, cores: number): number | null {
  if (!/^\d+$/.test(stdout.trim())) return null;
  const n = Number(stdout.trim());
  return Number.isSafeInteger(n) && n > 0 && n <= cores ? n : null;
}

/** `sysctl -n` returns alternating tier names and logical-core counts, in the requested order. */
export function parsePerfLevels(stdout: string, levels: number, cores: number): number | null {
  const lines = stdout.trim().split("\n");
  if (lines.length !== levels * 2) return null;
  let total = 0;
  let performance = 0;
  for (let i = 0; i < lines.length; i += 2) {
    const name = lines[i]?.trim();
    const n = parsePerfCores(lines[i + 1] ?? "", cores);
    if (n === null || (name !== "Super" && name !== "Performance" && name !== "Efficiency")) return null;
    total += n;
    if (name !== "Efficiency") performance += n;
  }
  return total <= cores && performance > 0 ? performance : null;
}

export function hardwareInfo(): HardwareInfo {
  const cores = availableParallelism();
  let perfCores: number | null = null;
  if (process.platform === "darwin") {
    try {
      const deadline = performance.now() + 1000;
      const sysctl = (keys: readonly string[]): string | null => {
        const timeout = Math.ceil(deadline - performance.now());
        if (timeout <= 0) return null;
        const r = spawnSync("/usr/sbin/sysctl", ["-n", ...keys], { encoding: "utf8", timeout });
        return r.status === 0 ? r.stdout : null;
      };
      const count = sysctl(["hw.nperflevels"]);
      const levels = count === null ? null : parsePerfCores(count, cores);
      if (levels !== null) {
        const keys = Array.from({ length: levels }, (_, i) => [`hw.perflevel${i}.name`, `hw.perflevel${i}.logicalcpu`]).flat();
        const tiers = sysctl(keys);
        if (tiers !== null) perfCores = parsePerfLevels(tiers, levels, cores);
      }
      if (perfCores !== null) return { cores, perfCores };
      const fallback = sysctl(["hw.perflevel0.logicalcpu"]);
      if (fallback !== null) perfCores = parsePerfCores(fallback, cores);
    } catch {
      // Intel Macs and unsupported OS releases retain the existing unknown-hardware fallback.
    }
  }
  return { cores, perfCores };
}
