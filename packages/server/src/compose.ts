/**
 * @mitori/server — `compose.ts` (owner: WP-INT). M0 stub; implement in place, keep the signature.
 */
import { unsupported } from "@mitori/core";
import type { ServerDeps, ServerHandle } from "./contract.ts";

/** The composition root (`packages/server/src/compose.ts`). The ONLY place where implementations meet. */
export function createServer(deps: ServerDeps): Promise<ServerHandle> {
  return unsupported("server.createServer", deps);
}
