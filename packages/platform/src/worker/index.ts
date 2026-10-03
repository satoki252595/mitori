/**
 * @mitori/platform — `worker/` (owner: WP-01). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
export { createWorkerPool, WORKER_IDLE_MS, type WorkerPoolOptions } from "./pool.ts";
export { serveWorker } from "./protocol.ts";
