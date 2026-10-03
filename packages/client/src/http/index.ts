/**
 * @mitori/client — `http/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { ApiClient, ClientOptions } from "../contract.ts";

/** Typed API client over `fetch` (CR m0-10). */
export function createApiClient(opts: ClientOptions): ApiClient {
  return unsupported("client.createApiClient", opts);
}
