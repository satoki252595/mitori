/**
 * @mitori/server — `http/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { VersionAction } from "../contract.ts";

/** Version decision. Pure. */
export function decideVersionAction(
  cli: { version: string; apiVersion: number },
  daemon: { version: string; apiVersion: number; idle: boolean },
): VersionAction {
  return unsupported("server.decideVersionAction", cli, daemon);
}
