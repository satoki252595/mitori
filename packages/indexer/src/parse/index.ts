/**
 * @mitori/indexer — `parse/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported } from "@mitori/core";
import type { HardwareInfo, ParseWorkerEnv, ParseWorkerHandler, ParseWorkerInit } from "../contract.ts";

/** Create the Worker-side handler (pure; uses only `env`). */
export function createParseWorker(env: ParseWorkerEnv, init: ParseWorkerInit): Promise<ParseWorkerHandler> {
  return unsupported("indexer.createParseWorker", env, init);
}

/** Worker count: clamp(ceil(parseBytes / (mbPerWorker·MiB)), 1, min(maxWorkers, cores − reserveCores, perfCores ?? 8)). */
export function poolSize(parseBytes: number, hw: HardwareInfo): number {
  return unsupported("indexer.poolSize", parseBytes, hw);
}
