/**
 * @mitori/indexer — `parse/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { type HardwareInfo, PARSE_POOL, type ParseWorkerEnv, type ParseWorkerHandler, type ParseWorkerInit } from "../contract.ts";
import { createWorkerHandler } from "./worker.ts";

/** Create the Worker-side handler (pure; uses only `env`). */
export function createParseWorker(env: ParseWorkerEnv, init: ParseWorkerInit): Promise<ParseWorkerHandler> {
  return createWorkerHandler(env, init);
}

/** Worker count: clamp(ceil(parseBytes / (mbPerWorker·MiB)), 1, min(maxWorkers, cores − reserveCores, perfCores ?? 8)). */
export function poolSize(parseBytes: number, hw: HardwareInfo): number {
  const want = Math.ceil(parseBytes / (PARSE_POOL.mbPerWorker * 1_048_576));
  const cap = Math.min(PARSE_POOL.maxWorkers, Math.max(1, hw.cores - PARSE_POOL.reserveCores), hw.perfCores ?? 8);
  return Math.max(1, Math.min(want, Math.max(1, cap)));
}
