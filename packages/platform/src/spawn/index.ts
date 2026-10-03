/**
 * @mitori/platform — `spawn/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";

/**
 * SAFE_PATH (§2.3) [SEC-10]: from the daemon's start env, drop empty/relative PATH entries, entries under any
 * registered workspace root or the cwd the CLI was started in, `node_modules/.bin`, `.venv/bin`; the daemon then
 * `chdir`s to `~/.mitori/run/empty`. Pure.
 */
export function resolveSafePath(path: string, opts: { workspaceRoots: readonly string[]; startCwd: string }): string {
  return unsupported("platform.resolveSafePath", path, opts);
}
