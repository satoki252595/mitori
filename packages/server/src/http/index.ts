/**
 * @mitori/server — `http/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { VersionAction } from "../contract.ts";

/**
 * Version decision (server spec §1.2). Pure. Same version ⇒ use; otherwise an idle daemon is restarted; a busy one
 * is used when only the version differs (the CLI warns) and refused when the API version differs.
 */
export function decideVersionAction(
  cli: { version: string; apiVersion: number },
  daemon: { version: string; apiVersion: number; idle: boolean },
): VersionAction {
  if (cli.version === daemon.version) return "use";
  if (daemon.idle) return "restart";
  return cli.apiVersion === daemon.apiVersion ? "use" : "error";
}
