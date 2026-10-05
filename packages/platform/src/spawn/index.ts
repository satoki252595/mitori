/**
 * @mitori/platform — `spawn/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { computeSafePath } from "./safe-path.ts";

export { type AuthSpawn, spawnOfficialLogin } from "./official-login.ts";

/**
 * SAFE_PATH (§2.3) [SEC-10]: from the daemon's start env, drop empty/relative PATH entries, entries under any
 * registered workspace root or the cwd the CLI was started in, `node_modules/.bin`, `.venv/bin`; the daemon then
 * `chdir`s to `~/.mitori/run/empty`. Pure.
 */
export function resolveSafePath(path: string, opts: { workspaceRoots: readonly string[]; startCwd: string }): string {
  return computeSafePath(path, opts);
}

// `SpawnSpec` / `Spawner` / `ChildHandle` (./types.ts) are structural copies of the @mitori/agent contract types and
// are deliberately not re-exported: consumers name the agent's types.
export { detectGateSandbox, type GateSandboxKind, probeGateSandbox, type SandboxProbe } from "./sandbox.ts";
export {
  createSpawner,
  KILL_POLICY,
  type KillPolicy,
  type RunOptions,
  type RunResult,
  runToExit,
  type SpawnerOptions,
  stopChild,
} from "./spawner.ts";
