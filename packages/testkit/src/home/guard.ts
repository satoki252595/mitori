// The spawn guard (testing spec §1.5-6): `claude` / `codex` first on PATH, exiting 97. The preload installs a per-run copy that
// also records every hit, which is the counter `agent.spawns.real` (= 0 outside live / contract / eval suites, AC-5). The record
// lives next to the shims because the product's Spawner passes only its env allowlist: PATH survives, a log variable would not.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory with `claude` / `codex` shims that exit 97 (no record; used when the preload is not active). */
export const BIN_GUARD_DIR = fileURLToPath(new URL("../bin-guard", import.meta.url));

/** The guard directory in effect: the preload's recording copy (`MITORI_SPAWN_GUARD_DIR`), else the static shims. */
export function activeGuardDir(env: Record<string, string | undefined> = process.env): string {
  return env.MITORI_SPAWN_GUARD_DIR || BIN_GUARD_DIR;
}

export const GUARDED_CLIS = ["claude", "codex"] as const;
const LOG = "spawns.log";

export interface RecordingGuard {
  /** Put this first on PATH. */
  dir: string;
  /** One line per blocked invocation: `<cli> <args…>`. */
  hits(): string[];
  dispose(): void;
}

/** A fresh guard directory whose shims append each invocation to `<dir>/spawns.log` before exiting 97. */
export function createRecordingGuard(): RecordingGuard {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "mitori-spawn-guard-"));
  if (dir.includes("'")) throw new Error(`spawn guard: unusable temp path ${dir}`);
  const log = join(dir, LOG);
  for (const cli of GUARDED_CLIS) {
    const shim = join(dir, cli);
    writeFileSync(
      shim,
      `#!/bin/sh\n# per-run spawn guard (testkit preload): records the hit, then refuses like ../bin-guard/${cli}\necho "${cli} $*" >> '${log}'\necho "${cli}: blocked in tests (set MITORI_LIVE=1 for live suites)" >&2\nexit 97\n`,
    );
    chmodSync(shim, 0o755);
  }
  return {
    dir,
    hits: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
