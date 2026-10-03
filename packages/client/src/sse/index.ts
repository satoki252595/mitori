/**
 * @mitori/client — `sse/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { SseClient, SseClientOptions } from "../contract.ts";

/** The one `fetch()`-stream SSE client per tab / process (CR m0-10). Does not connect until `connect()`. */
export function createSseClient(opts: SseClientOptions): SseClient {
  return unsupported("client.createSseClient", opts);
}
